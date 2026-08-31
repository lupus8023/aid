import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { allocateSegmentTimeline, cinematicEditKind, estimateVideoSegmentSeconds } from './videoSegments';
import { compileTimedSpeech, storyboardAudioPlan, storyboardSpeech, validateSpeechLanguage } from './speechAudioContract';
import { buildVideoCapturePresetContract, isObservationalCapturePreset } from './capturePresets';
import { currentVideoDirection, videoDirectionEntityNames } from './videoDirection';
import { FILM_ENDING_SECONDS } from './filmEnding';

function h3Timestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

export const H3_PROMPT_MAX_CHARACTERS = 7000;

function fitH3PromptBudget(prompt: string): string {
  if (prompt.length <= H3_PROMPT_MAX_CHARACTERS) return prompt;
  // Dialogue tags are the screenplay authority. Compact only repeated prose
  // around them; never truncate or rewrite an exact <d> line.
  let fitted = prompt
    .split(/(<d>[\s\S]*?<\/d>)/gi)
    .map(part => /^<d>/i.test(part) ? part : part.replace(/[ \t]{2,}/g, ' '))
    .join('')
    .replace(/\n{3,}/g, '\n\n');
  if (fitted.length <= H3_PROMPT_MAX_CHARACTERS) return fitted;

  // Ref2VA's retention section used to restate every subject/picture binding
  // already declared above and every identity/composition lock declared below.
  // One lossless global rule carries the same instruction at a fraction of the
  // budget, leaving room for the shot actions, expressions and exact dialogue.
  fitted = fitted.replace(
    /retention_analysis:\n[\s\S]*?\n\ndetailed_description:/i,
    'retention_analysis:\nPreserve declared identities, wardrobes, settings and bound audio timbres. Picture composition anchors each shot opening; the authored camera path controls its evolution.\n\ndetailed_description:',
  );
  fitted = fitted
    .split(/(<d>[\s\S]*?<\/d>)/gi)
    .map(part => /^<d>/i.test(part) ? part : part
      .replace(/The established positions and eyelines remain consistent\.\s*/g, '')
      .replace(/[ \t]{2,}/g, ' '))
    .join('')
    .replace(/\n{3,}/g, '\n\n');
  if (fitted.length <= H3_PROMPT_MAX_CHARACTERS) return fitted;

  fitted = fitted.replace(
    /EDITORIAL GRAMMAR: Treat every picture as a separate photographed setup\.[\s\S]*?(?=\n(?:SCRIPT DIALOGUE LOCK:|\[Shot 1\]))/i,
    'EDITORIAL GRAMMAR: Treat every picture as a separate photographed setup. Use motivated hard cuts; preserve axis, eyelines, screen direction, action phase, and geography; do not crossfade, morph, interpolate, repeat, or soften a hard cut.\n',
  );
  if (fitted.length <= H3_PROMPT_MAX_CHARACTERS) return fitted;

  throw new Error(`H3 提示词压缩后仍有 ${fitted.length} 字符，超过 ${H3_PROMPT_MAX_CHARACTERS} 字符上限；该片段的逐字台词或演员任务过多，请拆分片段`);
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
    .replace(/(?:other|remaining|all)\s+(?:visible\s+)?(?:characters|people)\s+(?:remain|stay|are)\s+(?:silent|quiet)[.!]?/gi, ' ')
    // Visual prose that merely compares a mouth or reaction to speech can
    // become an unintended native-H3 vocal event. Dialogue lives exclusively
    // in authoritative <d> tags, so remove these ambiguous pseudo-speech cues.
    .replace(/[^。！？.!?]*(?:自言自语|像(?:是|在|要)?说话|像(?:是|在)?说了[^。！？.!?]*|嘴唇[^。！？.!?]*(?:话|对白|发声)|听见[^。！？.!?]*(?:声音|动静)|似乎听到)[^。！？.!?]*[。！？.!]?/gi, ' ')
    .replace(/[^.!?]*(?:talks? to (?:herself|himself|themself)|as if (?:she|he|they|the subject) (?:is|were|was about to be) speaking|mouths? (?:half a )?(?:word|sentence)|hears? (?:a|the|some) (?:sound|noise))[^.!?]*[.!]?/gi, ' ');
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
  isFilmEnding?: boolean;
  firstFrameUrl?: string;
  duration?: number;
  hasVoiceReferences?: boolean;
  referenceAudioNames?: string[];
  visualOverride?: string;
  language?: 'zh' | 'en';
  voiceProfiles?: Record<string, string>;
};

