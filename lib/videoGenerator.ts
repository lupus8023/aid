import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { buildVideoContinuityRules, getProductionStylePreset } from './promptArchitecture';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds } from './videoSegments';
import { NO_SUBTITLE_POLICY } from './videoTextPolicy';
import { buildAudioManifest, buildNonDiegeticMusic, compileTimedSpeech, storyboardAudioPlan, storyboardSpeech, validateSpeechLanguage } from './speechAudioContract';

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

function regexpEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeVisualDirection(value: unknown, exactSpokenLines: string[] = []): string {
  const withoutDialogueTags = String(value || '').replace(/<d>[\s\S]*?<\/d>/gi, ' ');
  const visualLines = withoutDialogueTags.split(/\r?\n/).filter(line => !(
    /(?:overall_soundscape|non_diegetic_music|speech contract|speech gate|spoken_words_only|non_spoken_performance|foreground speech|background human|audio manifest|voice[- ]?timbre)/i.test(line)
    || /(?:台词|对白|配音|旁白|画外音|说话内容)\s*[:：]/.test(line)
    || /^\s*(?:dialogue|subject_definitions|retention_analysis)\s*:/i.test(line)
  ));
  let withoutSpeechDirectives = visualLines.join(' ')
    // Director/image descriptions frequently repeat a line as part of a
    // visible-action sentence (e.g. 喘息着喊：“不能停！”). H3 treats that as
    // another vocal event even when the authoritative line also appears in
    // <d>. Remove quoted speech and its speech verb from every visual channel.
    .replace(/(?:喘息(?:着)?|停顿后|迟疑后|低声|轻声|大声|坚定地|急促地|缓慢地|平静地|愤怒地|哭着|笑着)?\s*(?:说|说道|喊|喊道|叫|叫道|问|问道|回答|答道|低语|耳语|喃喃|念|吼|吼道|尖叫|开口)\s*[:：,，]?\s*[“"'](?:[^”"'\n]|'(?!\s))*[”"']/gi, ' ')
    .replace(/(?:says?|speaks?|shouts?|yells?|asks?|replies?|answers?|whispers?|murmurs?|utters?|exclaims?)\s*(?:in\s+an?\s+[\w -]+\s+(?:tone|voice))?\s*[:：,，]?\s*[“"'](?:[^”"'\n]|'(?!\s))*[”"']/gi, ' ')
    .replace(/[“"]\s*[^”"\n]{1,240}\s*[”"]/g, ' ')
    .replace(/(?:无|没有)(?:任何)?其他(?:角色|人物)(?:在场|出现)?[。.!！]?/gi, ' ')
    .replace(/(?:其他|其余|所有|全部)(?:可见)?(?:角色|人物)(?:保持)?(?:沉默|无声|不说话|不发声|闭嘴|闭口)[。.!！]?/gi, ' ')
    .replace(/no\s+other\s+(?:character|characters|person|people)(?:\s+(?:is|are))?\s*(?:present|visible|speaking)?[.!]?/gi, ' ')
    .replace(/(?:other|remaining|all)\s+(?:visible\s+)?(?:characters|people)\s+(?:remain|stay|are)\s+(?:silent|quiet)[.!]?/gi, ' ');
  for (const line of exactSpokenLines.map(text => String(text || '').trim()).filter(Boolean)) {
    withoutSpeechDirectives = withoutSpeechDirectives.replace(new RegExp(regexpEscape(line), 'gi'), ' ');
  }
  withoutSpeechDirectives = withoutSpeechDirectives
    .replace(/(?:喘息(?:着)?|停顿后|迟疑后|低声|轻声|大声|坚定地|急促地|缓慢地|平静地|愤怒地|哭着|笑着)?\s*(?:说|说道|喊|喊道|叫|叫道|问|问道|回答|答道|低语|耳语|喃喃|念|吼|吼道|尖叫|开口)(?=\s|[，,。.!！]|$)/gi, ' ')
    .replace(/(?:says?|speaks?|shouts?|yells?|asks?|replies?|answers?|whispers?|murmurs?|utters?|exclaims?)(?=\s|[,.!]|$)/gi, ' ');
  return compactText(withoutSpeechDirectives, 900);
}

function sanitizeNarrativeDirection(value: unknown, exactSpokenLines: string[] = []): string {
  let text = String(value || '')
    .replace(/<d>[\s\S]*?<\/d>/gi, ' ')
    .replace(/[“"]\s*[^”"\n]{1,240}\s*[”"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const line of exactSpokenLines.map(item => String(item || '').trim()).filter(Boolean)) {
    text = text.replace(new RegExp(regexpEscape(line), 'gi'), ' ');
  }
  return compactText(text.replace(/\s+/g, ' ').trim(), 900);
}

function dialogueLanguage(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u3400-\u9fff]/.test(text)) return 'Chinese';
  return 'English';
}

function nonSpokenPerformanceControl(emotion: string, delivery: string): string {
  const source = `${emotion || ''} ${delivery || ''}`.toLowerCase();
  const emotionPhrase = /坚定|果断|决心|determined|firm|resolute/.test(source)
    ? 'restrained determination'
    : /害怕|恐惧|紧张|fear|afraid|tense|anxious/.test(source)
      ? 'contained tension'
      : /悲|难过|伤心|sad|grief|sorrow/.test(source)
        ? 'restrained sadness'
        : /愤怒|生气|angry|anger|furious/.test(source)
          ? 'contained anger'
          : /喜悦|开心|温柔|happy|warm|gentle|joy/.test(source)
            ? 'subtle warmth'
            : 'restrained scene emotion';
  const onsetPhrase = /停顿|沉默|pause|hesitat/.test(source) ? 'after one brief natural pause' : 'with a direct natural onset';
  const pacePhrase = /快速|急促|fast|quick|urgent/.test(source)
    ? 'at a brisk conversational pace'
    : /缓慢|慢速|slow|measured/.test(source)
      ? 'at a measured conversational pace'
      : 'at a natural conversational pace';
  return `${emotionPhrase}, ${onsetPhrase}, ${pacePhrase}`;
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
  switch (storyboard.clipType) {
    case 'establishing':
      return 'one purposeful lateral or vertical reveal that establishes geography within one second, then settles';
    case 'insert':
      return 'a stable detail view with one brief reframing or focus landing, no floating drift';
    case 'reaction':
      return 'one short restrained push-in landing on the changed expression, then stable';
    case 'dialogue':
    case 'performance':
      return 'a mostly stable relational frame with one slight action-motivated arc or push, never continuous drift';
    case 'action':
      return 'a moderate subject track that preserves speed and screen direction through the decisive contact';
    case 'montage':
      return 'one brief decisive pan or reframe that lands with the action beat';
    case 'long_take':
      return 'one continuous blocking-led track with clear geography and steady real-time progress';
    default:
      return index === 0
        ? 'a moderate action-led track; start in motion and settle on the result'
        : 'one short action-led track, settling on the changed state';
  }
}

function authoritativeShotAction(storyboard: Storyboard): string {
  const spokenLines = storyboardSpeech(storyboard).map(line => line.exactLine);
  return compactText(
    // The screenplay action owns what happens. The image prompt is only a
    // static visual anchor and must never replace causal action.
    sanitizeVisualDirection(storyboard.action || storyboard.prompt || storyboard.description, spokenLines),
    260,
  );
}

function officialShotFraming(storyboard: Storyboard): string {
  const framing = `${storyboard.shotSize || ''} ${storyboard.angle || ''}`.toLowerCase();
  const size = /大特写|extreme close/.test(framing) ? 'extreme close-up'
    : /特写|close/.test(framing) ? 'close-up'
      : /近景|medium close/.test(framing) ? 'medium close-up'
        : /中景|medium/.test(framing) ? 'medium shot'
          : /全景|full shot/.test(framing) ? 'full shot'
            : /远景|wide|long shot/.test(framing) ? 'wide shot'
              : 'story-motivated framing';
  const angle = /仰|low angle/.test(framing) ? 'from a low angle'
    : /俯|top|high angle/.test(framing) ? 'from a high angle'
      : /过肩|over.?shoulder/.test(framing) ? 'over the shoulder'
        : /fpv|主观/.test(framing) ? 'from the character point of view'
          : 'at a natural eye-level angle';
  return `${size} ${angle}`;
}

function shotMotionCadence(storyboard: Storyboard): string {
  switch (storyboard.clipType) {
    case 'insert':
    case 'montage':
      return 'brisk real time; enter on action, accelerate into one clear hit, then a short readable settle; no slow motion';
    case 'reaction':
      return 'real-time trigger and reaction; one brief readable punctuation, then move on; no slow motion';
    case 'dialogue':
    case 'performance':
      return 'natural conversational speed; gestures support rather than stretch the line; no empty pause';
    case 'long_take':
      return 'sustained real-time blocking with changing pressure and continuous progress; no slow motion';
    case 'establishing':
      return 'active real-time geography reveal that lands on the story subject; no empty drift';
    default:
      return 'decisive real time; accelerate into impact or decision, briefly settle; no slow motion';
  }
}

function shotSoundCue(storyboard: Storyboard): string {
  const plan = storyboardAudioPlan(storyboard);
  const environment = plan.environment.length ? plan.environment.join(', ') : 'location room tone';
  const foley = plan.foley.length ? plan.foley.join(', ') : 'only sounds caused by the visible action';
  const humanLayer = plan.backgroundHuman === 'indistinct_nonverbal'
    ? 'Background people contribute only an indistinct nonverbal presence.'
    : '';
  if (!plan.environment.length && !plan.foley.length && !humanLayer) {
    return 'Only visibly caused contacts produce restrained synchronized Foley.';
  }
  return `The audible layer is ${environment}, with ${foley} synchronized to visible causes. ${humanLayer}`.trim();
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
    return 'an action-match cut inside the movement, preserving vector, speed, screen direction and physical state';
  }
  const role = String(next.montageRole || '').toLowerCase();
  if (/(?:contrast|对照)/.test(role)) {
    return 'using a contrast cut whose changed action, scale or value creates a new meaning while the story question remains continuous';
  }
  if (/(?:parallel|平行)/.test(role)) {
    return 'matching simultaneous action, direction or caused sound so the two situations read as one parallel dramatic idea';
  }
  if ((previous.consequence || previous.nextCause) && next.cause) {
    return 'a causal cut from the visible consequence directly into the next physical trigger';
  }
  if (sharedObjects.length) {
    return `matching the motion or contact of ${sharedObjects[0]} to its changed state`;
  }
  if (sharedCharacters.length) {
    return `an eyeline or gesture match led by ${sharedCharacters[0]}, preserving screen direction`;
  }
  if (previous.sequenceId === next.sequenceId && previous.locationId === next.locationId) {
    return previous.sceneNumber % 2 === 0
      ? 'a foreground-occlusion cut hidden inside one crossing body or prop, preserving geography and speed'
      : 'a focus-relay cut: the outgoing subject leaves the focus plane as the next subject becomes sharp in matching geography';
  }
  return 'one match cut carried by a shared vector, shape, motivated light change, or visibly caused sound into the new geography';
}

function shotActionSchedule(storyboard: Storyboard, range: { start: number; end: number }): string {
  const span = Math.max(0.1, range.end - range.start);
  const commitment = range.start + span * 0.62;
  const consequence = range.start + span * 0.84;
  // Keep detailed_description observable and playable. Abstract cause/pressure/
  // choice prose used to repeat the screenplay in several explanatory
  // sentences; Ref2VA occasionally vocalized those sentences as narration.
  // The authoritative action already contains the causal beat, so only send
  // the physical performance and its timing here.
  return `${authoritativeShotAction(storyboard)} The action begins immediately at ${h3Timestamp(range.start)}; its decisive move or contact lands by ${h3Timestamp(commitment)}, the visible consequence arrives by ${h3Timestamp(consequence)}, and secondary motion remains alive through ${h3Timestamp(range.end)}. The cadence is ${shotMotionCadence(storyboard)}`;
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
  const speechEventCount = timedSpeech.length;
  const speechControl = speechEventCount
    ? `No narrator or ad-lib exists. Exactly ${speechEventCount} intelligible vocal event${speechEventCount === 1 ? '' : 's'} occur: only the tagged dialogue line${speechEventCount === 1 ? '' : 's'} below, once each. Other prose is silent direction; never vocalize or mouth it.`
    : 'No narrator, dialogue, singing, ad-lib, or intelligible human vocalization exists. All prose below is silent visual direction.';

  const renderDialogue = (storyboard: Storyboard, storyboardIndex: number) => timedSpeech
    .filter(line => line.storyboardIndex === storyboardIndex)
    .map(line => {
      const name = line.character;
      const text = line.exactLine;
      const id = line.speakerId;
      const subject = subjectId.get(name);
      const source = subject ? `<Subject ${subject}> (${id})` : `${name || 'The on-screen speaker'} (${id})`;
      const performance = nonSpokenPerformanceControl(line.emotion, line.delivery);
      const volume = line.volume === 'raised' ? 'at a raised but controlled volume'
        : line.volume === 'soft' ? 'softly'
          : line.volume === 'whisper' ? 'in a restrained whisper'
            : 'at a natural speaking volume';
      return line.lipSync
        ? `From ${h3Timestamp(line.start)} to ${h3Timestamp(line.end)}, ${source} delivers one synchronized line with ${performance}, ${volume}: <d>[${dialogueLanguage(text)}] ${text}</d>.`
        : `From ${h3Timestamp(line.start)} to ${h3Timestamp(line.end)}, the off-screen voice of ${source} delivers one line with ${performance}, ${volume}: <d>[${dialogueLanguage(text)}] ${text}</d>.`;
    }).join(' ');

  const shotDescriptions = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const shotSeconds = Math.max(0.1, range.end - range.start);
    const referenceNumber = index + referenceOffset;
    const beatCharacters = [...new Set(storyboard.characters || [])];
    const cast = beatCharacters.length
      ? `Visible cast, each exactly once: ${beatCharacters.map(name => subjectId.get(name) ? `<Subject ${subjectId.get(name)}> (${name})` : name).join(', ')}; no other story identity.`
      : 'No story character is visible in this shot.';
    const entry = index === 0
      ? options.firstFrameUrl
        ? 'The inherited opening frame is already moving; continue its momentum, eyeline and camera inertia.'
        : 'Start directly on visible action and establish the necessary geography within one second.'
      : `Continue from [Shot ${index}] through its motivated physical transition.`;
    const dialogue = renderDialogue(storyboard, index);
    const pictureAnchor = isFirstLastMode
      ? index === storyboards.length - 1
        ? `<Picture 2> is final composition only. Finish primary action by ${h3Timestamp(range.start + shotSeconds * 0.84)}; use final 16% to resolve into it; do not uniformly interpolate or slow one gesture.`
        : ''
      : `<Picture ${referenceNumber}> starts this shot.`;
    const spokenLines = storyboardSpeech(storyboard).map(line => line.exactLine);
    const visualDirection = sanitizeVisualDirection(storyboard.prompt || storyboard.description, spokenLines);
    const actionDirection = authoritativeShotAction(storyboard);
    const visualAnchor = visualDirection && visualDirection !== actionDirection
      ? ` LOOK: ${compactText(visualDirection, 140)}`
      : '';
    const handoff = index < storyboards.length - 1
      ? `At ${h3Timestamp(range.end)}, move into [Shot ${index + 2}] by ${cinematicTransition(storyboard, storyboards[index + 1])}.`
      : `By ${h3Timestamp(range.end)}, leave a motivated motion, eyeline or consequence rather than a dead hold.`;
    const shotHeader = index === 0 ? '[Shot 1]' : `[Shot ${index + 1}] At ${h3Timestamp(range.start)},`;
    const props = (storyboard.objects || []).length
      ? `The visible story props are ${(storyboard.objects || []).join(', ')}.`
      : '';
    return `${shotHeader} ${entry} ${pictureAnchor} ${cast} ${props} Use ${officialShotFraming(storyboard)}.${visualAnchor} ${shotActionSchedule(storyboard, range)} The camera uses ${officialCameraMotion(storyboard, index)}. ${dialogue} ${shotSoundCue(storyboard)} ${handoff}`;
  });

  const visualOverride = sanitizeVisualDirection(options.visualOverride, timedSpeech.map(line => line.exactLine));
  const styleOpening = `${style.h3Direction}${visualOverride ? ` Visual-only override: ${visualOverride} This direction is visual-only.` : ''} ${NO_SUBTITLE_POLICY} Cuts are physical and motivated, never fades or dissolves.`;
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

integrated_multimodal_description: ${styleOpening} ${speechControl} ${shotDescriptions.join(' ')} ${physics}

overall_soundscape: ${soundscape}

non_diegetic_music: ${nonDiegeticMusic}`;
  }

  const pictureDefinitions = [
    ...(options.firstFrameUrl ? ['<Picture 1> is the opening continuity frame inherited from the preceding generated clip and defines the exact state at 0.00 seconds.'] : []),
    ...storyboards.map((storyboard, index) => `<Picture ${index + referenceOffset}> starts [Shot ${index + 1}]; preserve identity/wardrobe/location/light, not pose or viewpoint.`),
  ];
  const subjectDefinitions = characters.map((name, index) => {
    const pictures = storyboards.flatMap((storyboard, storyboardIndex) => storyboard.characters?.includes(name) ? [`<Picture ${storyboardIndex + referenceOffset}>`] : []);
    return `<Subject ${index + 1}> = ${name} in ${pictures.join(', ') || 'references'}; preserve one face/body/hair/wardrobe/accessory identity.`;
  });
  const audioDefinitions = referenceAudioNames.map((name, index) => {
    const subject = subjectId.get(name);
    const speaker = timedSpeech.find(line => line.character === name)?.speakerId;
    return `<Audio ${index + 1}> is a voice-timbre reference for ${subject ? `<Subject ${subject}>` : name}${speaker ? ` (${speaker})` : ''}; it is not copied as a soundtrack and cannot add words, narration, or continuous speech.`;
  });
  const retention = [
    ...subjectDefinitions.map((_, index) => `<Subject ${index + 1}>: fully_preserved identity/wardrobe across ${storyboards.flatMap((storyboard, shotIndex) => storyboard.characters?.includes(characters[index]) ? [`[Shot ${shotIndex + 1}]`] : []).join(',')}.`),
    ...pictureDefinitions.map((_, index) => `<Picture ${index + 1}>: reference; lock identity/world, not pose/viewpoint.`),
    ...audioDefinitions.map((_, index) => `<Audio ${index + 1}>: reference - voice timbre for its bound scheduled speaker only; no source wording or continuous vocal track is copied.`),
  ];
  const summaryPictures = storyboards.map((_, index) => `<Picture ${index + referenceOffset}>`).join(', ');

  return `subject_definitions:
${[...subjectDefinitions, ...pictureDefinitions, ...audioDefinitions].join('\n')}

summary:
[${options.firstFrameUrl ? 'keyframe + ' : ''}references${referenceAudioNames.length ? ' + audio' : ''}] ${summaryPictures}; ${storyboards.length} causal shots / ${duration}s / one production world; ${speechEventCount ? `${speechEventCount} scheduled dialogue event${speechEventCount === 1 ? '' : 's'} and no other voice` : 'no human voice'}.

retention_analysis:
${retention.join('\n')}

detailed_description:
${styleOpening}
${speechControl}
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
