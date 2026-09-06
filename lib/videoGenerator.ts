import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { allocateSegmentTimeline, cinematicEditKind, estimateVideoSegmentSeconds } from './videoSegments';
import { compileTimedSpeech, storyboardAudioPlan, storyboardSpeech, validateSpeechLanguage } from './speechAudioContract';
import { isObservationalCapturePreset } from './capturePresets';
import { currentChineseVideoDirection, isChineseVideoDirectionField, videoDirectionEntityNames, withoutVideoEntityNames } from './videoDirection';
import { FILM_ENDING_SECONDS } from './filmEnding';
import { normalizeImageStyleReference, type ImageStyleReference } from './imageStyleReference';
import { H3_DIALOGUE_NO_SUBTITLE_POLICY, NO_SUBTITLE_POLICY } from './videoTextPolicy';

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
    'retention_analysis:\n保持已声明的人物身份、服装和场景；参考图锁定每镜开场构图，既定运镜控制后续变化；绑定音频只提供音色，不复制原声音信号。\n\ndetailed_description:',
  );
  fitted = fitted
    .split(/(<d>[\s\S]*?<\/d>)/gi)
    .map(part => /^<d>/i.test(part) ? part : part
      .replace(/The established positions and eyelines remain consistent\.\s*/g, '')
      .replace(/保持已经建立的人物位置与视线关系。\s*/g, '')
      .replace(/[ \t]{2,}/g, ' '))
    .join('')
    .replace(/\n{3,}/g, '\n\n');
  if (fitted.length <= H3_PROMPT_MAX_CHARACTERS) return fitted;

  fitted = fitted.replace(
    /EDITING:[^\n]*/i,
    '使用有动机的硬切，保持轴线、视线、银幕方向、动作阶段和空间关系；不叠化、不变形、不插帧、不重复。\n',
  );
  if (fitted.length <= H3_PROMPT_MAX_CHARACTERS) return fitted;

  // Keep every authored shot field intact. If a dense segment still exceeds
  // the transport ceiling, compact only the repeated global photography rules.
  fitted = fitted
    .replace(/^(?:REFERENCE PRIORITY|参考图：)[^\n]*$/gm, '参考图锁定人物、服装、物体、场景、光线与每镜开场，只允许既定动作和运镜改变画面。')
    .replace(/^The target video uses natural live-action cinematography[^\n]*$/gm, '保持自然实拍质感、现场光、光学景深和正常速度运动。')
    .replace(/^Maintain photographic material reality:[^\n]*$/gm, '保持皮肤、毛发、织物、接触阴影和光学景深符合真实摄影，并保持脸、手、服装和人物数量。')
    .replace(/^(?:CAPTURE MODE:|拍摄方式：)[^\n]*$/gm, '按既定人物调度执行运镜，保持银幕方向，让每个反应承接剧本中的原因。');
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

function officialShotFraming(storyboard: Storyboard): string {
  const framing = `${storyboard.shotSize || ''} ${storyboard.angle || ''}`.toLowerCase();
  const size = /大特写|extreme close/.test(framing) ? '大特写'
    : /特写|close/.test(framing) ? '特写'
      : /近景|medium close/.test(framing) ? '近景'
        : /中景|medium/.test(framing) ? '中景'
          : /全景|full shot/.test(framing) ? '全景'
            : /远景|wide|long shot/.test(framing) ? '远景'
              : '按剧情需要确定景别';
  const angle = /仰|low angle/.test(framing) ? '低机位仰拍'
    : /俯|top|high angle/.test(framing) ? '高机位俯拍'
      : /过肩|over.?shoulder/.test(framing) ? '过肩机位'
        : /fpv|主观/.test(framing) ? '角色主观机位'
          : '自然平视机位';
  return `${size}，${angle}`;
}

