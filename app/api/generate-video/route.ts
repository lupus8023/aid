import { NextRequest, NextResponse } from 'next/server';
import { buildStoryboardVideoPrompt, generateStoryboardVideo } from '@/lib/videoGenerator';
import { snapDurationToModel } from '@/lib/apimart';
import { createComfyUIVideoTask } from '@/lib/comfyui';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const {
      storyboard, apiKey, videoModel, aspectRatio,
      characterAudios = [], firstFrameUrl,
      voiceReferences = {},  // { 角色名: CloudinaryURL }
      videoProvider = 'apimart', comfyui = {},
    } = await request.json();

    if (!storyboard) return NextResponse.json({ error: 'Storyboard is required' }, { status: 400 });
    if (videoProvider === 'comfyui') {
      if (!storyboard.imageUrl) return NextResponse.json({ error: 'Storyboard image is required' }, { status: 400 });
      // 保持「过滤后有音色参考的角色」与参考音频同序，用于在 prompt 里显式绑定 <Audio N> = 角色名。
      const storyboardCharacters: string[] = Array.isArray(storyboard.characters) ? storyboard.characters : [];
      const referenceAudioNames: string[] = [];
      const referenceAudios = storyboardCharacters
        .map((name) => ({ name, url: voiceReferences[name] }))
        .filter((x): x is { name: string; url: string } => Boolean(x.url))
        .slice(0, 3)
        .map((x) => { referenceAudioNames.push(x.name); return x.url; });
      const result = await createComfyUIVideoTask({
        firstFrame: firstFrameUrl || storyboard.imageUrl,
        endFrame: firstFrameUrl ? storyboard.imageUrl : undefined,
        referenceAudios,
        referenceAudioNames,
        // H3 generates the synchronized soundtrack natively. Voice samples are
        // optional references, so APIMart's URL-tag syntax must not enter the prompt.
        prompt: buildStoryboardVideoPrompt(storyboard, [], firstFrameUrl),
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

    // 声音参考模式（Seedance 2.0 / MiniMax-H3）：从当前分镜出现的角色中取声音参考 URL
    const storyboardChars: string[] = storyboard.characters || [];
    const voiceRefUrls: string[] = (isSeedance20 || isMiniMaxH3)
      ? storyboardChars
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
