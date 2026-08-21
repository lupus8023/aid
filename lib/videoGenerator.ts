import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { buildVideoContinuityRules, getProductionStylePreset } from './promptArchitecture';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds } from './videoSegments';
import { NO_SUBTITLE_POLICY } from './videoTextPolicy';
import { buildAudioManifest, buildNonDiegeticMusic, compileTimedSpeech, storyboardAudioPlan, validateSpeechLanguage } from './speechAudioContract';

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
  const withoutSpeechDirectives = visualLines.join(' ')
    .replace(/(?:无|没有)(?:任何)?其他(?:角色|人物)(?:在场|出现)?[。.!！]?/gi, ' ')
    .replace(/(?:其他|其余|所有|全部)(?:可见)?(?:角色|人物)(?:保持)?(?:沉默|无声|不说话|不发声|闭嘴|闭口)[。.!！]?/gi, ' ')
    .replace(/no\s+other\s+(?:character|characters|person|people)(?:\s+(?:is|are))?\s*(?:present|visible|speaking)?[.!]?/gi, ' ')
    .replace(/(?:other|remaining|all)\s+(?:visible\s+)?(?:characters|people)\s+(?:remain|stay|are)\s+(?:silent|quiet)[.!]?/gi, ' ');
  return compactText(withoutSpeechDirectives, 900);
}

function dialogueLanguage(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u3400-\u9fff]/.test(text)) return 'Chinese';
  return 'English';
}

function nonSpokenPerformanceControl(emotion: string, delivery: string): string {
  const source = `${emotion || ''} ${delivery || ''}`.toLowerCase();
  const emotionCode = /坚定|果断|决心|determined|firm|resolute/.test(source)
    ? 'controlled_determination'
    : /害怕|恐惧|紧张|fear|afraid|tense|anxious/.test(source)
      ? 'contained_tension'
      : /悲|难过|伤心|sad|grief|sorrow/.test(source)
        ? 'restrained_sadness'
        : /愤怒|生气|angry|anger|furious/.test(source)
          ? 'contained_anger'
          : /喜悦|开心|温柔|happy|warm|gentle|joy/.test(source)
            ? 'subtle_warmth'
            : 'restrained_scene_emotion';
  const onsetCode = /停顿|沉默|pause|hesitat/.test(source) ? 'brief_pre_line_pause' : 'direct_onset';
  const paceCode = /快速|急促|fast|quick|urgent/.test(source)
    ? 'brisk_natural_pace'
    : /缓慢|慢速|slow|measured/.test(source)
      ? 'measured_natural_pace'
      : 'natural_pace';
  return `NON_SPOKEN_PERFORMANCE={emotion:${emotionCode},onset:${onsetCode},pace:${paceCode}}`;
}

function officialCameraMotion(storyboard: Storyboard, index: number): string {
  const source = `${storyboard.cameraMove || ''} ${storyboard.description || ''}`.toLowerCase();
  if (/(?:静止|固定|static|locked)/i.test(source)) return 'locked shot through this beat';
  if (/(?:手持|handheld|shoulder)/i.test(source)) return 'restrained handheld track, moderate speed; follow action then settle, no float';
  if (/(?:拉远|拉出|pull out|dolly out|zoom out)/i.test(source)) return 'small moderate pull-out revealing changed spatial state';
  if (/(?:推近|推进|推镜|push in|dolly in|zoom in)/i.test(source)) return 'small moderate push-in landing on decisive reaction';
  if (/(?:左摇|pan left)/i.test(source)) return 'small moderate pan left revealing next information';
  if (/(?:右摇|pan right)/i.test(source)) return 'small moderate pan right revealing next information';
  if (/(?:摇|pan)/i.test(source)) return 'small moderate pan following visible action';
  if (/(?:横移|左移|右移|truck|slide)/i.test(source)) return 'small moderate lateral truck preserving direction and parallax';
  if (/(?:跟|tracking|follow)/i.test(source)) return 'small moderate subject track, settling on consequence';
  if (/(?:升|pedestal up|crane up|tilt up)/i.test(source)) return 'small moderate rise revealing changed vertical relation';
  if (/(?:降|pedestal down|crane down|tilt down)/i.test(source)) return 'small moderate lower move landing on action detail';
  return index === 0
    ? 'small moderate push-in entering on first action, no wait'
    : 'short action-motivated moderate track, then settle on new state';
}

