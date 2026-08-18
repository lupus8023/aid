import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { buildVideoContinuityRules, buildVideoStyleContract, getProductionStylePreset } from './promptArchitecture';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds } from './videoSegments';
import { enforceNoSubtitles, NO_SUBTITLE_POLICY } from './videoTextPolicy';

function h3Timestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function compactText(value: unknown, limit = 220): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf(' ', limit - 1);
  return `${text.slice(0, cut > limit * 0.65 ? cut : limit).trim()}.`;
}

function dialogueLanguage(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u3400-\u9fff]/.test(text)) return 'Chinese';
  return 'English';
}

function beatRole(index: number, total: number): string {
  const roles = total === 1
    ? ['setup, escalation and payoff inside one continuous action']
    : total === 2
      ? ['setup and trigger', 'consequence and payoff']
      : total === 3
        ? ['setup and dramatic question', 'escalation and turn', 'consequence and emotional landing']
        : ['setup and dramatic question', 'pressure and complication', 'turn or reveal', 'consequence and emotional landing'];
  return roles[index] || 'story advancement';
}

export function buildVideoSegmentPrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: {
    firstFrameUrl?: string;
    duration?: number;
    hasVoiceReferences?: boolean;
    referenceAudioNames?: string[];
  } = {},
): string {
  const first = storyboards[0];
  if (!first) throw new Error('视频片段至少需要一个分镜');
  const duration = Math.min(15, Math.max(4, options.duration || estimateVideoSegmentSeconds(storyboards)));
  const timeline = allocateSegmentTimeline(storyboards, duration);
  const characters = [...new Set(storyboards.flatMap(storyboard => storyboard.characters || []))];
  const objects = [...new Set(storyboards.flatMap(storyboard => storyboard.objects || []))];
  const isFirstLastMode = Boolean(options.firstFrameUrl && storyboards.length === 1);
  const referenceOffset = options.firstFrameUrl ? 2 : 1;
  const style = getProductionStylePreset(first.visualStyle);
  const dialogueFor = (storyboard: Storyboard) => storyboard.dialogueLines?.length
    ? storyboard.dialogueLines
    : Object.entries(storyboard.dialogue || {}).map(([character, text]) => ({ character, text }));
  const dialogueLines = storyboards.flatMap(dialogueFor).filter(line => String(line.text || '').trim());
  const referenceAudioNames = (options.referenceAudioNames?.length
    ? options.referenceAudioNames
    : characterAudios.map(audio => audio.character)).filter(Boolean).slice(0, 3);
  const hasVoiceReferences = options.hasVoiceReferences || referenceAudioNames.length > 0;
  const speakerNames = [...new Set(dialogueLines.map(line => String(line.character || '').trim()).filter(Boolean))];
  const speakerId = new Map(speakerNames.map((name, index) => [name, `S${index + 1}`]));
  const subjectId = new Map(characters.map((name, index) => [name, index + 1]));

  const renderDialogue = (storyboard: Storyboard) => dialogueFor(storyboard)
    .filter(line => String(line.text || '').trim())
    .map(line => {
      const name = String(line.character || '').trim();
      const text = String(line.text || '').trim();
      const id = speakerId.get(name) || 'S1';
      const subject = subjectId.get(name);
      const source = subject ? `<Subject ${subject}> (${id})` : `${name || 'The on-screen speaker'} (${id})`;
      return `${source} delivers the scripted line once in a natural, scene-appropriate voice: <d>[${dialogueLanguage(text)}] ${text}</d>.`;
    }).join(' ');

  const shotDescriptions = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const referenceNumber = index + referenceOffset;
    const beatCharacters = [...new Set(storyboard.characters || [])];
    const cast = beatCharacters.length
      ? `Visible cast: ${beatCharacters.map(name => `${name}, one stable instance`).join('; ')}.`
      : 'The location remains visually unoccupied.';
    const transition = index === 0
      ? options.firstFrameUrl
        ? 'The opening frame is already in motion; body momentum, camera inertia, eyeline and secondary motion continue immediately.'
        : 'The shot enters on an active visual fact and establishes geography within the first second.'
      : `At ${h3Timestamp(range.start)}, the camera ${storyboard.transition === 'fade' ? 'fades' : storyboard.transition === 'dissolve' ? 'cross-dissolves' : 'cuts on action'} to this setup. It begins as the direct visible consequence of [Shot ${index}] and preserves screen direction, spatial geography and emotional pressure.`;
    const dialogue = renderDialogue(storyboard);
    const pictureAnchor = isFirstLastMode
      ? index === storyboards.length - 1
        ? `The action progressively converges on <Picture 2> as the exact final frame at ${duration.toFixed(2)} seconds.`
        : ''
      : `<Picture ${referenceNumber}> supplies this shot's identity, wardrobe, location, lighting and composition reference.`;
    return `${index === 0 ? `[Shot 1]` : `[Shot ${index + 1}]`} ${transition} ${pictureAnchor} This shot performs the ${beatRole(index, storyboards.length)}. ${cast}${objects.length ? ` Stable props: ${objects.join(', ')}.` : ''} ${compactText(storyboard.description || storyboard.prompt)} Concrete eye-line, weight, contact and reaction make one dominant action change the scene state. Motivated camera movement creates readable parallax and ends on a distinct action, reaction or reveal before ${h3Timestamp(range.end)}. ${dialogue || 'Faces remain in natural non-speaking performance; ambience and visible-action Foley carry the beat.'}`;
  });

  const styleOpening = `DIRECTING STYLE: ${style.h3Direction} ${NO_SUBTITLE_POLICY}`;
  const physics = buildVideoContinuityRules(hasVoiceReferences)
    .replace(/\n+/g, ' ')
    .replace(/PHYSICS:|CONSTRAINTS:/g, '')
    .trim();
  const soundscape = dialogueLines.length
    ? `${style.sound} Perspective-correct ambience remains continuous under the scene. Footsteps, fabric, impacts and object contact occur only when visibly caused, with dialogue synchronized to the speaking character.`
    : `${style.sound} Perspective-correct ambience remains continuous under the scene. Footsteps, fabric, impacts and object contact occur only when visibly caused; faces remain in natural non-speaking performance.`;

  if (isFirstLastMode) {
    return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${duration.toFixed(2)}-second mark of the target video.

integrated_multimodal_description: ${styleOpening} ${shotDescriptions.join(' ')} ${physics}

overall_soundscape: ${soundscape}

non_diegetic_music: N/A`;
  }

  const pictureDefinitions = [
    ...(options.firstFrameUrl ? ['<Picture 1> is the opening continuity frame inherited from the preceding generated clip and defines the exact state at 0.00 seconds.'] : []),
    ...storyboards.map((storyboard, index) => `<Picture ${index + referenceOffset}> is the storyboard and production reference for [Shot ${index + 1}], defining composition, subject placement, identity, wardrobe, location and lighting.`),
  ];
  const subjectDefinitions = characters.map((name, index) => `<Subject ${index + 1}> is ${name}, one stable on-screen identity defined by the storyboard pictures.`);
  const audioDefinitions = referenceAudioNames.map((name, index) => {
    const subject = subjectId.get(name);
    const speaker = speakerId.get(name);
    return `<Audio ${index + 1}> is the voice-timbre and delivery reference for ${subject ? `<Subject ${subject}>` : name}${speaker ? ` (${speaker})` : ''}; its signal supplies vocal identity rather than spoken wording.`;
  });
  const retention = [
    ...subjectDefinitions.map((_, index) => `<Subject ${index + 1}>: fully_preserved - identity and wardrobe stay stable wherever visible.`),
    ...pictureDefinitions.map((_, index) => `<Picture ${index + 1}>: fully_preserved - the corresponding shot follows its production and composition anchor.`),
    ...audioDefinitions.map((_, index) => `<Audio ${index + 1}>: reference - timbre guides the matching scripted speaker.`),
  ];
  const summaryPictures = storyboards.map((_, index) => `<Picture ${index + referenceOffset}>`).join(', ');

  return `subject_definitions:
${[...subjectDefinitions, ...pictureDefinitions, ...audioDefinitions].join('\n')}

summary:
[reference generation${referenceAudioNames.length ? ' + audio reference' : ''}] A ${duration}-second feature-film passage uses ${summaryPictures} to stage ${storyboards.length} causally connected shot${storyboards.length > 1 ? 's' : ''}. The sequence establishes a dramatic question, advances it through visible action and reaction, and lands on a decisive final state while preserving one production world.

retention_analysis:
${retention.join('\n')}

detailed_description:
${styleOpening}
${shotDescriptions.join('\n')}
${physics}

overall_soundscape:
${soundscape}

non_diegetic_music:
N/A`;
}

export function buildStoryboardVideoPrompt(
  storyboard: Storyboard,
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
): string {
  if (storyboard.videoPromptOverride && storyboard.videoPrompt?.trim()) {
    return enforceNoSubtitles(`${storyboard.videoPrompt.trim()}\n\n${buildVideoStyleContract(storyboard.visualStyle)}\n\n${buildVideoContinuityRules(characterAudios.length > 0)}`);
  }
  return buildVideoSegmentPrompt([storyboard], characterAudios, {
    firstFrameUrl,
    duration: storyboard.videoDuration,
  });
}

// 为单个分镜生成视频
export async function generateStoryboardVideo(
  storyboard: Storyboard,
  apiKey: string,
  model: string = 'sora-2',
  aspectRatio: '16:9' | '9:16' = '16:9',
  audioFiles: string[] = [],
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
  generateAudio?: boolean
): Promise<string> {
  // 确保有生成的图片
  if (!storyboard.imageUrl) {
    throw new Error(`Storyboard scene ${storyboard.sceneNumber} does not have a generated image`);
  }

  // Validate imageUrl is a public http/https URL (not base64)
  if (!storyboard.imageUrl.startsWith('http://') && !storyboard.imageUrl.startsWith('https://')) {
    throw new Error(`Scene ${storyboard.sceneNumber} image is not a public URL. Please regenerate the image individually first.`);
  }

  const videoPrompt = buildStoryboardVideoPrompt(storyboard, characterAudios, firstFrameUrl);


  console.log(`Creating video task for storyboard scene ${storyboard.sceneNumber}`);
  console.log(`Mode: Image-to-Video`);
  console.log(`Video prompt: ${videoPrompt}`);
  console.log(`Reference image: ${storyboard.imageUrl}`);
  console.log(`Using model: ${model}`);

  const isGrokImagine = model.toLowerCase().includes('grok-imagine');

  // firstFrameUrl = last frame of previous shot's video (Cloudinary so_last)
  const imageRoles = firstFrameUrl
    ? [{ url: firstFrameUrl, role: 'first_frame' as const }, { url: storyboard.imageUrl!, role: 'last_frame' as const }]
    : undefined;

  const taskId = await createVideoTask(
    videoPrompt,
    imageRoles ? [] : [storyboard.imageUrl!],
    apiKey,
    model,
    aspectRatio,
    {
      duration: storyboard.videoDuration,
      quality: isGrokImagine ? '480p' : undefined,
      // Don't pass audio when using firstFrame/lastFrame continuity mode (API limitation)
      audioUrls: firstFrameUrl ? [] : audioFiles,
      generateAudio: !firstFrameUrl && generateAudio,
      imageRoles
    }
  );

  console.log(`Video task created successfully, task ID: ${taskId}`);
  return taskId;
}

// 轮询检查视频任务状态，直到完成
export async function waitForVideoGeneration(
  taskId: string,
  apiKey: string,
  maxAttempts: number = 120, // 视频生成通常需要更长时间
  intervalMs: number = 5000 // 每5秒检查一次
): Promise<string> {
  console.log(`Starting to poll video task ${taskId}, max attempts: ${maxAttempts}, interval: ${intervalMs}ms`);

  for (let i = 0; i < maxAttempts; i++) {
    const status = await getVideoTaskStatus(taskId, apiKey);
    console.log(`Attempt ${i + 1}/${maxAttempts} - Video task ${taskId} status:`, status.status);

    if (status.status === 'completed' && status.result?.videos?.[0]?.url) {
      console.log(`Video task ${taskId} completed successfully, video URL:`, status.result.videos[0].url);
      return status.result.videos[0].url;
    }

    if (status.status === 'failed') {
      console.error(`Video task ${taskId} failed:`, status);
      throw new Error('Video generation failed');
    }

    // 等待后再次检查
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.error(`Video task ${taskId} timeout after ${maxAttempts} attempts (${maxAttempts * intervalMs / 1000} seconds)`);
  throw new Error('Video generation timeout');
}