type VideoSegmentPromptOptions = {
  styleReference?: ImageStyleReference;
  isFilmEnding?: boolean;
  firstFrameUrl?: string;
  duration?: number;
  hasVoiceReferences?: boolean;
  referenceAudioNames?: string[];
  visualOverride?: string;
  language?: 'zh' | 'en';
  voiceProfiles?: Record<string, string>;
  /** Ordered exactly like the extra H3 object-reference pictures. */
  objectReferenceNames?: string[];
};

function officialVisibleExpression(storyboard: Storyboard): string {
  if (!storyboard.characters?.length && !storyboard.performance?.length) return '';
  const source = [
    storyboard.stateBefore?.emotion,
    storyboard.stateAfter?.emotion,
    ...(storyboard.performance || []).flatMap(cue => [cue.expression, cue.gaze, cue.breath, cue.reaction]),
    ...storyboardSpeech(storyboard).flatMap(line => [line.emotion, line.delivery]),
  ].filter(Boolean).join(' ').toLowerCase();
  if (/害怕|恐惧|紧张|fear|afraid|tense|anxious/.test(source)) return '呼吸短暂收紧，眼周和眉间随之绷紧，随后稍微松开。';
  if (/悲|难过|伤心|sad|grief|sorrow/.test(source)) return '下眼睑和嘴角轻轻收紧，随后缓慢恢复。';
  if (/愤怒|生气|angry|anger|furious/.test(source)) return '眼神、眉间与下颌同时收紧一次，随后稍微松开。';
  if (/喜悦|开心|温柔|happy|warm|gentle|joy/.test(source)) return '目光逐渐柔和，嘴角只轻轻抬起一次，随后恢复。';
  if (/坚定|果断|决心|determined|firm|resolute/.test(source)) return '目光定住，下颌稳定；动作完成后紧张感才稍微释放。';
  return '目光和面部张力随动作发生一次明确变化，随后自然恢复。';
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
      .filter(value => value && containsHan(value));
    if (!pieces.length) return '';
    const character = String(cue.character || '').trim();
    const label = character ? `${character}：` : `可见角色${index + 1}：`;
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
    return '参考图：每张已声明图片锁定对应镜头的开场。保持人物身份、服装、物体、场景、光线和色彩一致，只执行已写明的动作、表情、运镜和剪辑。';
  }
  const endLock = isFirstLastMode
    ? ' 镜头结束时准确到达<Picture 2>的构图，不更换人物或风格。'
    : '';
  return `参考图：<Picture 1>是00:00.000的准确首帧。保持人物身份、脸部、发型、身体比例、服装、物体、场景、光线、镜头质感和色彩不变，只执行已写明的动作、表情和运镜。${endLock}`;
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
      ? `${h3Timestamp(range.start)}至${h3Timestamp(actionStart)}延续${picture}中的任务；${h3Timestamp(actionStart)}至${h3Timestamp(settleStart)}由触发引出稍有延迟的反应，眼神或重心先动，允许一个调整停在未完成状态；${h3Timestamp(settleStart)}至${h3Timestamp(range.end)}保留低强度余动，随后才恢复注意或进入新状态。`
      : `${h3Timestamp(range.start)}至${h3Timestamp(actionStart)}延续${picture}中的动作；${h3Timestamp(actionStart)}至${h3Timestamp(settleStart)}由一个触发形成动作重音；${h3Timestamp(settleStart)}至${h3Timestamp(range.end)}保留余动和不完全恢复，不摆拍定格。`;
  }
  if (isObservationalCapturePreset(storyboard.capturePreset)) {
    return `${h3Timestamp(range.start)}至${h3Timestamp(actionStart)}延续${picture}中的低强度行动，不摆拍；${h3Timestamp(actionStart)}至${h3Timestamp(settleStart)}由既定触发引出稍有延迟的重点反应，眼神或重心先于头部和手部，一个调整可以停在未完成状态；${h3Timestamp(settleStart)}至${h3Timestamp(range.end)}保留余动和短暂低活动，随后恢复注意或进入既定的新状态。`;
  }
  return `${h3Timestamp(range.start)}至${h3Timestamp(actionStart)}延续${picture}中的低强度动作，不作展示姿势；${h3Timestamp(actionStart)}至${h3Timestamp(settleStart)}由既定触发形成一次有重量的动作峰值；${h3Timestamp(settleStart)}至${h3Timestamp(range.end)}保留余动和不完全恢复，不要冻结。`;
}

