import { NextRequest, NextResponse } from 'next/server';
import { buildStoryboardVideoPrompt, buildVideoSegmentPrompt, generateStoryboardVideo } from '@/lib/videoGenerator';
import { snapDurationToModel } from '@/lib/apimart';
import { createComfyUIVideoTask } from '@/lib/comfyui';
import { storyboardSpeech } from '@/lib/speechAudioContract';

export const runtime = 'nodejs';
export const maxDuration = 300;

function dialogueLineList(storyboard: any): any[] {
  const speech = storyboardSpeech(storyboard);
  if (speech.length) return speech.map(line => ({ character: line.character, text: line.exactLine }));
  return Array.isArray(storyboard?.dialogueLines) && storyboard.dialogueLines.length
    ? storyboard.dialogueLines
    : Object.entries(storyboard?.dialogue || {}).map(([character, text]) => ({ character, text }));
}

function speakingCharacterNames(storyboard: any): string[] {
  const lines = dialogueLineList(storyboard);
  const seen = new Set<string>();
  return lines
    .filter((line: any) => String(line?.text || '').trim())
    .map((line: any) => String(line?.character || '').trim())
    .filter((name: string) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

export async function POST(request: NextRequest) {
  try {
    const {
      storyboard, segmentStoryboards = [], apiKey, videoModel, aspectRatio,
      characterAudios = [], firstFrameUrl,
      voiceReferences = {},  // { 角色名: CloudinaryURL }
      videoProvider = 'apimart', comfyui = {},
    } = await request.json();

    if (!storyboard) return NextResponse.json({ error: 'Storyboard is required' }, { status: 400 });
    const videoStoryboards = Array.isArray(segmentStoryboards) && segmentStoryboards.length
      ? segmentStoryboards.slice(0, 4)
      : [storyboard];
    const combinedStoryboard = {
      ...storyboard,
      characters: [...new Set(videoStoryboards.flatMap((shot: any) => shot.characters || []))],
      objects: [...new Set(videoStoryboards.flatMap((shot: any) => shot.objects || []))],
      dialogueLines: videoStoryboards.flatMap(dialogueLineList),
    };
    if (videoProvider === 'comfyui') {
      if (videoStoryboards.some((shot: any) => !shot.imageUrl || typeof shot.imageUrl !== 'string')) return NextResponse.json({ error: 'Every selected storyboard needs an image' }, { status: 400 });
      if (videoStoryboards.some((shot: any) => shot.imageUrl.startsWith('blob:'))) {
        return NextResponse.json({ error: 'Storyboard image is a browser-only blob URL and cannot be read by Companion' }, { status: 400 });
      }
      // H3 的所有参考音频总计不能超过 15 秒。只传本镜头真正开口的角色，
      // 避免把画面中未说话角色的声音也计入额度。后续还会在 Companion 端统一裁剪总长。
      const speakingCharacters = speakingCharacterNames(combinedStoryboard);
      const referenceAudioNames: string[] = [];
      const referenceAudios = speakingCharacters
        .map((name) => ({ name, url: voiceReferences[name] }))
        .filter((x): x is { name: string; url: string } => Boolean(x.url))
        .slice(0, 3)
        .map((x) => { referenceAudioNames.push(x.name); return x.url; });
      // createComfyUIVideoTask materializes URL/data URL locally and then
      // uploads that exact file into ComfyUI/input over SSH. Do not insert a
      // Cloudinary hop here: it is unnecessary and can drop a valid data URL
      // when Cloudinary is unavailable.
      const isMultiBeatSegment = videoStoryboards.length > 1;
      const firstFrame = firstFrameUrl || videoStoryboards[0].imageUrl;
      if (typeof firstFrame !== 'string' || firstFrame.startsWith('blob:')) {
        return NextResponse.json({ error: 'ComfyUI first frame is not accessible to Companion' }, { status: 400 });
      }
      const auxiliaryImages = isMultiBeatSegment
        ? (firstFrameUrl ? videoStoryboards : videoStoryboards.slice(1)).map((shot: any) => shot.imageUrl)
        : [];
      console.log(`[comfyui] scene ${storyboard.sceneNumber || '?'} frame input: ${firstFrame.startsWith('data:') ? 'data-url' : 'url'}; continuity=${Boolean(firstFrameUrl)}; beats=${videoStoryboards.length}`);
      const result = await createComfyUIVideoTask({
        firstFrame,
        auxiliaryImages,
        // Single-shot continuity can use FL2VA. Multi-beat segments instead use
        // the multi-reference workflow so every checked storyboard remains a
        // visible editorial reference inside the same 15-second clip.
        endFrame: firstFrameUrl && !isMultiBeatSegment ? storyboard.imageUrl : undefined,
        referenceAudios,
        referenceAudioNames,
        // H3 generates the synchronized soundtrack natively. Voice samples are
        // optional references, so APIMart's URL-tag syntax must not enter the prompt.
        prompt: buildVideoSegmentPrompt(isMultiBeatSegment ? videoStoryboards : [storyboard], [], {
          firstFrameUrl,
          duration: Number(storyboard.videoDuration) || (isMultiBeatSegment ? 15 : 5),
          hasVoiceReferences: referenceAudios.length > 0,
          referenceAudioNames,
          visualOverride: storyboard.videoPromptOverride && String(storyboard.videoPrompt || '').trim()
            ? String(storyboard.videoPrompt).trim()
            : undefined,
        }),
        duration: Number(storyboard.videoDuration) || 5,
        aspectRatio: aspectRatio || '16:9',
        settings: comfyui,
      });
      return NextResponse.json({
        taskId: result.taskId,
        status: 'processing',
        provider: 'comfyui',
        workflow: result.workflow,
      });
    }
    if (!apiKey) return NextResponse.json({ error: 'API key is required' }, { status: 400 });

    console.log('Starting video generation for scene:', storyboard.sceneNumber);
    console.log('Using model:', videoModel || 'sora-2');

    const m = (videoModel || '').toLowerCase();
    const isSeedance20 = m.includes('seedance-2') || m.includes('seedance-4') || m.includes('seedance-5');
    const isWanAudio   = m.includes('wan2.6') || m.includes('wan2.7') || m.includes('wan 2.6') || m.includes('wan 2.7');
    const isMiniMaxH3  = m.includes('minimax-h3');

    // 声音参考模式（Seedance 2.0 / MiniMax-H3）：只取当前分镜实际说话角色的声音参考 URL。
    // 这样也避免 MiniMax H3 因未说话角色的参考音频累计超过 15 秒。
    const storyboardChars: string[] = storyboard.characters || [];
    const speakingChars = speakingCharacterNames(storyboard);
    const voiceRefUrls: string[] = (isSeedance20 || isMiniMaxH3)
      ? speakingChars
          .map((name: string) => voiceReferences[name])
          .filter(Boolean)
          .slice(0, 3)  // 最多 3 个
      : [];

    // Wan 系列：取第一个角色的声音参考作为 audio_url（单轨）
    const singleVoiceRef = isWanAudio
      ? storyboardChars.map((name: string) => voiceReferences[name]).find(Boolean)
      : undefined;

    const audioUrls = voiceRefUrls.length > 0
      ? voiceRefUrls
      : singleVoiceRef
        ? [singleVoiceRef]
        : [];

    // 有声音参考 → 用参考音色让模型自己生成音频；无参考 → 模型自动配音
    const useGenerateAudio = audioUrls.length === 0;

    // 有声音参考时，将视频时长对齐到合法值（避免模型默认5s拉伸）
    let effectiveStoryboard = storyboard;

    console.log(`Voice refs for scene ${storyboard.sceneNumber}:`, audioUrls.length, '| auto-audio:', useGenerateAudio);

    const taskId = await generateStoryboardVideo(
      effectiveStoryboard,
      apiKey,
      videoModel,
      aspectRatio || '16:9',
      audioUrls,
      characterAudios,
      firstFrameUrl,
      useGenerateAudio,
    );

    console.log('Video task created, ID:', taskId);
    return NextResponse.json({ taskId, status: 'processing' });
  } catch (error: any) {
    console.error('Generate video API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate video' },
      { status: 500 }
    );
  }
}