function authoritativeShotAction(storyboard: Storyboard): string {
  return compactText(
    sanitizeVisualDirection(storyboard.action || storyboard.description || storyboard.prompt),
    260,
  );
}

function shotMotionCadence(storyboard: Storyboard): string {
  switch (storyboard.clipType) {
    case 'insert':
    case 'montage':
      return 'brisk real time; immediate change; no hold';
    case 'reaction':
      return 'real-time trigger/reaction; one brief punctuation; no slow motion';
    case 'dialogue':
    case 'performance':
      return 'natural conversational speed; gestures support rather than stretch the line';
    case 'long_take':
      return 'sustained real-time blocking; continuous progress; no slow motion';
    case 'establishing':
      return 'active real-time geography reveal; no empty drift';
    default:
      return 'decisive real time; visible acceleration/contact/direction change; no slow motion';
  }
}

function shotSoundCue(storyboard: Storyboard): string {
  const plan = storyboardAudioPlan(storyboard);
  const environment = plan.environment.length ? plan.environment.join(', ') : 'location room tone';
  const foley = plan.foley.length ? plan.foley.join(', ') : 'only sounds caused by the visible action';
  return `SOUND: env={${environment}}; Foley={${foley}}; people=${plan.backgroundHuman}.`;
}

function cinematicTransition(previous: Storyboard, next: Storyboard): string {
  const previousCharacters = new Set(previous.characters || []);
  const sharedCharacters = (next.characters || []).filter(name => previousCharacters.has(name));
  const previousObjects = new Set(previous.objects || []);
  const sharedObjects = (next.objects || []).filter(name => previousObjects.has(name));
  const explicitContinuity = Boolean(
    next.continuousFromPrev
    || next.continuityFrom === previous.id
    || (next.continuityFrom && next.continuityFrom === `scene-${previous.sceneNumber}`),
  );
  if (explicitContinuity) {
    return 'ACTION-MATCH CUT: cut mid-motion; resume vector, speed, screen direction and physical state';
  }
  if (sharedObjects.length) {
    return `PROP-MATCH CUT on ${sharedObjects[0]}: end on motion/contact; resume its cause or changed state`;
  }
  if (sharedCharacters.length) {
    return `EYELINE/REACTION BRIDGE via ${sharedCharacters[0]}: directed look/gesture motivates next view`;
  }
  if (previous.sequenceId === next.sequenceId && previous.locationId === next.locationId) {
    return 'CUT ON MOTION: foreground crossing hides cut; preserve geography/screen direction';
  }
  return 'MOTIVATED MATCH CUT: shared vector/shape/light/sound cause enters new geography';
}