function officialDialogueDelivery(line: ReturnType<typeof compileTimedSpeech>[number]): string {
  const source = `${line.emotion || ''} ${line.delivery || ''}`.toLowerCase();
  const volume = line.volume === 'raised' ? '克制地提高音量'
    : line.volume === 'soft' ? '轻声'
      : line.volume === 'whisper' ? '压低声音耳语'
        : '自然音量';
  const pace = /快速|急促|fast|quick|urgent/.test(source) ? '自然偏快的交谈速度'
    : /缓慢|慢速|slow|measured/.test(source) ? '从容偏慢的交谈速度'
      : '自然交谈速度';
  return `${volume}，${pace}`;
}

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
    storyboard.action || storyboard.description || '',
    exactLines,
    'zh',
  );
  if (authored && containsHan(withoutVideoEntityNames(authored, videoDirectionEntityNames(storyboard)))) return compactActionArc(authored, 320);
  const target = primarySubject || '主要主体';
  if (storyboard.clipType === 'reaction') return `${target}承接上一动作，只发生一次明确的视线与表情变化`;
  if (storyboard.clipType === 'action') return `${target}与主要物体完成一个清晰的物理动作`;
  return `${target}完成一个自然手势，并把注意转向主要物体`;
}

function officialH3CameraSentence(storyboard: Storyboard, index: number): string {
  const authored = sanitizeVisualDirection(storyboard.cameraMove).trim();
  const source = (authored || storyboard.description || '').toLowerCase();
  if (storyboard.capturePreset === 'surveillance') return '固定高机位不跟拍、不重新构图、不移焦，也不预判动作。';
  if (storyboard.capturePreset === 'broadcast-candid' || storyboard.capturePreset === 'news-telephoto') return '远距离机位只在动作开始后反应，稍晚做一次小幅重新构图或焦点恢复。';
  if (storyboard.capturePreset === 'documentary-follow') return '手持摄影在动作开始后才反应，只做一次小幅纠偏构图。';
  if (storyboard.capturePreset === 'phone-bystander') return '手机在动作开始后稍晚反应，只做一次手持重新构图或自动对焦恢复。';
  if (storyboard.capturePreset === 'home-video') return '熟悉人物的拍摄者稍慢一拍跟随，只做一次随意的手持修正。';
  // Do not replace a complete legacy camera instruction with a keyword-based
  // "small slow push"; in particular a locked camera can still rack focus.
  if (authored && containsHan(authored) && authored.length <= 180 && /[。！？]$/.test(authored)) return authored;
  if (/(?:移焦|拉焦|rack focus|focus pull)/i.test(source)) return '固定机位；在动作触发时，只在既定的两个景深平面之间移焦一次。';
  if (/(?:静止|固定|static|locked)/i.test(source)) return '相机保持固定构图。';
  if (/(?:手持|handheld|shoulder)/i.test(source)) return '相机以克制的手持运动跟随动作，最后随主体停稳。';
  if (/(?:拉远|拉出|pull out|dolly out|zoom out)/i.test(source)) return '相机缓慢小幅后撤。';
  if (/(?:推近|推进|推镜|push in|dolly in|zoom in)/i.test(source)) return '相机朝主体缓慢小幅推近。';
  if (/(?:左摇|pan left)/i.test(source)) return '相机小幅向左摇摄并跟随动作。';
  if (/(?:右摇|pan right)/i.test(source)) return '相机小幅向右摇摄并跟随动作。';
  if (/(?:摇|pan)/i.test(source)) return '相机小幅摇摄并跟随动作。';
  if (/(?:横移|左移|右移|truck|slide)/i.test(source)) return '相机随主体横向移动，并保持原有运动方向。';
  if (/(?:跟|tracking|follow)/i.test(source)) return '相机以正常速度跟随主体，最后落在动作完成的位置。';
  if (/(?:升|pedestal up|crane up|tilt up)/i.test(source)) return '相机小幅升高，逐步露出空间上部。';
  if (/(?:降|pedestal down|crane down|tilt down)/i.test(source)) return '相机小幅降低，落向动作细节。';
  if (storyboard.clipType === 'insert') return '相机保持稳定的细节镜头，只改变一次焦点。';
  if (storyboard.clipType === 'reaction') return '相机朝发生变化的表情短暂推近。';
  if (storyboard.clipType === 'dialogue' || storyboard.clipType === 'performance') return '相机大体保持固定，只随表演做一次小幅运动。';
  if (storyboard.clipType === 'long_take') return '相机以正常速度连续跟随人物调度。';
  return index === 0
    ? '相机以正常速度跟随动作，最后落在动作完成的位置。'
    : '相机随动作做一次短促运动，然后停稳。';
}