function officialVisibleExpression(storyboard: Storyboard): string {
  if (!storyboard.characters?.length && !storyboard.performance?.length) return '';
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

function officialPerformanceDirection(storyboard: Storyboard, segmentShotCount: number): string {
  const cues = (storyboard.performance || []).slice(0, 3);
  if (!cues.length) return '';
  // A four-picture segment previously expanded six verbose actor fields for
  // every visible character in every shot, producing 12k+ character prompts.
  // Budget the same observable direction by dramatic priority. The primary
  // actor receives the largest share; supporting actors retain their visible
  // expression/reaction instead of disappearing from the prompt.
  const totalBudget = segmentShotCount > 1 ? 320 : 760;
  const primaryBudget = cues.length === 1 ? totalBudget : Math.ceil(totalBudget * 0.52);
  const supportingBudget = cues.length > 1
    ? Math.floor((totalBudget - primaryBudget) / (cues.length - 1))
    : totalBudget;
  return cues.map((cue, index) => {
    const pieces = [
      cue.blocking,
      cue.expression,
      cue.reaction,
      cue.gaze,
      cue.gesture,
      cue.breath,
    ].map(value => String(value || '').replace(/\s+/g, ' ').trim())
      .filter(value => value && !containsHan(value));
    if (!pieces.length) return '';
    const character = String(cue.character || '').trim();
    const label = character ? `${character}: ` : `Visible character ${index + 1}: `;
    return `${label}${compactActionArc(pieces.join('; '), index === 0 ? primaryBudget : supportingBudget)}`;
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
    return 'REFERENCE PRIORITY: Each declared picture is the composition authority for its own discrete shot opening. Preserve identity, wardrobe, setting topology, materials, lighting and palette. Framing, perspective, parallax, focus and occlusion may evolve continuously with the authored motion; never morph between pictures or merge identities.';
  }
  const endLock = isFirstLastMode
    ? ' <Picture 2> is the exact required final frame and must be reached without recasting or restyling the subject.'
    : '';
  return `REFERENCE PRIORITY — LOCK to <Picture 1>; DO NOT REDRAW. <Picture 1> is the exact first frame at 00:00.000, not loose style inspiration. Preserve face, hair, skin, body proportions, wardrobe, object design, setting topology, lighting direction and color palette. Only the explicitly described physical action, micro-expression, gaze, breathing, camera movement, and physically caused effects may change. Framing, perspective, parallax, focus and occlusion may evolve continuously along the authored camera path; retain the lens unless a zoom is specified.${endLock}`;
}

function officialMaterialReality(style: unknown): string {
  if (['anime', '3d-cg', 'stop-motion'].includes(String(style || ''))) return '';
  return 'Maintain photographic material reality: natural skin micro-texture and fine facial detail, physically plausible eye and hair highlights, visible fabric weave and weight, grounded contact shadows, and restrained optical depth. No waxy or plastic skin, beauty-filter smoothing, synthetic hair, warped hands, facial drift, costume mutation, extra people, subtitles, logos, watermarks, or on-screen text.';
}

function officialTemporalPerformance(
  storyboard: Storyboard,
  range: { start: number; end: number },
  picture: string,
  segmentShotCount: number,
): string {
  const span = Math.max(0.5, range.end - range.start);
  const actionStart = range.start + span * 0.22;
  const settleStart = range.start + span * 0.78;
  if (segmentShotCount > 1) {
    return isObservationalCapturePreset(storyboard.capturePreset)
      ? `From ${h3Timestamp(range.start)} to ${h3Timestamp(actionStart)}, continue ${picture}'s task; from ${h3Timestamp(actionStart)} to ${h3Timestamp(settleStart)}, the trigger causes one delayed response, eyes or weight lead, one adjustment may remain unfinished; from ${h3Timestamp(settleStart)} to ${h3Timestamp(range.end)}, keep residual low activity, then return attention or change state.`
      : `From ${h3Timestamp(range.start)} to ${h3Timestamp(actionStart)}, continue ${picture}'s action; from ${h3Timestamp(actionStart)} to ${h3Timestamp(settleStart)}, one trigger creates the weighted peak; from ${h3Timestamp(settleStart)} to ${h3Timestamp(range.end)}, keep residual motion and partial recovery, never a pose.`;
  }
  if (isObservationalCapturePreset(storyboard.capturePreset)) {
    return `From ${h3Timestamp(range.start)} to ${h3Timestamp(actionStart)}, continue the low-intensity task in ${picture}, not a pose. From ${h3Timestamp(actionStart)} to ${h3Timestamp(settleStart)}, the authored trigger causes one delayed weighted response; eyes or weight lead the head or hand, and one adjustment may pause unfinished. From ${h3Timestamp(settleStart)} to ${h3Timestamp(range.end)}, keep residual motion, brief low activity, then return attention or enter the authored next state.`;
  }
  return `From ${h3Timestamp(range.start)} to ${h3Timestamp(actionStart)}, continue the low-intensity action in ${picture}, not a presentation pose. From ${h3Timestamp(actionStart)} to ${h3Timestamp(settleStart)}, the authored trigger produces one weighted action peak. From ${h3Timestamp(settleStart)} to ${h3Timestamp(range.end)}, preserve residual motion and partial recovery instead of freezing.`;
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

function replaceChineseEntityNames(value: string, storyboard: Storyboard): string {
  return videoDirectionEntityNames(storyboard).reduce((text, name) => {
    if (!containsHan(name)) return text;
    const index = storyboardCastNames(storyboard).indexOf(name);
    return text.replaceAll(name, index >= 0 ? `the character ${index + 1}` : 'the referenced object');
  }, value);
}

function firstEnglishActionFromImagePrompt(storyboard: Storyboard, exactLines: string[]): string {
  const cleaned = sanitizeVisualDirection(replaceChineseEntityNames(storyboard.prompt, storyboard), exactLines)
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
    replaceChineseEntityNames(storyboard.action || storyboard.description || '', storyboard),
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
  const authored = sanitizeVisualDirection(storyboard.cameraMove).trim();
  const source = (authored || storyboard.description || '').toLowerCase();
  if (storyboard.capturePreset === 'surveillance') return 'The fixed high camera never follows, reframes, focuses, or anticipates.';
  if (storyboard.capturePreset === 'broadcast-candid' || storyboard.capturePreset === 'news-telephoto') return 'The remote camera reacts only after movement begins, with one late small reframe or focus recovery.';
  if (storyboard.capturePreset === 'documentary-follow') return 'The handheld operator reacts after movement begins with one small corrective reframe.';
  if (storyboard.capturePreset === 'phone-bystander') return 'The phone reacts after movement begins with one late handheld reframe or autofocus recovery.';
  if (storyboard.capturePreset === 'home-video') return 'The familiar camera holder follows a beat late with one casual handheld correction.';
  // Do not replace a complete legacy camera instruction with a keyword-based
  // "small slow push"; in particular a locked camera can still rack focus.
  if (authored && !containsHan(authored) && authored.length <= 180 && /[.!?]$/.test(authored)) return authored;
  if (/(?:移焦|拉焦|rack focus|focus pull)/i.test(source)) return 'With the camera locked, transfer focus once between the authored depth planes at the action cue.';
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

function officialH3EditSentence(
  previous: Storyboard,
  current: Storyboard,
  shotNumber: number,
  start: number,
  picture: string,
): string {
  const prefix = `[Shot ${shotNumber}] At ${h3Timestamp(start)},`;
  if (previous.transition === 'dissolve') return `${prefix} a restrained dissolve carries the resolved movement into the composition referenced by ${picture}, with no identity or costume blending.`;
  if (previous.transition === 'fade') return `${prefix} fade briefly through black, then reveal the composition referenced by ${picture} as a new dramatic beat.`;
  if (previous.transition === 'wipe') return `${prefix} a motivated foreground wipe reveals the composition referenced by ${picture} while preserving screen direction.`;

  const kind = cinematicEditKind(previous, current);
  const instruction: Record<ReturnType<typeof cinematicEditKind>, string> = {
    'dialogue-reverse': `cut on the conversational turn to the composition referenced by ${picture}, creating a shot/reverse-shot response; preserve the shared eyeline, 180-degree axis, screen direction, and listener timing`,
    'action-reaction': `cut on the completed physical action to the composition referenced by ${picture}; the reaction begins immediately from that impact while eyeline and screen direction remain continuous`,
    'detail-insert': `cut on the hand, gaze, or object movement to the composition referenced by ${picture} as a precise detail insert; preserve hand-to-object position and match the action across the cut`,
    'insert-return': `cut back from the detail to the composition referenced by ${picture}; resume the same action and eyeline from the exact moment established by the insert`,
    'establish-develop': `cut from the spatial master to the composition referenced by ${picture}; move into closer dramatic coverage without reversing the established screen axis`,
    'rhythmic-montage': `use a clean rhythmic hard cut to the composition referenced by ${picture}; connect the shots through matched movement, shape, or sound rather than visual morphing`,
    'match-continuity': `cut on matched action, gaze, shape, or sound to the composition referenced by ${picture}; preserve motion phase, screen direction, and physical continuity across the edit`,
    'progressive-coverage': `cut in along the established eyeline or object axis to the composition referenced by ${picture}; the closer coverage reveals new dramatic information without repeating the previous shot`,
    'motivated-transition': `make a motivated hard cut to the composition referenced by ${picture}; the outgoing action, object, or sound bridges into the new space while each setting remains visually distinct`,
    'direct-cut': `make a clean hard cut to the composition referenced by ${picture}; begin on a changed action phase or framing scale and preserve spatial orientation`,
  };
  return `${prefix} ${instruction[kind]}.`;
}

function officialH3Soundscape(storyboards: Storyboard[]): string {
  const plans = storyboards.map(storyboardAudioPlan);
  if (plans.every(plan => !plan.environment.length && !plan.foley.length && plan.backgroundHuman !== 'indistinct_nonverbal')) {
    return 'Natural location ambience stays clearly audible beneath dialogue and through pauses, steady within each setting. Respect intentional silence.';
  }
  // A segment can cross locations. Flattening all plans and taking the first
  // four sounds erased later shots' ambience and played early Foley everywhere.
  // Keep each sound attached to the same shot as its visible source.
  const shots = plans.map((plan, index) => {
    return [
      `[Shot ${index + 1}] Location bed: ${plan.environment.length ? plan.environment.join('; ') : 'natural ambience matching the visible setting'}.`,
      plan.foley.length ? `Action Foley: ${plan.foley.join('; ')}.` : '',
      plan.backgroundHuman === 'indistinct_nonverbal'
        ? 'Background people form an indistinct, wordless murmur.'
        : '',
    ].filter(Boolean).join(' ');
  });
  return [
    'Keep specified ambience clearly audible beneath dialogue; retain it through speech pauses. Respect intentional silence. Keep the bed steady across same-location cuts and change it with the location. Foley follows visible actions.',
    ...shots,
  ].join('\n');
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
    const rawVoiceProfile = !audio
      ? String(options.voiceProfiles?.[line.character] || '').replace(/[\r\n]+/g, ' ').trim()
      : '';
    // MiniMax's official H3 prompt format keeps direction in English and only
    // places the actual spoken language inside <d>. Never leak a Chinese cast
    // note into the surrounding direction: native audio can vocalize it.
    const voiceProfile = rawVoiceProfile && !/[\u3400-\u9fff]/.test(rawVoiceProfile)
      ? ` in the consistent voice style: ${rawVoiceProfile}`
      : '';
    const tagged = `<d>[${dialogueLanguage(line.exactLine)}] ${line.exactLine}</d>`;
    const sentence = `At ${h3Timestamp(line.start)}, ${speaker} begins speaking${voiceReference}${voiceProfile} ${officialDialogueDelivery(line)}: ${tagged}`;
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
    const directed = currentVideoDirection(storyboard);
    // These four compact fields were authored and validated together. Never
    // splice them, replace them with a still-image sentence, or add a second
    // generic acting/timing instruction that competes with the authored event.
    const bind = (value: string) => characters
      .map((name, index) => ({ name, label: useSubjectLabels ? `<Subject ${index + 1}>` : name }))
      .sort((a, b) => b.name.length - a.name.length)
      .reduce((text, { name, label }) => containsHan(name) ? text.replaceAll(name, label) : text, value);
    const action = directed ? bind(directed.action) : officialH3PhysicalAction(storyboard, primarySubject);
    const framing = officialShotFraming(storyboard);
    const performance = directed ? '' : officialPerformanceDirection(storyboard, storyboards.length);
    // Detailed performance cues already include the authored facial change.
    // Adding a second generic expression sentence consumed prompt budget and
    // sometimes gave H3 two competing acting instructions for the same beat.
    const expression = directed || performance ? '' : officialVisibleExpression(storyboard);
    const camera = directed ? bind(directed.camera) : officialH3CameraSentence(storyboard, index);
    const dialogue = (dialogueByShot.get(index) || []).join(' ');
    let opening: string;
    if (index === 0 && isFirstLastMode) {
      opening = '[Shot 1] The shot begins from <Picture 1>.';
    } else if (index === 0 && hasContinuityReference) {
      opening = `[Shot 1] The video opens from <Picture 1> and follows ${picture} as the composition reference.`;
    } else if (index === 0) {
      opening = `[Shot 1] The shot follows ${picture} as its composition reference.`;
    } else {
      opening = officialH3EditSentence(storyboards[index - 1], storyboard, index + 1, range.start, picture);
    }
    const castSentence = cast.length ? `A ${framing} frames ${cast.join(cast.length > 1 ? ' and ' : '')}.` : `A ${framing} frames the action.`;
    const endFrameLanding = isFirstLastMode
      ? 'The movement reaches the pose and composition in <Picture 2> at the end of the shot.'
      : '';
    return [
      opening,
      directed ? `From ${h3Timestamp(range.start)} to ${h3Timestamp(range.end)}:` : castSentence,
      /[.!?]$/.test(action) ? action : `${action}.`,
      directed?.detail ? bind(directed.detail) : '',
      performance,
      expression,
      directed ? '' : officialTemporalPerformance(storyboard, range, picture, storyboards.length),
      camera,
      directed ? bind(directed.ending) : 'The established positions and eyelines remain consistent.',
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
    buildVideoCapturePresetContract(first.capturePreset),
    'The photographic frame remains clean and text-free.',
    storyboards.length > 1
      ? 'EDITORIAL GRAMMAR: Treat every picture as a separate photographed setup. Every transition must be motivated by action, gaze, dialogue, object, shape, or sound. Preserve the 180-degree axis, eyelines, screen direction, match-on-action phase, and location geography. Vary framing scale with dramatic purpose; do not crossfade, morph, interpolate, repeat, or soften a hard cut unless an explicit transition is written.'
      : '',
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
    ...storyboards.map((_, index) => `<Picture ${storyboardPictureOrdinal(index)}> ([Shot ${index + 1}] composition): opening anchor - subject placement and viewpoint establish the start; identity, setting and lighting persist as the authored movement unfolds.`),
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
  const duration = Math.min(15, Math.max(4, options.duration || estimateVideoSegmentSeconds(storyboards)));
  return applyFilmEndingPrompt(buildOfficialGuidePrompt(storyboards, characterAudios, options), duration, options.isFilmEnding === true);
}

/** Also applied to saved prompt overrides; dialogue remains byte-for-byte intact. */
export function applyFilmEndingPrompt(prompt: string, duration: number, isFilmEnding: boolean): string {
  const clean = prompt.split(/(<d>[\s\S]*?<\/d>)/gi)
    .map(part => /^<d>/i.test(part) ? part : part.replace(/^FILM ENDING:[^\n]*(?:\n\n?|$)/gm, ''))
    .join('');
  if (!isFilmEnding) return clean;
  const ending = `FILM ENDING: Only the final shot, ${h3Timestamp(Math.max(0, duration - FILM_ENDING_SECONDS))}–${h3Timestamp(duration)}, has no dialogue or narration. The authored picture continues naturally, without a freeze or added black frames; retain planned ambience and music, or intentional silence.`;
  const musicIndex = clean.search(/^non_diegetic_music:/m);
  return fitH3PromptBudget(musicIndex >= 0
    ? `${clean.slice(0, musicIndex)}${ending}\n\n${clean.slice(musicIndex)}`
    : `${clean}\n${ending}`);
}

export function buildStoryboardVideoPrompt(
  storyboard: Storyboard,
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
  language?: 'zh' | 'en',
  isFilmEnding = false,
): string {
  if (storyboard.videoPromptOverride && storyboard.videoPrompt?.trim()) {
    return buildVideoSegmentPrompt([storyboard], characterAudios, {
      firstFrameUrl,
      duration: storyboard.videoDuration,
      hasVoiceReferences: characterAudios.length > 0,
      referenceAudioNames: characterAudios.map(audio => audio.character),
      visualOverride: storyboard.videoPrompt.trim(),
      language,
      isFilmEnding,
    });
  }
  return buildVideoSegmentPrompt([storyboard], characterAudios, {
    firstFrameUrl,
    duration: storyboard.videoDuration,
    language,
    isFilmEnding,
  });
}

// 为单个分镜生成视频
export async function generateStoryboardVideo(
  storyboard: Storyboard,
  apiKey: string,
  model: string = 'sora-2',
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9',
  audioFiles: string[] = [],
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
  generateAudio?: boolean,
  language?: 'zh' | 'en',
  isFilmEnding = false,
): Promise<string> {
  // 确保有生成的图片
  if (!storyboard.imageUrl) {
    throw new Error(`Storyboard scene ${storyboard.sceneNumber} does not have a generated image`);
  }

  // Validate imageUrl is a public http/https URL (not base64)
  if (!storyboard.imageUrl.startsWith('http://') && !storyboard.imageUrl.startsWith('https://')) {
    throw new Error(`Scene ${storyboard.sceneNumber} image is not a public URL. Please regenerate the image individually first.`);
  }

  const videoPrompt = buildStoryboardVideoPrompt(storyboard, characterAudios, firstFrameUrl, language, isFilmEnding);


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
