import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { buildVideoContinuityRules, getProductionStylePreset } from './promptArchitecture';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds } from './videoSegments';
import { NO_SUBTITLE_POLICY } from './videoTextPolicy';
import { buildAudioManifest, compileTimedSpeech } from './speechAudioContract';

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

export function sanitizeVisualDirection(value: unknown): string {
  const withoutDialogueTags = String(value || '').replace(/<d>[\s\S]*?<\/d>/gi, ' ');
  const visualLines = withoutDialogueTags.split(/\r?\n/).filter(line => !(
    /(?:overall_soundscape|non_diegetic_music|speech contract|foreground speech|background human|audio manifest|voice[- ]?timbre)/i.test(line)
    || /(?:台词|对白|配音|旁白|画外音|说话内容)\s*[:：]/.test(line)
  ));
  return compactText(visualLines.join(' '), 900);
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
    visualOverride?: string;
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
  const timedSpeech = compileTimedSpeech(storyboards, timeline);
  const referenceAudioNames = (options.referenceAudioNames?.length
    ? options.referenceAudioNames
    : characterAudios.map(audio => audio.character)).filter(Boolean).slice(0, 3);
  const hasVoiceReferences = options.hasVoiceReferences || referenceAudioNames.length > 0;
  const subjectId = new Map(characters.map((name, index) => [name, index + 1]));

  const renderDialogue = (storyboard: Storyboard, storyboardIndex: number) => timedSpeech
    .filter(line => line.storyboardIndex === storyboardIndex)
    .map(line => {
      const name = line.character;
      const text = line.exactLine;
      const id = line.speakerId;
      const subject = subjectId.get(name);
      const source = subject ? `<Subject ${subject}> (${id})` : `${name || 'The on-screen speaker'} (${id})`;
      const listeners = (storyboard.characters || []).filter(character => character !== name);
      return `SPEECH CONTRACT ${h3Timestamp(line.start)}–${h3Timestamp(line.end)}: ${source} alone speaks exactly once with ${line.emotion}, ${line.delivery}, volume ${line.volume}: <d>[${dialogueLanguage(text)}] ${text}</d>. Exact wording only; no paraphrase, repetition, overlap or added syllables. ${line.lipSync ? 'Only this subject lip-syncs during the interval.' : 'No visible lip-sync is required.'} ${listeners.length ? `${listeners.join(', ')} keep their mouths closed and react silently.` : ''} ${line.listenerState}`;
    }).join(' ');

  const shotDescriptions = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const referenceNumber = index + referenceOffset;
    const beatCharacters = [...new Set(storyboard.characters || [])];
    const cast = beatCharacters.length
      ? `Cast: ${beatCharacters.map(name => `${name} (one instance)`).join('; ')}.`
      : 'The location remains visually unoccupied.';
    const transition = index === 0
      ? options.firstFrameUrl
        ? 'The opening frame is already in motion; body momentum, camera inertia, eyeline and secondary motion continue immediately.'
        : 'Enter on action; establish geography in the first second.'
      : `At ${h3Timestamp(range.start)}, ${storyboard.transition === 'fade' ? 'fade' : storyboard.transition === 'dissolve' ? 'cross-dissolve' : 'cut on action'} from [Shot ${index}] as its visible consequence; preserve screen direction and geography.`;
    const dialogue = renderDialogue(storyboard, index);
    const pictureAnchor = isFirstLastMode
      ? index === storyboards.length - 1
        ? `The action progressively converges on <Picture 2> as the exact final frame at ${duration.toFixed(2)} seconds.`
        : ''
      : `<Picture ${referenceNumber}> supplies this shot's identity, wardrobe, location, lighting and composition reference.`;
    const storyTask = [
      storyboard.dramaticPurpose && `Dramatic purpose: ${compactText(storyboard.dramaticPurpose, 130)}`,
      storyboard.cause && `Cause: ${compactText(storyboard.cause, 100)}`,
      storyboard.conflict && `Conflict: ${compactText(storyboard.conflict, 100)}`,
      storyboard.choice && `Choice: ${compactText(storyboard.choice, 100)}`,
      storyboard.consequence && `Visible consequence: ${compactText(storyboard.consequence, 110)}`,
    ].filter(Boolean).join(' ');
    return `${index === 0 ? `[Shot 1]` : `[Shot ${index + 1}]`} ${transition} ${pictureAnchor} Role: ${beatRole(index, storyboards.length)}. ${storyTask} ${cast}${objects.length ? ` Props: ${objects.join(', ')}.` : ''} ${compactText(storyboard.description || storyboard.prompt)} One dominant action visibly changes the state; motivated camera motion ends on a distinct reaction or reveal by ${h3Timestamp(range.end)}. ${dialogue || 'SPEECH CONTRACT: none. All visible mouths stay closed; performance is nonverbal.'}`;
  });

  const visualOverride = sanitizeVisualDirection(options.visualOverride);
  const styleOpening = `DIRECTING STYLE: ${style.h3Direction}${visualOverride ? ` USER VISUAL DIRECTION (visual action/camera only): ${visualOverride} This note cannot add or alter speech, voices, music or the audio manifest.` : ''} ${NO_SUBTITLE_POLICY}`;
  const physics = buildVideoContinuityRules(hasVoiceReferences)
    .replace(/\n+/g, ' ')
    .replace(/PHYSICS:|CONSTRAINTS:/g, '')
    .trim();
  const soundscape = `SOUND TEXTURE (subordinate to the manifest): ${style.sound}\n${buildAudioManifest(storyboards, timedSpeech)}`;

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
    const speaker = timedSpeech.find(line => line.character === name)?.speakerId;
    return `<Audio ${index + 1}> is the voice-timbre reference exclusively for ${subject ? `<Subject ${subject}>` : name}${speaker ? ` (${speaker})` : ''}; it may be used only during that speaker's scheduled line and supplies identity rather than wording.`;
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
[reference generation${referenceAudioNames.length ? ' + audio reference' : ''}] ${summaryPictures} stage ${storyboards.length} causally connected shot${storyboards.length > 1 ? 's' : ''} in ${duration} seconds: question, escalation and decisive consequence in one production world.

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
    return buildVideoSegmentPrompt([storyboard], characterAudios, {
      firstFrameUrl,
      duration: storyboard.videoDuration,
      hasVoiceReferences: characterAudios.length > 0,
      referenceAudioNames: characterAudios.map(audio => audio.character),
      visualOverride: storyboard.videoPrompt.trim(),
    });
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