function officialH3EditSentence(
  previous: Storyboard,
  current: Storyboard,
  shotNumber: number,
  start: number,
  picture: string,
): string {
  const prefix = `[Shot ${shotNumber}] ${h3Timestamp(start)}时，`;
  if (previous.transition === 'dissolve') return `${prefix}用克制的叠化把已经完成的运动带入${picture}锁定的构图，不混合人物身份或服装。`;
  if (previous.transition === 'fade') return `${prefix}短暂淡至黑场，再以${picture}锁定的构图开始新的戏剧节拍。`;
  if (previous.transition === 'wipe') return `${prefix}由有动机的前景遮挡完成转场，露出${picture}锁定的构图，并保持银幕方向。`;

  const kind = cinematicEditKind(previous, current);
  const instruction: Record<ReturnType<typeof cinematicEditKind>, string> = {
    'dialogue-reverse': `在对话轮次变化处切到${picture}锁定的构图，形成正反打回应；保持共同视线、180度轴线、银幕方向和听者反应时机`,
    'action-reaction': `在物理动作完成处切到${picture}锁定的构图；反应立刻承接冲击，同时保持视线和银幕方向连续`,
    'detail-insert': `顺着手部、视线或物体运动切到${picture}锁定的精确细节插入镜头；保持手与物体的位置，并在切点匹配动作`,
    'insert-return': `从细节镜头切回${picture}锁定的构图；从插入镜头确立的同一时刻继续动作和视线`,
    'establish-develop': `从空间主镜头切到${picture}锁定的构图；进入更近的戏剧覆盖，不反转既定银幕轴线`,
    'rhythmic-montage': `以干净、有节奏的硬切进入${picture}锁定的构图；通过匹配动作、形状或声音连接镜头，不做画面变形`,
    'match-continuity': `顺着匹配的动作、视线、形状或声音切到${picture}锁定的构图；保持动作阶段、银幕方向和物理连续性`,
    'progressive-coverage': `沿既定视线或物体轴线切近到${picture}锁定的构图；用更近景别揭示新信息，不重复上一镜`,
    'motivated-transition': `由明确动机硬切到${picture}锁定的构图；前镜动作、物体或声音连接新空间，各场景仍保持清晰区别`,
    'direct-cut': `干净硬切到${picture}锁定的构图；从变化后的动作阶段或景别开始，并保持空间方向`,
  };
  return `${prefix}${instruction[kind]}。`;
}

