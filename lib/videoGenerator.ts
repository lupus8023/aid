import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds } from './videoSegments';
import { compileTimedSpeech, storyboardAudioPlan, storyboardSpeech, validateSpeechLanguage } from './speechAudioContract';

function h3Timestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function fitH3PromptBudget(prompt: string): string {
  if (prompt.length <= 7000) return prompt;
  // New prompts are intentionally compact. Only collapse redundant spaces;
  // never truncate an exact <d> line or invent a shortened control contract.
  const fitted = prompt
    .split(/(<d>[\s\S]*?<\/d>)/gi)
    .map(part => /^<d>/i.test(part) ? part : part.replace(/[ \t]{2,}/g, ' '))
    .join('')
    .replace(/\n{3,}/g, '\n\n');
  if (fitted.length <= 7000) return fitted;
  throw new Error(`H3 提示词仍有 ${fitted.length} 字符，超过 7000 字符上限；请拆分该视频片段`);
}

function compactActionArc(value: unknown, limit = 280): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;

  // A video action is an arc, not a synopsis prefix. Plain truncation kept the
  // trigger and discarded the impact/result at the end, so H3 produced a slow
  // setup with no dramatic payoff. Preserve both ends inside the same prompt
  // budget and remove only the middle elaboration.
  const joiner = /[\u3400-\u9fff]/.test(text) ? '；随后' : ' then ';
  const usable = limit - joiner.length;
  const headLimit = Math.floor(usable * 0.58);
  const tailLimit = usable - headLimit;
  const headBoundary = Math.max(
    text.lastIndexOf('. ', headLimit),
    text.lastIndexOf('; ', headLimit),
    text.lastIndexOf(', ', headLimit),
    text.lastIndexOf('，', headLimit),
    text.lastIndexOf('。', headLimit),
  );
  const head = text
    .slice(0, headBoundary > headLimit * 0.55 ? Math.min(headBoundary + 1, headLimit) : headLimit)
    .trim()
    .replace(/[;,，。.]$/, '');
  // Always reserve the tail from the actual end. With repeated long
  // sentences, choosing the next punctuation after an approximate offset can
  // produce an oversized tail; the final prefix slice then deletes the very
  // payoff this helper is meant to preserve.
  let tail = text.slice(-tailLimit).trim().replace(/^[;,，。.]\s*/, '');
  if (/^[A-Za-z0-9]/.test(tail) && text.length > tailLimit) {
    const firstBoundary = tail.search(/[\s,;.]/);
    if (firstBoundary > 0 && firstBoundary < tail.length * 0.25) tail = tail.slice(firstBoundary + 1).trim();
  }
  return `${head}${joiner}${tail}`.trim();
}

function regexpEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeVisualDirection(value: unknown, exactSpokenLines: string[] = []): string {
  const withoutDialogueTags = String(value || '')
    .replace(/<d>[\s\S]*?<\/d>/gi, ' ')
    // H3 has repeatedly vocalized every phrase placed after these screenplay
    // labels. Treat the label as a hard truncation boundary everywhere. Any
    // truly visible outcome must be authored earlier as an ordinary action.
    .replace(/(?:可见后果|画面结果|visible result)\s*[:：][\s\S]*$/i, ' ');
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
    .replace(/\b(?:says?|speaks?|shouts?|yells?|asks?|replies?|answers?|whispers?|murmurs?|utters?|exclaims?)\s*(?:in\s+an?\s+[\w -]+\s+(?:tone|voice))?\s*[:：,，]?\s*[“"'](?:[^”"'\n]|'(?!\s))*[”"']/gi, ' ')
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
    .replace(/\b(?:says?|speaks?|shouts?|yells?|asks?|replies?|answers?|whispers?|murmurs?|utters?|exclaims?)(?=\s|[,.!]|$)/gi, ' ');
  return compactActionArc(withoutSpeechDirectives, 900);
}

function dialogueSafeVisualAction(value: unknown, exactSpokenLines: string[], language: 'zh' | 'en'): string {
  const visual = sanitizeVisualDirection(value, exactSpokenLines);
  if (!visual) return visual;

  // Apply this filter to every shot, including segment-reference shots whose
  // local `speech` is empty.
  // Only camera-observable physical clauses belong in `action`; screenplay
  // meaning and audience interpretation stay upstream.
  const semanticClause = language === 'zh'
    ? /(?:观众|受众|用户|听者|价值|优越性|功效|宣传|依据|意义|观点|结论|真相|信息|认知|疑问|期待|机制|定义为|理解|明白|意识到|认识到|相信|接受|好奇|关注|联想到|联系起来|说明|解释|强调|揭示|告诉|介绍|讲解|表达|传达|总结|概括|归纳)/i
    : /(?:audience|viewer|listener|meaning|core value|product value|benefit|efficacy|promotion|claim|evidence|rationale|message|conclusion|truth|information|understands?|realizes?|learns?|believes?|accepts?|expects?|question|mechanism|becomes? curious|focuses? on|connects?|explains?|emphasizes?|reveals?|tells?|introduces?|describes?|communicates?|establishes? that)/i;
  // Protect common title abbreviations before splitting English sentences so
  // a name such as "Dr. Pan" remains one physical clause.
  const protectedVisual = visual.replace(/\b(Dr|Mr|Mrs|Ms|Prof)\./gi, '$1<NAME_PERIOD>');
  const clauses = protectedVisual
    .split(/(?<=[。！？；;!?])|\.(?=\s+)|\s*[,，]\s*/)
    .map(clause => clause
      .replace(/<NAME_PERIOD>/g, '.')
      .trim()
      .replace(/[,，;；]+$/, ''))
    .filter(Boolean)
    .filter(clause => !semanticClause.test(clause));
  const joined = clauses.join(language === 'zh' ? '，' : ', ')
    .replace(/\s+([。！？.!?；;])/g, '$1')
    .trim();
  return compactActionArc(joined, 260);
}

function dialogueLanguage(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u3400-\u9fff]/.test(text)) return 'Chinese';
  return 'English';
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

type VideoSegmentPromptOptions = {
  firstFrameUrl?: string;
  duration?: number;
  hasVoiceReferences?: boolean;
  referenceAudioNames?: string[];
  visualOverride?: string;
  language?: 'zh' | 'en';
};

function officialVisibleExpression(storyboard: Storyboard): string {
  const source = [
    storyboard.stateBefore?.emotion,
    storyboard.stateAfter?.emotion,
    ...(storyboard.performance || []).flatMap(cue => [cue.expression, cue.gaze, cue.breath, cue.reaction]),
    ...storyboardSpeech(storyboard).flatMap(line => [line.emotion, line.delivery]),
  ].filter(Boolean).join(' ').toLowerCase();
  if (/害怕|恐惧|紧张|fear|afraid|tense|anxious/.test(source)) return 'The breath tightens once; the eyes and brow tense briefly, then release.';
  if (/悲|难过|伤心|sad|grief|sorrow/.test(source)) return 'The lower eyelids tense and the mouth corners tighten slightly, then recover.';
  if (/愤怒|生气|angry|anger|furious/.test(source)) return 'The eyes, brow, and jaw tighten once, then release.';
  if (/喜悦|开心|温柔|happy|warm|gentle|joy/.test(source)) return 'The gaze warms and the mouth corners rise slightly once, then recover.';
  if (/坚定|果断|决心|determined|firm|resolute/.test(source)) return 'The gaze locks once and the jaw steadies, then the tension releases after the action.';
  return 'The gaze and facial tension change once with the action, then recover.';
}

function officialPerformanceDirection(storyboard: Storyboard): string {
  const cues = (storyboard.performance || []).slice(0, 3);
  if (!cues.length) return '';
  return cues.map((cue, index) => {
    const pieces = [cue.blocking, cue.gesture, cue.expression, cue.gaze, cue.breath, cue.reaction]
      .map(value => String(value || '').trim())
      .filter(value => value && !containsHan(value));
    return pieces.length ? `Visible character ${index + 1}: ${pieces.join('; ')}` : '';
  }).filter(Boolean).join(' ');
}

function storyboardCastNames(storyboard: Storyboard): string[] {
  return [...new Set([
    ...(storyboard.characters || []),
    ...(storyboard.performance || []).map(cue => cue.character),
    ...storyboardSpeech(storyboard).map(line => line.character),
  ].map(name => String(name || '').trim()).filter(Boolean))];
}

function officialReferencePriorityLock(storyboards: Storyboard[], isFirstLastMode: boolean): string {
  if (storyboards.length > 1) {
    return 'REFERENCE PRIORITY: Each declared picture is the composition authority for its own shot. Preserve the depicted cast identity, wardrobe, setting topology, material design, lighting direction, lens perspective, and color palette; do not merge identities or redesign one picture from another.';
  }
  const endLock = isFirstLastMode
    ? ' <Picture 2> is the exact required final frame and must be reached without recasting or restyling the subject.'
    : '';
  return `REFERENCE PRIORITY — LOCK to <Picture 1>; DO NOT REDRAW. <Picture 1> is the exact first frame at 00:00.000, not loose style inspiration. Preserve the depicted face and facial geometry, hairline and hairstyle, skin tone and natural skin appearance, body proportions, wardrobe and accessories, object design, environment layout, lighting direction, lens perspective, framing, and color palette throughout. Only the explicitly described physical action, micro-expression, gaze, breathing, camera movement, and physically caused effects may change.${endLock}`;
}

function officialMaterialReality(style: unknown): string {
  if (['anime', '3d-cg', 'stop-motion'].includes(String(style || ''))) return '';
  return 'Maintain photographic material reality: natural skin micro-texture and fine facial detail, physically plausible eye and hair highlights, visible fabric weave and weight, grounded contact shadows, and restrained optical depth. No waxy or plastic skin, beauty-filter smoothing, synthetic hair, warped hands, facial drift, costume mutation, extra people, subtitles, logos, watermarks, or on-screen text.';
}

function officialTemporalPerformance(
  storyboard: Storyboard,
  range: { start: number; end: number },
  picture: string,
): string {
  const span = Math.max(0.5, range.end - range.start);
  const actionStart = range.start + span * 0.22;
  const settleStart = range.start + span * 0.78;
  const subject = storyboardCastNames(storyboard)[0] || 'the main subject';
  return `From ${h3Timestamp(range.start)} to ${h3Timestamp(actionStart)}, the exact appearance and spatial relationships established by ${picture} hold while ${subject} shows only natural breathing, a small eye movement, and subtle muscle tension. From ${h3Timestamp(actionStart)} to ${h3Timestamp(settleStart)}, the described primary action and performance unfold at normal physical speed with continuous weight, contact, and fabric or hair response. From ${h3Timestamp(settleStart)} to ${h3Timestamp(range.end)}, the action resolves into a readable final pose; the gaze and micro-expression retain the shot's emotion without exaggerated acting.`;
}

function officialDialogueDelivery(line: ReturnType<typeof compileTimedSpeech>[number]): string {
  const source = `${line.emotion || ''} ${line.delivery || ''}`.toLowerCase();
  const volume = line.volume === 'raised' ? 'at a controlled raised volume'
    : line.volume === 'soft' ? 'softly'
      : line.volume === 'whisper' ? 'in a restrained whisper'
        : 'at a natural speaking volume';
  const pace = /快速|急促|fast|quick|urgent/.test(source) ? 'a brisk natural conversational pace'
    : /缓慢|慢速|slow|measured/.test(source) ? 'a measured natural conversational pace'
      : 'a natural conversational pace';
  return `${volume}, at ${pace}`;
}

const OFFICIAL_H3_STYLE_OPENING: Record<string, string> = {
  'follow-reference': 'The target video follows the visual medium, lighting, color, texture, and lens behavior of the reference pictures.',
  'cinematic-natural': 'The target video uses natural live-action cinematography with real skin and fabric, practical light, optical depth, and normal-speed movement.',
  'warm-film': 'The target video uses warm photochemical live action with amber practical light, fine grain, gentle halation, and natural movement.',
  'neo-noir': 'The target video uses grounded neo-noir live action with cool shadows, motivated edge light, textured dark areas, and restrained movement.',
  documentary: 'The target video uses observational documentary footage with available light, ordinary contrast, light handheld movement, and natural focus changes.',
  commercial: 'The target video uses polished live-action commercial photography with controlled highlights, clear material texture, and precise hand-to-object contact.',
  anime: 'The target video uses cinematic 2D animation with stable character design, consistent linework, readable poses, and controlled parallax.',
  '3d-cg': 'The target video uses cinematic 3D animation with stable character design, physical materials, weighted movement, and a lens-based virtual camera.',
  'stop-motion': 'The target video uses handmade stop-motion with tactile materials, clear pose changes, practical miniature light, and a tabletop camera.',
};

function containsHan(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function firstEnglishActionFromImagePrompt(storyboard: Storyboard, exactLines: string[]): string {
  const cleaned = sanitizeVisualDirection(storyboard.prompt, exactLines)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(?:SUBJECT|ACTION|CAMERA|COMPOSITION|FOCUS|LIGHT|EXPOSURE|COLOR|MATERIAL)\s*[:：]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || containsHan(cleaned)) return '';
  const sentences = cleaned
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof)\./gi, '$1<NAME_PERIOD>')
    .split(/(?<=[!?])\s+|\.(?=\s+[A-Z])/)
    .map(sentence => sentence.replace(/<NAME_PERIOD>/g, '.').trim())
    .filter(Boolean);
  return compactActionArc(sentences[0] || cleaned, 320);
}

