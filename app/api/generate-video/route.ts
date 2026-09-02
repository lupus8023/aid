import { NextRequest, NextResponse } from 'next/server';
import { applyFilmEndingPrompt, applySeriesVideoStyle, applyVideoDuplicateRepairPrompt, buildStoryboardVideoPrompt, buildVideoSegmentPrompt, generateStoryboardVideo } from '@/lib/videoGenerator';
import { snapDurationToModel } from '@/lib/apimart';
import { createComfyUIVideoTask } from '@/lib/comfyui';
import { audibleStoryboardSpeech, compileTimedSpeech } from '@/lib/speechAudioContract';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds, MAX_H3_SEGMENT_SECONDS } from '@/lib/videoSegments';
import { createFalH3MaxVideoTask } from '@/lib/falVideo';
import { filmEndingDuration } from '@/lib/filmEnding';
import { adaptH3PromptForMotionContinuation } from '@/lib/h3MotionContext';

export const runtime = 'nodejs';
export const maxDuration = 300;

function dialogueLineList(storyboard: any): any[] {
  const speech = audibleStoryboardSpeech(storyboard);
  return speech.map(line => ({ character: line.character, text: line.exactLine }));
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

function isLegacyH3Prompt(prompt: string): boolean {
  const outsideDialogue = String(prompt || '').replace(/<d>[\s\S]*?<\/d>/gi, ' ').replace(/^SERIES LOOK:[^\n]*/gm, ' ');
  return /timeline_json|aid_h3_timeline|audio_event_lock|dialogue_events|shot_contracts|first_word_at|final_word_complete_by/i.test(outsideDialogue)
    || /说完最后一个字|闭嘴|嘴巴闭合|口型闭合/i.test(outsideDialogue)
    || /(?:the\s+)?(?:mouth|lips|jaw)\s+(?:closes?|meet|meets|ceases?\s+(?:speaking\s+)?motion)/i.test(outsideDialogue);
}

export async function POST(request: NextRequest) {
  try {
    const {
      storyboard, segmentStoryboards = [], apiKey, videoModel, aspectRatio,
      characterAudios = [], firstFrameUrl,
      motionContext,
      voiceReferences = {},  // { 角色名: CloudinaryURL }
      videoProvider = 'apimart', comfyui = {},
      fal = {},
      language = 'zh',
      voiceProfiles = {},
      isFilmEnding = false,
      styleReference,
    } = await request.json();

    if (!storyboard) return NextResponse.json({ error: 'Storyboard is required' }, { status: 400 });
    if (firstFrameUrl && storyboard.videoStartMode !== 'previous-segment-tail') {
      return NextResponse.json({ error: '上一段尾帧不能自动替换当前分镜；请刷新网页，并在片段面板明确选择接续模式。' }, { status: 400 });
    }
    if (storyboard.videoStartMode === 'previous-segment-tail' && !firstFrameUrl) {
      return NextResponse.json({ error: '缺少已选择的上一段尾帧，请检查接续条件或改用当前分镜。' }, { status: 400 });
    }
    const videoStoryboards = Array.isArray(segmentStoryboards) && segmentStoryboards.length
      ? segmentStoryboards.slice(0, 4)
      : [storyboard];
    if (videoProvider === 'fal') {
      if (videoStoryboards.some((shot: any) => !shot.imageUrl || typeof shot.imageUrl !== 'string')) {
        return NextResponse.json({ error: '每个 fal H3 Max 视频片段都需要分镜参考图' }, { status: 400 });
      }
      if (videoStoryboards.some((shot: any) => shot.imageUrl.startsWith('blob:'))) {
        return NextResponse.json({ error: '浏览器 blob 图片无法提交给 fal，请重新生成或重新上传参考图' }, { status: 400 });
      }
      const minimumPlayableDuration = estimateVideoSegmentSeconds(videoStoryboards);
      if (minimumPlayableDuration > MAX_H3_SEGMENT_SECONDS) {
        return NextResponse.json({ error: `该片段超过 H3 Max 的 ${MAX_H3_SEGMENT_SECONDS} 秒上限，请缩短台词或拆分片段` }, { status: 400 });
      }
      const requestedDuration = filmEndingDuration(minimumPlayableDuration, isFilmEnding === true, Math.max(5, Math.ceil(Number(storyboard.videoDuration) || minimumPlayableDuration)), Number(storyboard.videoEndingMinimumDuration) || 0);
      const generatedPrompt = buildVideoSegmentPrompt(videoStoryboards, [], {
        isFilmEnding: isFilmEnding === true,
        firstFrameUrl,
        duration: requestedDuration,
        hasVoiceReferences: false,
        referenceAudioNames: [],
        voiceProfiles: voiceProfiles && typeof voiceProfiles === 'object' ? voiceProfiles : {},
        language: language === 'en' ? 'en' : 'zh',
      });
      const editedPrompt = storyboard.videoPromptOverride ? String(storyboard.videoPrompt || '').trim() : '';
      const submittedPrompt = applyVideoDuplicateRepairPrompt(applySeriesVideoStyle(applyFilmEndingPrompt(editedPrompt && !isLegacyH3Prompt(editedPrompt) ? editedPrompt : generatedPrompt, requestedDuration, isFilmEnding === true), styleReference), storyboard.videoDuplicateRepairPrompt);
      const firstFrame = firstFrameUrl || videoStoryboards[0].imageUrl;
      const lastStoryboardImage = videoStoryboards.at(-1)?.imageUrl;
      const endFrame = (firstFrameUrl || videoStoryboards.length > 1) ? lastStoryboardImage : undefined;
      const result = await createFalH3MaxVideoTask({
        prompt: submittedPrompt,
        imageUrl: firstFrame,
        endImageUrl: endFrame && endFrame !== firstFrame ? endFrame : undefined,
        duration: requestedDuration,
        resolution: fal.resolution,
        promptExpansionMode: fal.promptExpansionMode,
        seed: Number.isInteger(fal.seed) ? fal.seed : undefined,
        apiKey: fal.apiKey,
      });
      return NextResponse.json({
        taskId: result.taskId,
        status: 'processing',
        provider: 'fal',
        videoPrompt: submittedPrompt,
      });
    }
    if (videoProvider === 'comfyui') {
      if (videoStoryboards.some((shot: any) => !shot.imageUrl || typeof shot.imageUrl !== 'string')) return NextResponse.json({ error: 'Every selected storyboard needs an image' }, { status: 400 });
      if (videoStoryboards.some((shot: any) => shot.imageUrl.startsWith('blob:'))) {
        return NextResponse.json({ error: 'Storyboard image is a browser-only blob URL and cannot be read by Companion' }, { status: 400 });
      }
      // H3 的所有参考音频总计不能超过 15 秒。只传本镜头真正开口的角色，
      // 避免把画面中未说话角色的声音也计入额度。后续还会在 Companion 端统一裁剪总长。
      const speakingCharacters = [...new Set<string>(videoStoryboards.flatMap(speakingCharacterNames))];
      const minimumPlayableDuration = estimateVideoSegmentSeconds(videoStoryboards);
      if (minimumPlayableDuration > MAX_H3_SEGMENT_SECONDS) {
        return NextResponse.json(
          { error: `该片段按分镜出场时机与完整台词计算后超过 H3 的 ${MAX_H3_SEGMENT_SECONDS} 秒上限，请缩短台词或拆分片段` },
          { status: 400 },
        );
      }
      const requestedDuration = filmEndingDuration(minimumPlayableDuration, isFilmEnding === true,
        Math.ceil(Number(storyboard.videoDuration) || (videoStoryboards.length > 1 ? 15 : 5)), Number(storyboard.videoEndingMinimumDuration) || 0);
      const timedSpeech = compileTimedSpeech(
        videoStoryboards,
        allocateSegmentTimeline(videoStoryboards, requestedDuration),
      );
      const speechTurns = timedSpeech.map(line => ({
        speakerId: line.speakerId,
        character: line.character,
        exactLine: line.exactLine,
        emotion: line.emotion,
        delivery: line.delivery,
        start: line.start,
        end: line.end,
      }));
      const referenceAudioNames: string[] = [];
      const referenceAudios = speakingCharacters
        // Fish Audio is a one-time character timbre reference only. H3 remains
        // the sole generator of this segment's dialogue, lip sync and complete
        // soundtrack from the <d> lines below.
        .map((name) => ({ name, url: voiceReferences[name] }))
        .filter((x): x is { name: string; url: string } => Boolean(x.url))
        .slice(0, 3)
        .map((x) => { referenceAudioNames.push(x.name); return x.url; });
      // createComfyUIVideoTask materializes URL/data URL locally and then
      // uploads that exact file into ComfyUI/input over SSH. Do not insert a
      // Cloudinary hop here: it is unnecessary and can drop a valid data URL
      // when Cloudinary is unavailable.
      const isMultiBeatSegment = videoStoryboards.length > 1;
      const isMotionContinuation = Number(motionContext?.segmentIndex) > 0;
      const firstFrame = isMotionContinuation
        ? videoStoryboards[0].imageUrl
        : (firstFrameUrl || videoStoryboards[0].imageUrl);
      if (typeof firstFrame !== 'string' || firstFrame.startsWith('blob:')) {
        return NextResponse.json({ error: 'ComfyUI first frame is not accessible to Companion' }, { status: 400 });
      }
      const auxiliaryImages = isMultiBeatSegment
        ? (isMotionContinuation
            ? videoStoryboards.slice(1)
            : (firstFrameUrl ? videoStoryboards : videoStoryboards.slice(1))).map((shot: any) => shot.imageUrl)
        : [];
      console.log(`[comfyui] scene ${storyboard.sceneNumber || '?'} frame input: ${firstFrame.startsWith('data:') ? 'data-url' : 'url'}; continuity=${Boolean(firstFrameUrl)}; beats=${videoStoryboards.length}`);
      const generatedPrompt = buildVideoSegmentPrompt(isMultiBeatSegment ? videoStoryboards : [storyboard], [], {
        isFilmEnding: isFilmEnding === true,
        firstFrameUrl: isMotionContinuation ? undefined : firstFrameUrl,
        duration: requestedDuration,
        hasVoiceReferences: referenceAudios.length > 0,
        referenceAudioNames,
        language: language === 'en' ? 'en' : 'zh',
      });
      // The editor shows a complete H3 prompt. Preserve current-format edits,
      // including Chinese direction, but retire the old JSON/timeline control
      // contract so an older project cannot bypass the official prompt builder.
      const editedPrompt = storyboard.videoPromptOverride ? String(storyboard.videoPrompt || '').trim() : '';
      const baseSubmittedPrompt = applyVideoDuplicateRepairPrompt(applySeriesVideoStyle(applyFilmEndingPrompt(editedPrompt && !isLegacyH3Prompt(editedPrompt)
        ? editedPrompt
        : generatedPrompt, requestedDuration, isFilmEnding === true), styleReference), storyboard.videoDuplicateRepairPrompt);
      const submittedPrompt = isMotionContinuation
        ? adaptH3PromptForMotionContinuation(baseSubmittedPrompt)
        : baseSubmittedPrompt;
      const result = await createComfyUIVideoTask({
        firstFrame,
        auxiliaryImages,
        // Single-shot continuity can use FL2VA. Multi-beat segments instead use
        // the multi-reference workflow so every checked storyboard remains a
        // visible editorial reference inside the same 15-second clip.
        endFrame: firstFrameUrl && !isMotionContinuation && !isMultiBeatSegment ? storyboard.imageUrl : undefined,
        referenceAudios,
        referenceAudioNames,
        speechTurns,
        motionContext,
        language: language === 'en' ? 'en' : 'zh',
        // H3 generates the synchronized soundtrack natively. Voice samples are
        // optional references, so APIMart's URL-tag syntax must not enter the prompt.
        prompt: submittedPrompt,
        duration: requestedDuration,
        aspectRatio: aspectRatio || '16:9',
        settings: comfyui,
      });
      return NextResponse.json({
        taskId: result.taskId,
        status: 'processing',
        provider: 'comfyui',
        workflow: result.workflow,
        continuityMode: motionContext ? 'motion-context' : 'tail-frame',
        videoPrompt: result.prompt,
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
      language === 'en' ? 'en' : 'zh',
      isFilmEnding === true,
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