function officialH3Soundscape(storyboards: Storyboard[]): string {
  const plans = storyboards.map(storyboardAudioPlan);
  const chineseCues = plans.map(plan => ({
    ...plan,
    environment: plan.environment.filter(value => containsHan(String(value || ''))),
    foley: plan.foley.filter(value => containsHan(String(value || ''))),
  }));
  if (chineseCues.every(plan => !plan.environment.length && !plan.foley.length && plan.backgroundHuman !== 'indistinct_nonverbal')) {
    return '保持与可见地点一致的稳定、无人声环境底噪；克制的拟音只跟随画面中实际发生的物理动作。';
  }
  // A segment can cross locations. Flattening all plans and taking the first
  // four sounds erased later shots' ambience and played early Foley everywhere.
  // Keep each sound attached to the same shot as its visible source.
  const shots = chineseCues.map((plan, index) => {
    return [
      `[Shot ${index + 1}] 环境底噪：${plan.environment.length ? plan.environment.join('；') : '与可见场景一致的自然环境声'}。`,
      plan.foley.length ? `动作拟音：${plan.foley.join('；')}。` : '',
      plan.backgroundHuman === 'indistinct_nonverbal'
        ? '背景人物只有模糊、无明确词语的低声人群声。'
        : '',
    ].filter(Boolean).join(' ');
  });
  return [
    '每个地点的声音底层保持稳定且没有可辨认人声，只在场景变化时更换；拟音只跟随可见的物理原因，并保留剧本要求的刻意静默。',
    ...shots,
  ].join('\n');
}

function officialH3Music(storyboards: Storyboard[]): string {
  const music = [...new Set(storyboards.map(storyboard => storyboardAudioPlan(storyboard).music)
    .filter(value => value && value !== 'none' && containsHan(String(value))))];
  return music.length ? `非剧情内配乐使用：${music.join('；')}。` : '无。';
}

/**
 * Fresh H3 contract based on MiniMax's official h3-prompt-writing guide.
 * Direction is Chinese, dialogue is the only project-language text, and no
 * instruction tells the model how to stop, stay silent, or fill a speech slot.
 */
function buildOfficialGuidePrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: VideoSegmentPromptOptions = {},
): string {
  const first = storyboards[0];
  if (!first) throw new Error('视频片段至少需要一个分镜');
  const duration = Math.min(15, Math.max(2, options.duration || estimateVideoSegmentSeconds(storyboards)));
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
  const objectReferenceNames = (options.objectReferenceNames || []).filter(Boolean);
  const objectId = new Map(objectReferenceNames.map((name, index) => [name, index + 1]));
  const isFirstLastMode = Boolean(options.firstFrameUrl && storyboards.length === 1);
  const hasContinuityReference = Boolean(options.firstFrameUrl && !isFirstLastMode);
  const storyboardPictureOrdinal = (index: number) => index + (hasContinuityReference ? 2 : 1);
  const useSubjectLabels = !isFirstLastMode;
  const exactLines = timedSpeech.map(line => line.exactLine);

  const dialogueByShot = new Map<number, Array<{ character: string; sentence: string }>>();
  for (const line of timedSpeech) {
    const subject = subjectId.get(line.character);
    const audio = audioId.get(line.character);
    const localSpeaker = speakerId.get(line.character) || 1;
    const speaker = useSubjectLabels && subject
      ? `<Subject ${subject}>（S${localSpeaker}）`
      : `${line.character || '画面中的说话者'}（S${localSpeaker}）`;
    const voiceReference = audio ? `，音色参考<Audio ${audio}>` : '';
    const rawVoiceProfile = !audio
      ? String(options.voiceProfiles?.[line.character] || '').replace(/[\r\n]+/g, ' ').trim()
      : '';
    // Visual/audio directions stay Chinese; only the exact line inside <d>
    // follows the selected project language.
    const voiceProfile = rawVoiceProfile && /[\u3400-\u9fff]/.test(rawVoiceProfile)
      ? `，保持音色风格：${rawVoiceProfile}`
      : '';
    // H3's language tag follows the approved project language. Detecting from
    // individual text misclassified punctuation-only pauses and mixed brand
    // names; the tag controls spoken audio, never visible captions.
    const tagged = `<d>[${options.language === 'en' ? 'English' : 'Chinese'}] ${line.exactLine}</d>`;
    const existing = dialogueByShot.get(line.storyboardIndex) || [];
    const previousSpeaker = existing.at(-1)?.character;
    const turn = existing.length === 0 ? '' : previousSpeaker === line.character ? '随后，' : '回应上一句时，';
    const verb = existing.length === 0 ? '开始说话' : previousSpeaker === line.character ? '继续说' : '回答';
    const sentence = `${turn}${speaker}${verb}${voiceReference}${voiceProfile}，${officialDialogueDelivery(line)}：${tagged}`;
    existing.push({ character: line.character, sentence });
    dialogueByShot.set(line.storyboardIndex, existing);
  }

  const shotParagraphs = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const pictureOrdinal = storyboardPictureOrdinal(index);
    const picture = `<Picture ${pictureOrdinal}>`;
    const cast = storyboardCastNames(storyboard).map(name => {
      const id = subjectId.get(name);
      return useSubjectLabels && id ? `<Subject ${id}>` : name;
    });
    const primarySubject = cast[0] || '主要主体';
    // Historical English briefs are refined before submission. If an older
    // caller reaches this compiler directly, use the locked Chinese screenplay
    // action instead of leaking English direction into H3.
    let directed: ReturnType<typeof currentChineseVideoDirection>;
    try { directed = currentChineseVideoDirection(storyboard); } catch { directed = undefined; }
    // These four compact fields were authored and validated together. Never
    // splice them, replace them with a still-image sentence, or add a second
    // generic acting/timing instruction that competes with the authored event.
    const bind = (value: string) => videoDirectionEntityNames(storyboard)
      .map(name => ({
        name,
        label: subjectId.has(name)
          ? (useSubjectLabels ? `<Subject ${subjectId.get(name)}>` : '画面中的角色')
          : objectId.has(name) ? `<Object ${objectId.get(name)}>` : '已引用物体',
      }))
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
    const dialogue = (dialogueByShot.get(index) || []).map(turn => turn.sentence).join(' ');
    let opening: string;
    if (index === 0 && isFirstLastMode) {
      opening = '[Shot 1] 镜头从<Picture 1>开始。';
    } else if (index === 0 && hasContinuityReference) {
      opening = `[Shot 1] 视频从<Picture 1>开始，并以${picture}作为本镜构图参考。`;
    } else if (index === 0) {
      opening = `[Shot 1] 本镜以${picture}作为构图参考。`;
    } else {
      opening = officialH3EditSentence(storyboards[index - 1], storyboard, index + 1, range.start, picture);
    }
    const castSentence = cast.length ? `${framing}同时容纳${cast.join('与')}。` : `${framing}呈现动作。`;
    const endFrameLanding = isFirstLastMode
      ? '动作在镜头结束时准确到达<Picture 2>中的姿态与构图。'
      : '';
    const actionText = /[.!?。！？]$/.test(action) ? action : `${action}。`;
    const terminalShot = options.isFilmEnding === true && index === storyboards.length - 1;
    const tailHandoff = terminalShot
      ? '全片最后一镜保留结果与自然余韵。'
      : '镜尾以已有动作、视线或焦点落点形成可见交接；在当前机位内完成落点，保持当前构图到片段结束。';
    return [
      `${opening} [${h3Timestamp(range.start)}–${h3Timestamp(range.end)}]`,
      `景别与构图：${castSentence}`,
      `动作与表情：${[actionText, directed?.detail ? bind(directed.detail) : '', performance, expression, directed ? '' : officialTemporalPerformance(storyboard, range, picture, storyboards.length)].filter(Boolean).join(' ')}`,
      `运镜：${camera}`,
      `镜尾：${directed ? bind(directed.ending) : '保持已经建立的人物位置与视线关系。'} ${tailHandoff}${endFrameLanding ? ` ${endFrameLanding}` : ''}`,
      dialogue ? `对白：${dialogue}` : '',
    ].filter(Boolean).join('\n');
  });

  const visualOverride = sanitizeVisualDirection(options.visualOverride, exactLines);
  const chineseVisualOverride = visualOverride && isChineseVideoDirectionField(visualOverride, storyboards.flatMap(videoDirectionEntityNames))
    && !/(?:subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)\s*:/i.test(visualOverride)
      ? compactActionArc(visualOverride, 360)
      : '';
  const detailed = [
    officialReferencePriorityLock(storyboards, isFirstLastMode),
    storyboards.length > 1
      ? '在已声明的各镜参考图之间使用剧本规定的干净切镜，保持银幕方向和动作连续。'
      : '',
    timedSpeech.length ? H3_DIALOGUE_NO_SUBTITLE_POLICY : NO_SUBTITLE_POLICY,
    chineseVisualOverride,
    ...shotParagraphs,
  ].filter(Boolean).join('\n');
  const soundscape = officialH3Soundscape(storyboards);
  const music = officialH3Music(storyboards);

  if (isFirstLastMode) {
    const alignment = `参考图与目标视频的对齐方式：<Picture 1>（来自Shot 1）对应目标视频0.00秒；<Picture 2>（来自Shot 1）对应目标视频${duration.toFixed(2)}秒。`;
    return fitH3PromptBudget(`${alignment}\n\nintegrated_multimodal_description: ${detailed}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`);
  }

  const subjectDefinitions = characters.map((name, index) => {
    const ordinals = storyboards.flatMap((storyboard, storyboardIndex) => storyboardCastNames(storyboard).includes(name)
      ? [storyboardPictureOrdinal(storyboardIndex)]
      : []);
    if (hasContinuityReference && storyboardCastNames(storyboards[0]).includes(name)) ordinals.unshift(1);
    const pictures = [...new Set(ordinals)].map(ordinal => `<Picture ${ordinal}>`).join(', ');
    const identity = name || '已声明角色';
    return `<Subject ${index + 1}>是${pictures || '参考图'}中的${identity}。`;
  });
  const pictureDefinitions = [
    ...(hasContinuityReference ? ['<Picture 1>是[Shot 1]的开场连续性画面。'] : []),
    ...storyboards.map((_, index) => `<Picture ${storyboardPictureOrdinal(index)}>是[Shot ${index + 1}]的构图参考。`),
    ...objectReferenceNames.map((_, index) => {
      const pictureOrdinal = storyboardPictureOrdinal(storyboards.length - 1) + index + 1;
      return `<Object ${index + 1}>是<Picture ${pictureOrdinal}>中的准确实物。保持它的颜色、比例、材质、结构和印刷标记不变。`;
    }),
  ];
  const audioDefinitions = referenceAudioNames.map((name, index) => {
    const subject = subjectId.get(name);
    const speaker = speakerId.get(name);
    return `<Audio ${index + 1}>是${subject ? `<Subject ${subject}>` : name}${speaker ? `（S${speaker}）` : ''}的音色参考。`;
  });
  const prompt = `subject_definitions:\n${[...subjectDefinitions, ...pictureDefinitions, ...audioDefinitions].join('\n')}\n\ndetailed_description:\n${detailed}\n\noverall_soundscape:\n${soundscape}\n\nnon_diegetic_music:\n${music}`;
  return fitH3PromptBudget(prompt);
}