function shotActionSchedule(storyboard: Storyboard, range: { start: number; end: number }): string {
  const span = Math.max(0.1, range.end - range.start);
  const commitment = range.start + span * 0.62;
  const consequence = range.start + span * 0.84;
  return `ACTION: ${authoritativeShotAction(storyboard)} CADENCE: ${shotMotionCadence(storyboard)} TIMING: initiate ${h3Timestamp(range.start)}; decisive move/contact by ${h3Timestamp(commitment)}; consequence/reaction by ${h3Timestamp(consequence)}; live secondary motion to ${h3Timestamp(range.end)}, never stretch one gesture.`;
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
    language?: 'zh' | 'en';
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
  const speechLanguageError = validateSpeechLanguage(storyboards, options.language);
  if (speechLanguageError) throw new Error(speechLanguageError);
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
      const performance = nonSpokenPerformanceControl(line.emotion, line.delivery);
      return line.lipSync
        ? `${h3Timestamp(line.start)}–${h3Timestamp(line.end)} ${source}; ${performance}; volume=${line.volume}; SPOKEN_WORDS_ONLY=<d>[${dialogueLanguage(text)}] ${text}</d>.`
        : `${h3Timestamp(line.start)}–${h3Timestamp(line.end)} off-screen ${source}; ${performance}; volume=${line.volume}; SPOKEN_WORDS_ONLY=<d>[${dialogueLanguage(text)}] ${text}</d>; all on-screen mouths closed.`;
    }).join(' ');

  const shotDescriptions = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const shotSeconds = Math.max(0.1, range.end - range.start);
    const referenceNumber = index + referenceOffset;
    const beatCharacters = [...new Set(storyboard.characters || [])];
    const cast = beatCharacters.length
      ? `CAST={${beatCharacters.map(name => subjectId.get(name) ? `<Subject ${subjectId.get(name)}> (${name})` : name).join(', ')}}; MULTIPLICITY=one_each.`
      : 'CAST={};';
    const entry = index === 0
      ? options.firstFrameUrl
        ? 'ENTRY: inherited frame already moving; continue momentum, eyeline and camera inertia.'
        : 'ENTRY: start on action; establish geography within one second.'
      : `ENTRY ${h3Timestamp(range.start)}: continue [Shot ${index}] via its motivated cut.`;
    const dialogue = renderDialogue(storyboard, index);
    const pictureAnchor = isFirstLastMode
      ? index === storyboards.length - 1
        ? `<Picture 2> is final composition only. Finish primary action by ${h3Timestamp(range.start + shotSeconds * 0.84)}; use final 16% to resolve into it; do not uniformly interpolate or slow one gesture.`
        : ''
      : `<Picture ${referenceNumber}> starts this shot.`;
    const visualDirection = sanitizeVisualDirection(storyboard.prompt || storyboard.description);
    const actionDirection = authoritativeShotAction(storyboard);
    const visualAnchor = visualDirection && visualDirection !== actionDirection
      ? ` LOOK: ${compactText(visualDirection, 140)}`
      : '';
    const handoff = index < storyboards.length - 1
      ? `TO [Shot ${index + 2}] ${h3Timestamp(range.end)}: ${cinematicTransition(storyboard, storyboards[index + 1])}.`
      : `END ${h3Timestamp(range.end)}: leave motivated motion/eyeline/consequence, never a dead hold.`;
    return `[Shot ${index + 1} | ${h3Timestamp(range.start)}–${h3Timestamp(range.end)} | ${shotSeconds.toFixed(1)}s] ${entry} ${pictureAnchor} ${cast}${(storyboard.objects || []).length ? ` PROPS={${(storyboard.objects || []).join(', ')}}.` : ''} FRAME: ${storyboard.shotSize || 'story-motivated size'}, ${storyboard.angle || 'story-motivated angle'}.${visualAnchor} ${shotActionSchedule(storyboard, range)} CAMERA: ${officialCameraMotion(storyboard, index)} ${dialogue ? `DIALOGUE: ${dialogue}` : 'DIALOGUE: none; mouths non-speaking.'} ${shotSoundCue(storyboard)} ${handoff}`;
  });

  const visualOverride = sanitizeVisualDirection(options.visualOverride);
  const speechGate = timedSpeech.length
    ? 'SPEECH GATE: vocalize only text inside <d>; never speak timing/performance/camera/sound controls.'
    : 'SPEECH GATE: no spoken words or human vocalization.';
  const styleOpening = `${style.h3Direction}${visualOverride ? ` Visual-only override: ${visualOverride} This direction is visual-only.` : ''} ${NO_SUBTITLE_POLICY} ${speechGate} Cuts are physical/cinematic, never fades or dissolves.`;
  const physics = buildVideoContinuityRules(hasVoiceReferences)
    .replace(/\n+/g, ' ')
    .replace(/PHYSICS:|CONSTRAINTS:/g, '')
    .trim();
  // Official H3 format keeps dialogue exclusively inside detailed_description.
  // overall_soundscape contains ambience, Foley and non-verbal human sound only.
  const soundscape = buildAudioManifest(storyboards);
  const nonDiegeticMusic = buildNonDiegeticMusic(storyboards);

  if (isFirstLastMode) {
    return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${duration.toFixed(2)}-second mark of the target video.

integrated_multimodal_description: ${styleOpening} ${shotDescriptions.join(' ')} ${physics}

overall_soundscape: ${soundscape}

non_diegetic_music: ${nonDiegeticMusic}`;
  }

  const pictureDefinitions = [
    ...(options.firstFrameUrl ? ['<Picture 1> is the opening continuity frame inherited from the preceding generated clip and defines the exact state at 0.00 seconds.'] : []),
    ...storyboards.map((storyboard, index) => `<Picture ${index + referenceOffset}> opens [Shot ${index + 1}]: lock identity/wardrobe/location/light; allow action-driven pose/blocking/viewpoint change.`),
  ];
  const subjectDefinitions = characters.map((name, index) => {
    const pictures = storyboards.flatMap((storyboard, storyboardIndex) => storyboard.characters?.includes(name) ? [`<Picture ${storyboardIndex + referenceOffset}>`] : []);
    return `<Subject ${index + 1}> = ${name} in ${pictures.join(', ') || 'references'}; preserve one face/body/hair/wardrobe/accessory identity.`;
  });
  const audioDefinitions = referenceAudioNames.map((name, index) => {
    const subject = subjectId.get(name);
    const speaker = timedSpeech.find(line => line.character === name)?.speakerId;
    return `<Audio ${index + 1}> = timbre only for ${subject ? `<Subject ${subject}>` : name}${speaker ? ` (${speaker})` : ''}, usable only in that scheduled line.`;
  });
  const retention = [
    ...subjectDefinitions.map((_, index) => `<Subject ${index + 1}>: fully_preserved identity/wardrobe across ${storyboards.flatMap((storyboard, shotIndex) => storyboard.characters?.includes(characters[index]) ? [`[Shot ${shotIndex + 1}]`] : []).join(',')}.`),
    ...pictureDefinitions.map((_, index) => `<Picture ${index + 1}>: reference; lock identity/world, not pose/viewpoint.`),
    ...audioDefinitions.map((_, index) => `<Audio ${index + 1}>: timbre reference for its bound speaker only.`),
  ];
  const summaryPictures = storyboards.map((_, index) => `<Picture ${index + referenceOffset}>`).join(', ');

  return `subject_definitions:
${[...subjectDefinitions, ...pictureDefinitions, ...audioDefinitions].join('\n')}

summary:
[${options.firstFrameUrl ? 'keyframe + ' : ''}references${referenceAudioNames.length ? ' + audio' : ''}] ${summaryPictures}; ${storyboards.length} causal shots / ${duration}s / one production world.

retention_analysis:
${retention.join('\n')}

detailed_description:
${styleOpening}
${shotDescriptions.join('\n')}
${physics}

overall_soundscape:
${soundscape}

non_diegetic_music:
${nonDiegeticMusic}`;
}

export function buildStoryboardVideoPrompt(
  storyboard: Storyboard,
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
  language?: 'zh' | 'en',
): string {
  if (storyboard.videoPromptOverride && storyboard.videoPrompt?.trim()) {
    return buildVideoSegmentPrompt([storyboard], characterAudios, {
      firstFrameUrl,
      duration: storyboard.videoDuration,
      hasVoiceReferences: characterAudios.length > 0,
      referenceAudioNames: characterAudios.map(audio => audio.character),
      visualOverride: storyboard.videoPrompt.trim(),
      language,
    });
  }
  return buildVideoSegmentPrompt([storyboard], characterAudios, {
    firstFrameUrl,
    duration: storyboard.videoDuration,
    language,
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
  generateAudio?: boolean,
  language?: 'zh' | 'en',
): Promise<string> {
  // 确保有生成的图片
  if (!storyboard.imageUrl) {
    throw new Error(`Storyboard scene ${storyboard.sceneNumber} does not have a generated image`);
  }

  // Validate imageUrl is a public http/https URL (not base64)
  if (!storyboard.imageUrl.startsWith('http://') && !storyboard.imageUrl.startsWith('https://')) {
    throw new Error(`Scene ${storyboard.sceneNumber} image is not a public URL. Please regenerate the image individually first.`);
  }

  const videoPrompt = buildStoryboardVideoPrompt(storyboard, characterAudios, firstFrameUrl, language);


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