function officialH3PhysicalAction(storyboard: Storyboard, primarySubject: string): string {
  const exactLines = storyboardSpeech(storyboard).map(line => line.exactLine);
  const authored = dialogueSafeVisualAction(
    storyboard.action || storyboard.description,
    exactLines,
    containsHan(String(storyboard.action || storyboard.description || '')) ? 'zh' : 'en',
  );
  if (authored && !containsHan(authored)) return compactActionArc(authored, 320);
  const imageAction = firstEnglishActionFromImagePrompt(storyboard, exactLines);
  if (imageAction) return imageAction;
  const target = primarySubject || 'The main subject';
  if (storyboard.clipType === 'reaction') return `${target} changes gaze and expression once in response to the preceding action`;
  if (storyboard.clipType === 'action') return `${target} completes one clear physical action with the principal object`;
  return `${target} makes one natural gesture and shifts attention toward the principal object`;
}

function officialH3CameraSentence(storyboard: Storyboard, index: number): string {
  const source = `${storyboard.cameraMove || ''} ${storyboard.description || ''}`.toLowerCase();
  if (/(?:静止|固定|static|locked)/i.test(source)) return 'The camera holds a static shot.';
  if (/(?:手持|handheld|shoulder)/i.test(source)) return 'The camera follows the action with restrained handheld movement and settles with the subject.';
  if (/(?:拉远|拉出|pull out|dolly out|zoom out)/i.test(source)) return 'The camera pulls out with small amplitude at slow speed.';
  if (/(?:推近|推进|推镜|push in|dolly in|zoom in)/i.test(source)) return 'The camera pushes in with small amplitude at slow speed toward the subject.';
  if (/(?:左摇|pan left)/i.test(source)) return 'The camera pans left with small amplitude to follow the action.';
  if (/(?:右摇|pan right)/i.test(source)) return 'The camera pans right with small amplitude to follow the action.';
  if (/(?:摇|pan)/i.test(source)) return 'The camera pans with small amplitude to follow the action.';
  if (/(?:横移|左移|右移|truck|slide)/i.test(source)) return 'The camera trucks laterally with the subject and preserves the direction of movement.';
  if (/(?:跟|tracking|follow)/i.test(source)) return 'The camera tracks the subject at normal speed and settles on the completed action.';
  if (/(?:升|pedestal up|crane up|tilt up)/i.test(source)) return 'The camera rises with small amplitude to reveal the upper part of the space.';
  if (/(?:降|pedestal down|crane down|tilt down)/i.test(source)) return 'The camera lowers with small amplitude toward the action detail.';
  if (storyboard.clipType === 'insert') return 'The camera holds a stable detail shot and changes focus once.';
  if (storyboard.clipType === 'reaction') return 'The camera pushes in briefly toward the changed expression.';
  if (storyboard.clipType === 'dialogue' || storyboard.clipType === 'performance') return 'The camera remains mostly static and makes one small movement with the performance.';
  if (storyboard.clipType === 'long_take') return 'The camera tracks the blocking continuously at normal speed.';
  return index === 0
    ? 'The camera follows the action at normal speed and settles on its final position.'
    : 'The camera makes one short movement with the action and settles.';
}