export function buildVideoSegmentPrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: VideoSegmentPromptOptions = {},
): string {
  const duration = Math.min(15, Math.max(2, options.duration || estimateVideoSegmentSeconds(storyboards)));
  return applyFilmEndingPrompt(applySeriesVideoStyle(applyVideoDuplicateRepairPrompt(buildOfficialGuidePrompt(storyboards, characterAudios, options), storyboards.map(b => b.videoDuplicateRepairPrompt || '').filter(Boolean).join(' ')), options.styleReference), duration, options.isFilmEnding === true);
}

/** Preserve repair direction even when the editor has a saved complete prompt override. */
export function applyVideoDuplicateRepairPrompt(prompt: string, correction?: string): string {
  const clean = prompt.split(/(<d>[\s\S]*?<\/d>)/gi).map(part => /^<d>/i.test(part) ? part : part.replace(/^(?:(?:CHARACTER CONTINUITY|VIDEO VISUAL) REPAIR:|For this regeneration, correct the confirmed visual anomaly:|本次重新生成只修正已确认的画面异常：)[^\n]*\n?/gm, '')).join('').trimEnd();
  if (!correction) return clean;
  const compactCorrection = correction.replace(/\s+/g, ' ').slice(0, 1200);
  const visualCorrection = containsHan(compactCorrection)
    ? compactCorrection
    : '重新执行既定可见动作，每个已声明主体只保留一个实例。';
  const directive = `本次重新生成只修正已确认的画面异常：${visualCorrection}。所有按顺序排列的<d>内容仍只存在于音轨中。`;
  // The Director/H3 parser gives the official sections semantic weight. Put a
  // confirmed visual correction inside detailed_description, immediately
  // before the authored shots, instead of after non_diegetic_music where the
  // model can treat it as trailing metadata and ignore it.
  const marker = 'detailed_description:\n';
  const markerIndex = clean.indexOf(marker);
  return fitH3PromptBudget(markerIndex >= 0
    ? `${clean.slice(0, markerIndex + marker.length)}${directive}\n${clean.slice(markerIndex + marker.length)}`
    : `${clean}\n${directive}`);
}

/** The picture inputs already carry the style; never add its person as a video reference. */
export function applySeriesVideoStyle(prompt: string, value?: ImageStyleReference): string {
  const style = normalizeImageStyleReference(value);
  if (!style) return prompt;
  const clean = prompt.split(/(<d>[\s\S]*?<\/d>)/gi).map(part => /^<d>/i.test(part) ? part : part.replace(/^(?:SERIES LOOK:|Use the approved series look:|Keep the visual style already present in the input frame;|保持输入画面中已经确定的视觉风格；)[^\n]*\n?/gm, '')).join('');
  const direction = `保持输入画面中已经确定的视觉风格；单独的风格参考不提供人物、物体、姿势或场景内容。\n`;
  const marker = 'detailed_description:\n';
  const index = clean.indexOf(marker);
  return fitH3PromptBudget(index >= 0
    ? `${clean.slice(0, index + marker.length)}${direction}${clean.slice(index + marker.length)}`
    : `${clean}\n${direction}`);
}

/** Also applied to saved prompt overrides; dialogue remains byte-for-byte intact. */
export function applyFilmEndingPrompt(prompt: string, duration: number, isFilmEnding: boolean): string {
  const clean = prompt.split(/(<d>[\s\S]*?<\/d>)/gi)
    .map(part => /^<d>/i.test(part) ? part : part.replace(/^(?:FILM ENDING:|At the end of the complete film,|整片结束时，)[^\n]*(?:\n\n?|$)/gm, ''))
    .join('');
  if (!isFilmEnding) return clean;
  const ending = `整片结束时，只有末镜的${h3Timestamp(Math.max(0, duration - FILM_ENDING_SECONDS))}–${h3Timestamp(duration)}区间没有对白或旁白。既定画面自然延续，不定格、不补黑帧；声音保持计划中的环境声与配乐，或保持刻意静默。`;
  const marker = 'detailed_description:\n';
  const markerIndex = clean.indexOf(marker);
  return fitH3PromptBudget(markerIndex >= 0
    ? `${clean.slice(0, markerIndex + marker.length)}${ending}\n${clean.slice(markerIndex + marker.length)}`
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