function officialH3Soundscape(storyboards: Storyboard[]): string {
  const plans = storyboards.map(storyboardAudioPlan);
  const environment = [...new Set(plans.flatMap(plan => plan.environment))].slice(0, 4);
  const foley = [...new Set(plans.flatMap(plan => plan.foley))].slice(0, 4);
  const sentences = [
    environment.length
      ? `${environment.join(', ')} form the continuous location ambience.`
      : 'A quiet natural location room tone continues throughout the video.',
    foley.length
      ? `${foley.join(', ')} accompany their matching physical actions.`
      : '',
    plans.some(plan => plan.backgroundHuman === 'indistinct_nonverbal')
      ? 'A low indistinct crowd murmur remains in the background.'
      : '',
  ].filter(Boolean);
  return sentences.join(' ');
}

function officialH3Music(storyboards: Storyboard[]): string {
  const music = [...new Set(storyboards.map(storyboard => storyboardAudioPlan(storyboard).music).filter(value => value && value !== 'none'))];
  return music.length ? `The non-diegetic score uses ${music.join('; ')}.` : 'N/A';
}

/**
 * Fresh H3 contract based on MiniMax's official h3-prompt-writing guide.
 * Direction is English, dialogue is the only original-language text, and no
 * instruction tells the model how to stop, stay silent, or fill a speech slot.
 */
function buildOfficialGuidePrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: VideoSegmentPromptOptions = {},
): string {
  const first = storyboards[0];
  if (!first) throw new Error('视频片段至少需要一个分镜');
  const duration = Math.min(15, Math.max(4, options.duration || estimateVideoSegmentSeconds(storyboards)));
  const timeline = allocateSegmentTimeline(storyboards, duration);
  const timedSpeech = compileTimedSpeech(storyboards, timeline);
  const speechLanguageError = validateSpeechLanguage(storyboards, options.language);
  if (speechLanguageError) throw new Error(speechLanguageError);

  // Older storyboards can omit a name from `characters` while still carrying
  // actor direction for that person. Build the visible cast from every
  // authoritative channel so the prompt never describes an unbound face.
  const characters = [...new Set(storyboards.flatMap(storyboardCastNames))];
  const referenceAudioNames = (options.referenceAudioNames?.length
    ? options.referenceAudioNames
    : characterAudios.map(audio => audio.character)).filter(Boolean).slice(0, 3);
  const subjectId = new Map(characters.map((name, index) => [name, index + 1]));
  const audioId = new Map(referenceAudioNames.map((name, index) => [name, index + 1]));
  const speakerCharacters = [...new Set(timedSpeech.map(line => line.character))];
  const speakerId = new Map(speakerCharacters.map((name, index) => [name, index + 1]));
  const isFirstLastMode = Boolean(options.firstFrameUrl && storyboards.length === 1);
  const hasContinuityReference = Boolean(options.firstFrameUrl && !isFirstLastMode);
  const storyboardPictureOrdinal = (index: number) => index + (hasContinuityReference ? 2 : 1);
  const useSubjectLabels = !isFirstLastMode;
  const exactLines = timedSpeech.map(line => line.exactLine);

  const dialogueByShot = new Map<number, string[]>();
  for (const line of timedSpeech) {
    const subject = subjectId.get(line.character);
    const audio = audioId.get(line.character);
    const localSpeaker = speakerId.get(line.character) || 1;
    const speaker = useSubjectLabels && subject
      ? `<Subject ${subject}> (S${localSpeaker})`
      : `${line.character} (S${localSpeaker})`;
    const voiceReference = audio ? ` using the voice timbre referenced from <Audio ${audio}>` : '';
    const tagged = `<d>[${dialogueLanguage(line.exactLine)}] ${line.exactLine}</d>`;
    const sentence = `At ${h3Timestamp(line.start)}, ${speaker} begins speaking${voiceReference} ${officialDialogueDelivery(line)}: ${tagged}`;
    const lines = dialogueByShot.get(line.storyboardIndex) || [];
    lines.push(sentence);
    dialogueByShot.set(line.storyboardIndex, lines);
  }

  const shotParagraphs = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const pictureOrdinal = storyboardPictureOrdinal(index);
    const picture = `<Picture ${pictureOrdinal}>`;
    const cast = storyboardCastNames(storyboard).map(name => {
      const id = subjectId.get(name);
      return useSubjectLabels && id ? `<Subject ${id}>` : name;
    });
    const primarySubject = cast[0] || 'The main subject';
    const action = officialH3PhysicalAction(storyboard, primarySubject);
    const framing = officialShotFraming(storyboard);
    const expression = officialVisibleExpression(storyboard);
    const performance = officialPerformanceDirection(storyboard);
    const camera = officialH3CameraSentence(storyboard, index);
    const dialogue = (dialogueByShot.get(index) || []).join(' ');
    let opening: string;
    if (index === 0 && isFirstLastMode) {
      opening = '[Shot 1] The shot begins from <Picture 1>.';
    } else if (index === 0 && hasContinuityReference) {
      opening = `[Shot 1] The video opens from <Picture 1> and follows ${picture} as the composition reference.`;
    } else if (index === 0) {
      opening = `[Shot 1] The shot follows ${picture} as its composition reference.`;
    } else {
      opening = `[Shot ${index + 1}] At ${h3Timestamp(range.start)}, the camera cuts to the composition referenced by ${picture}.`;
    }
    const castSentence = cast.length ? `A ${framing} frames ${cast.join(cast.length > 1 ? ' and ' : '')}.` : `A ${framing} frames the action.`;
    const endFrameLanding = isFirstLastMode
      ? 'The movement reaches the pose and composition in <Picture 2> at the end of the shot.'
      : '';
    return [
      opening,
      castSentence,
      /[.!?]$/.test(action) ? action : `${action}.`,
      performance,
      expression,
      officialTemporalPerformance(storyboard, range, picture),
      camera,
      'The established positions and eyelines remain consistent.',
      dialogue,
      endFrameLanding,
    ].filter(Boolean).join(' ');
  });

  const style = OFFICIAL_H3_STYLE_OPENING[String(first.visualStyle || 'cinematic-natural')]
    || OFFICIAL_H3_STYLE_OPENING['cinematic-natural'];
  const visualOverride = sanitizeVisualDirection(options.visualOverride, exactLines);
  const englishVisualOverride = visualOverride && !containsHan(visualOverride)
    && !/(?:subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)\s*:/i.test(visualOverride)
      ? compactActionArc(visualOverride, 360)
      : '';
  const detailed = [
    officialReferencePriorityLock(storyboards, isFirstLastMode),
    style,
    officialMaterialReality(first.visualStyle),
    'The photographic frame remains clean and text-free.',
    timedSpeech.length
      ? 'SCRIPT DIALOGUE LOCK: Every <d> line is screenplay-authoritative. Reproduce every word in order exactly as written; do not paraphrase, shorten, translate, add, repeat, or substitute dialogue.'
      : '',
    englishVisualOverride,
    ...shotParagraphs,
  ].filter(Boolean).join('\n');
  const soundscape = officialH3Soundscape(storyboards);
  const music = officialH3Music(storyboards);

  if (isFirstLastMode) {
    const alignment = `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${duration.toFixed(2)}-second mark of the target video.`;
    return fitH3PromptBudget(`${alignment}\n\nintegrated_multimodal_description: ${detailed}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`);
  }

  const subjectDefinitions = characters.map((name, index) => {
    const ordinals = storyboards.flatMap((storyboard, storyboardIndex) => storyboardCastNames(storyboard).includes(name)
      ? [storyboardPictureOrdinal(storyboardIndex)]
      : []);
    if (hasContinuityReference && storyboardCastNames(storyboards[0]).includes(name)) ordinals.unshift(1);
    const pictures = [...new Set(ordinals)].map(ordinal => `<Picture ${ordinal}>`).join(', ');
    return `<Subject ${index + 1}> is ${name} in ${pictures || 'the reference pictures'}.`;
  });
  const pictureDefinitions = [
    ...(hasContinuityReference ? ['<Picture 1> is the opening continuity frame for [Shot 1].'] : []),
    ...storyboards.map((_, index) => `<Picture ${storyboardPictureOrdinal(index)}> is the composition reference for [Shot ${index + 1}].`),
  ];
  const audioDefinitions = referenceAudioNames.map((name, index) => {
    const subject = subjectId.get(name);
    const speaker = speakerId.get(name);
    return `<Audio ${index + 1}> is the voice-timbre reference for ${subject ? `<Subject ${subject}>` : name}${speaker ? ` (S${speaker})` : ''}.`;
  });
  const taskTypes = [storyboards.length === 1 ? 'locked-first-frame image-to-video' : 'keyframe completion', ...(referenceAudioNames.length ? ['audio reference'] : [])];
  const summary = `[${taskTypes.join(' + ')}] The target video contains ${storyboards.length} sequential shot${storyboards.length === 1 ? '' : 's'} built from the declared picture references${referenceAudioNames.length ? ' and voice-timbre references' : ''}.`;
  const retention = [
    ...characters.map((name, index) => `<Subject ${index + 1}> (appears in ${storyboards
      .map((storyboard, storyboardIndex) => storyboardCastNames(storyboard).includes(name) ? `[Shot ${storyboardIndex + 1}]` : '')
      .filter(Boolean).join(', ')}): fully_preserved - identity and wardrobe remain consistent.`),
    ...(hasContinuityReference ? ['<Picture 1> ([Shot 1] opening frame): fully_preserved - its composition anchors the opening.'] : []),
    ...storyboards.map((_, index) => `<Picture ${storyboardPictureOrdinal(index)}> ([Shot ${index + 1}] composition): fully_preserved - its subject placement, setting, and lighting guide the shot.`),
    ...referenceAudioNames.map((name, index) => `<Audio ${index + 1}>: reference - its voice timbre guides ${subjectId.get(name) ? `<Subject ${subjectId.get(name)}>` : name}${speakerId.get(name) ? ` (S${speakerId.get(name)})` : ''}.`),
  ];
  const prompt = `subject_definitions:\n${[...subjectDefinitions, ...pictureDefinitions, ...audioDefinitions].join('\n')}\n\nsummary:\n${summary}\n\nretention_analysis:\n${retention.join('\n')}\n\ndetailed_description:\n${detailed}\n\noverall_soundscape:\n${soundscape}\n\nnon_diegetic_music:\n${music}`;
  return fitH3PromptBudget(prompt);
}

export function buildVideoSegmentPrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: VideoSegmentPromptOptions = {},
): string {
  return buildOfficialGuidePrompt(storyboards, characterAudios, options);
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
