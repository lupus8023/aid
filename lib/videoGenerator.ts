import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { getProductionStylePreset } from './promptArchitecture';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds } from './videoSegments';
import { buildAudioManifest, buildNonDiegeticMusic, compileTimedSpeech, storyboardSpeech, validateSpeechLanguage } from './speechAudioContract';

function h3Timestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function fitH3PromptBudget(prompt: string): string {
  if (prompt.length <= 7000) return prompt;
  const chineseTemplate = prompt.includes('画面里不要出现字幕') || prompt.includes('片中有') || prompt.includes('片中没有台词');
  // Still images already carry appearance. Under pressure, discard only the
  // duplicated static LOOK sentence, never action, dialogue, timing or sound.
  let fitted = prompt.replace(/ LOOK:[^\n]*? ACTION:/g, ' ACTION:');
  if (fitted.length <= 7000) return fitted;
  // The definitions above already bind identities and pictures; keep the
  // official retention section but compact its duplicated prose.
  fitted = fitted
    .replace(/<Picture (\d+)> starts \[Shot (\d+)\];[^\n]*/g, '<Picture $1> = [Shot $2] visual anchor.')
    .replace(/<Picture (\d+)> 规定 \[Shot (\d+)\] 的起始视觉状态；[^\n]*/g, '<Picture $1>：规定 [Shot $2] 的视觉起点。')
    .replace(/<Subject (\d+)>: fully_preserved[^\n]*/g, '<Subject $1>: preserve identity/wardrobe.')
    .replace(/<Picture (\d+)>: reference;[^\n]*/g, '<Picture $1>: reference.')
    .replace(/<Subject (\d+)>：在[^\n]*/g, '<Subject $1>：保留身份和服装。')
    .replace(/<Picture (\d+)>：作为视觉参考；[^\n]*/g, '<Picture $1>：视觉参考。');
  if (fitted.length <= 7000) return fitted;
  // Retention restates bindings already declared in subject_definitions. Keep
  // the required official section, but collapse it before ever sacrificing a
  // timed action or an exact <d> dialogue line.
  fitted = fitted.replace(
    /retention_analysis:\s*[\s\S]*?\n\s*detailed_description:/,
    chineseTemplate
      ? 'retention_analysis:\n人物、衣服、场景和声音保持一致。\n\ndetailed_description:'
      : 'retention_analysis:\nPreserve every declared identity, wardrobe, world and timbre binding.\n\ndetailed_description:',
  );
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

/**
 * H3 has repeatedly vocalized Chinese directing prose containing “可见”, as
 * if the following phrase were narration. Keep authored dialogue untouched,
 * but remove that trigger from every non-dialogue section before submission.
 */
function removeChineseVisibleCue(prompt: string): string {
  return prompt.split(/(<d>[\s\S]*?<\/d>)/gi).map(part => {
    if (/^<d>/i.test(part)) return part;
    return part
      .replace(/画面中可见的成因/g, '画面中的对应动作')
      .replace(/画面中可见/g, '画面中有')
      .replace(/可见物体为/g, '镜头内物体包括')
      .replace(/上述可见动作/g, '上述动作')
      .replace(/只由可见动作/g, '只由画面动作')
      .replace(/跟随可见动作/g, '跟随画面动作')
      .replace(/完成可见表演/g, '完成镜头内表演')
      .replace(/不可见/g, '画面不呈现')
      .replace(/可见/g, '画面呈现');
  }).join('');
}

function dialogueLanguage(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(text)) return 'Korean';
  if (/[\u3400-\u9fff]/.test(text)) return 'Chinese';
  return 'English';
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
  // `prompt` is the English still-image prompt emitted by Story Director.
  // It is intentionally not a video-direction fallback: feeding it to H3 was
  // the source of mixed-language fragments and duplicated visual commands.
  const action = dialogueSafeVisualAction(storyboard.action || storyboard.description, spokenLines, 'en');
  const cast = (storyboard.characters || []).join(', ') || 'The visible subject';
  const fallbackAction = `${cast} performs one natural, restrained gesture with a single eyeline and weight shift while addressing the established listener`;
  return compactActionArc(
    // The screenplay action owns what happens. The image prompt is only a
    // static visual anchor and must never replace causal action. Preserve the
    // separately authored `consequence` as screenplay metadata only. It may
    // describe meaning rather than pixels and must never be auto-appended here.
    action || fallbackAction,
    320,
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

type VideoSegmentPromptOptions = {
  firstFrameUrl?: string;
  duration?: number;
  hasVoiceReferences?: boolean;
  referenceAudioNames?: string[];
  visualOverride?: string;
  language?: 'zh' | 'en';
};

const CHINESE_H3_STYLE: Record<string, string> = {
  'follow-reference': '沿用参考图的画面风格、人物外观、衣服、场景、光线和颜色。人物动作自然，相机只跟着动作移动。',
  'cinematic-natural': '真实的实拍电影画面。皮肤、头发和衣服有真实质感。光线和颜色自然。人物按正常速度动作，不用慢动作。',
  'warm-film': '温暖的胶片画面。光线偏暖，有轻微光晕和细颗粒。人物动作自然，画面一直向前推进，不用慢动作拖时间。',
  'neo-noir': '冷色、低照度的黑色电影画面。暗处仍能看清人物和环境。人物先克制反应，再做一个明确动作。',
  documentary: '真实的现场纪录画面。使用现场光和轻微手持拍摄。相机会自然对焦和调整亮度，只在动作发生时切镜头。',
  commercial: '干净、精致的商业广告画面。产品材质清楚，人物接触产品的动作准确。需要展示细节时切到特写。',
  anime: '电影感二维动画。人物造型和线条保持一致。动作先准备，再完成主要动作，最后自然停稳。',
  '3d-cg': '电影感三维动画。人物和物体保持稳定。动作有重量，接触后有自然的受力和回弹。相机按真实拍摄方式移动。',
  'stop-motion': '手工定格动画。材料和逐帧动作清楚。使用固定相机或桌面相机，动作一段一段完成。',
};

function chineseCameraMotion(storyboard: Storyboard, index: number): string {
  const source = `${storyboard.cameraMove || ''} ${storyboard.description || ''}`.toLowerCase();
  if (/(?:静止|固定|static|locked)/i.test(source)) return '全程固定';
  if (/(?:手持|handheld|shoulder)/i.test(source)) return '手持跟着人物移动，动作结束后停稳';
  if (/(?:拉远|拉出|pull out|dolly out|zoom out)/i.test(source)) return '慢慢拉远，动作结束后停稳';
  if (/(?:推近|推进|推镜|push in|dolly in|zoom in)/i.test(source)) return '慢慢推近人物，停在人物表情上';
  if (/(?:左摇|pan left)/i.test(source)) return '向左摇，跟住动作后停稳';
  if (/(?:右摇|pan right)/i.test(source)) return '向右摇，跟住动作后停稳';
  if (/(?:摇|pan)/i.test(source)) return '跟着动作轻轻摇动，动作结束后停稳';
  if (/(?:横移|左移|右移|truck|slide)/i.test(source)) return '跟着人物横向移动，方向保持不变';
  if (/(?:跟|tracking|follow)/i.test(source)) return '跟着人物移动，动作结束后停稳';
  if (/(?:升|pedestal up|crane up|tilt up)/i.test(source)) return '慢慢升高，展示上方空间';
  if (/(?:降|pedestal down|crane down|tilt down)/i.test(source)) return '慢慢降低，停在动作细节上';
  switch (storyboard.clipType) {
    case 'establishing': return '先展示人物所在的环境，然后停稳';
    case 'insert': return '固定拍摄细节，只调整一次构图或焦点';
    case 'reaction': return '轻轻推近人物，停在人物表情上';
    case 'dialogue':
    case 'performance': return '以固定画面为主，只在人物动作时轻轻移动一次';
    case 'action': return '跟着人物移动，保持同一个方向';
    case 'montage': return '动作发生时快速摇动或重新构图一次';
    case 'long_take': return '连续跟着人物移动，保持正常速度';
    default: return index === 0 ? '跟着动作移动，动作结束后停稳' : '跟着这次动作移动一次，然后停稳';
  }
}

function chineseShotFraming(storyboard: Storyboard): string {
  const framing = `${storyboard.shotSize || ''} ${storyboard.angle || ''}`.toLowerCase();
  const size = /大特写|extreme close/.test(framing) ? '大特写'
    : /特写|close/.test(framing) ? '特写'
      : /近景|medium close/.test(framing) ? '近景'
        : /中景|medium/.test(framing) ? '中景'
          : /全景|full shot/.test(framing) ? '全景'
            : /远景|wide|long shot/.test(framing) ? '远景'
              : '中景';
  const angle = /仰|low angle/.test(framing) ? '低机位仰拍'
    : /俯|top|high angle/.test(framing) ? '高机位俯拍'
      : /过肩|over.?shoulder/.test(framing) ? '过肩机位'
        : /fpv|主观/.test(framing) ? '角色主观机位'
          : '平视';
  return `${size}，${angle}`;
}

function chineseAuthoritativeAction(storyboard: Storyboard): string {
  const spokenLines = storyboardSpeech(storyboard).map(line => line.exactLine);
  const action = dialogueSafeVisualAction(storyboard.action || storyboard.description, spokenLines, 'zh');
  const cast = (storyboard.characters || []).join('、') || '画面主体';
  const fallbackAction = `${cast}自然站稳，做一次简单手势，视线改变一次`;
  // `consequence` belongs to the screenplay contract. Even when local speech
  // is empty it may be an abstract information change, so never append it to
  // the model-facing physical action.
  return compactActionArc(action || fallbackAction, 320);
}

function officialVisibleExpression(storyboard: Storyboard, language: 'zh' | 'en'): string {
  const source = [
    storyboard.stateBefore?.emotion,
    storyboard.stateAfter?.emotion,
    ...storyboardSpeech(storyboard).flatMap(line => [line.emotion, line.delivery]),
  ].filter(Boolean).join(' ').toLowerCase();
  if (language === 'zh') {
    if (/害怕|恐惧|紧张|fear|afraid|tense|anxious/.test(source)) return '人物呼吸变紧，皱一下眉，然后放松';
    if (/悲|难过|伤心|sad|grief|sorrow/.test(source)) return '人物眼神变得难过，嘴角收紧一下，然后放松';
    if (/愤怒|生气|angry|anger|furious/.test(source)) return '人物皱眉并咬紧下颌，然后放松';
    if (/喜悦|开心|温柔|happy|warm|gentle|joy/.test(source)) return '人物眼神变温柔，轻轻笑一下，然后恢复自然表情';
    if (/坚定|果断|决心|determined|firm|resolute/.test(source)) return '人物看向目标，下颌保持稳定，动作结束后放松';
    return '人物的视线改变一次，表情跟着动作自然变化';
  }
  if (/害怕|恐惧|紧张|fear|afraid|tense|anxious/.test(source)) return 'The breath tightens once; the eyes and brow tense briefly, then release.';
  if (/悲|难过|伤心|sad|grief|sorrow/.test(source)) return 'The lower eyelids tense and the mouth corners tighten slightly, then recover.';
  if (/愤怒|生气|angry|anger|furious/.test(source)) return 'The eyes, brow, and jaw tighten once, then release.';
  if (/喜悦|开心|温柔|happy|warm|gentle|joy/.test(source)) return 'The gaze warms and the mouth corners rise slightly once, then recover.';
  if (/坚定|果断|决心|determined|firm|resolute/.test(source)) return 'The gaze locks once and the jaw steadies, then the tension releases after the action.';
  return 'The gaze and facial tension change once with the action, then recover.';
}

function officialDialogueDelivery(line: ReturnType<typeof compileTimedSpeech>[number], language: 'zh' | 'en'): string {
  const source = `${line.emotion || ''} ${line.delivery || ''}`.toLowerCase();
  if (language === 'zh') {
    const volume = line.volume === 'raised' ? '声音比平时大一点，但不要喊'
      : line.volume === 'soft' ? '轻声'
        : line.volume === 'whisper' ? '小声耳语'
          : '正常音量';
    const pace = /快速|急促|fast|quick|urgent/.test(source) ? '语速稍快'
      : /缓慢|慢速|slow|measured/.test(source) ? '语速稍慢'
        : '自然语速';
    return `${volume}，${pace}`;
  }
  const volume = line.volume === 'raised' ? 'at a controlled raised volume'
    : line.volume === 'soft' ? 'softly'
      : line.volume === 'whisper' ? 'in a restrained whisper'
        : 'at a natural speaking volume';
  const pace = /快速|急促|fast|quick|urgent/.test(source) ? 'a brisk natural conversational pace'
    : /缓慢|慢速|slow|measured/.test(source) ? 'a measured natural conversational pace'
      : 'a natural conversational pace';
  return `${volume}, at ${pace}`;
}

function officialNoMusic(storyboards: Storyboard[], language: 'zh' | 'en'): string {
  const authored = buildNonDiegeticMusic(storyboards, language);
  return /^(?:没有音乐|No music is present)/.test(authored) ? 'N/A' : authored;
}

function buildOfficialNaturalLanguagePrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: VideoSegmentPromptOptions = {},
): string {
  const first = storyboards[0];
  if (!first) throw new Error('视频片段至少需要一个分镜');
  const language = options.language === 'zh' ? 'zh' : 'en';
  const duration = Math.min(15, Math.max(4, options.duration || estimateVideoSegmentSeconds(storyboards)));
  const timeline = allocateSegmentTimeline(storyboards, duration);
  const timedSpeech = compileTimedSpeech(storyboards, timeline);
  const speechLanguageError = validateSpeechLanguage(storyboards, options.language);
  if (speechLanguageError) throw new Error(speechLanguageError);

  const characters = [...new Set(storyboards.flatMap(storyboard => storyboard.characters || []))];
  const referenceAudioNames = (options.referenceAudioNames?.length
    ? options.referenceAudioNames
    : characterAudios.map(audio => audio.character)).filter(Boolean).slice(0, 3);
  const subjectId = new Map(characters.map((name, index) => [name, index + 1]));
  const audioId = new Map(referenceAudioNames.map((name, index) => [name, index + 1]));
  const speakerId = new Map(timedSpeech.map((line, index) => [line.character, index + 1]));
  const isFirstLastMode = Boolean(options.firstFrameUrl && storyboards.length === 1);
  const referenceOffset = options.firstFrameUrl ? 2 : 1;
  const exactLines = timedSpeech.map(line => line.exactLine);
  const compactMode = storyboards.length >= 3;
  const visualOverride = compactActionArc(sanitizeVisualDirection(options.visualOverride, exactLines), compactMode ? 260 : 520);
  const style = language === 'zh'
    ? CHINESE_H3_STYLE[String(first.visualStyle || 'cinematic-natural')] || CHINESE_H3_STYLE['cinematic-natural']
    : getProductionStylePreset(first.visualStyle).h3Direction;

  const dialogueByShot = new Map<number, string[]>();
  for (const line of timedSpeech) {
    const subject = subjectId.get(line.character);
    const audio = audioId.get(line.character);
    const localSpeaker = speakerId.get(line.character) || 1;
    const visibleSpeaker = language === 'zh'
      ? (subject ? `<Subject ${subject}>（${line.character}，S${localSpeaker}）` : `${line.character}（S${localSpeaker}）`)
      : (subject ? `<Subject ${subject}> (${line.character})` : line.character);
    const voiceReference = audio
      ? (language === 'zh' ? `，声音使用 <Audio ${audio}>` : `, using the voice timbre from <Audio ${audio}>`)
      : '';
    const onset = h3Timestamp(line.start);
    const tagged = `<d>[${dialogueLanguage(line.exactLine)}] ${line.exactLine}</d>`;
    const sentence = language === 'zh'
      ? `${onset} 开始，${visibleSpeaker}${voiceReference}，用${officialDialogueDelivery(line, language)}只说一次：${tagged}。说完最后一个字就闭嘴。`
      : `At ${onset}, ${visibleSpeaker} (S${localSpeaker})${voiceReference}, says ${officialDialogueDelivery(line, language)}: ${tagged} The mouth closes naturally when the final word inside the tag is complete.`;
    const lines = dialogueByShot.get(line.storyboardIndex) || [];
    lines.push(sentence);
    dialogueByShot.set(line.storyboardIndex, lines);
  }

  const shotParagraphs = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const picture = `<Picture ${index + referenceOffset}>`;
    const cast = (storyboard.characters || []).map(name => {
      const id = subjectId.get(name);
      return id ? `<Subject ${id}> (${name})` : name;
    }).join(language === 'zh' ? '、' : ', ');
    const objectNames = (storyboard.objects || []).slice(0, 5);
    const objects = objectNames.join(language === 'zh' ? '、' : ', ');
    const action = language === 'zh' ? chineseAuthoritativeAction(storyboard) : authoritativeShotAction(storyboard);
    const expression = officialVisibleExpression(storyboard, language);
    const framing = language === 'zh' ? chineseShotFraming(storyboard) : officialShotFraming(storyboard);
    const camera = language === 'zh' ? chineseCameraMotion(storyboard, index) : officialCameraMotion(storyboard, index);
    const dialogue = (dialogueByShot.get(index) || []).join(language === 'zh' ? '' : ' ');
    if (language === 'zh') {
      const actionSentence = /[。！？.!?]$/.test(action) ? action : `${action}。`;
      const castAlreadyNamed = (storyboard.characters || []).some(name => action.includes(name));
      const castSentence = cast && !castAlreadyNamed ? `画面中有${cast}。` : '';
      const remainingObjects = objectNames.filter(name => !action.includes(name));
      const objectSentence = remainingObjects.length ? `画面里还有${remainingObjects.join('、')}。` : '';
      const opening = index === 0
        ? `[Shot 1] ${picture} 是本镜头的起始画面。`
        : `[Shot ${index + 1}] ${h3Timestamp(range.start)} 切到 ${picture}。`;
      return `${opening}使用${framing}。${castSentence}${actionSentence}${objectSentence}${expression}。相机${camera}。人物位置随动作自然变化，不要突然换位置。${dialogue}`;
    }
    const actionSentence = /[.!?。！？]$/.test(action) ? action : `${action}.`;
    const opening = index === 0
      ? `[Shot 1] The shot begins from ${picture}. `
      : `[Shot ${index + 1}] At ${h3Timestamp(range.start)}, the camera cuts to a ${framing} beginning from ${picture}. `;
    return `${opening}${index === 0 ? `A ${framing} frames the action. ` : ''}${cast ? `${cast} ${cast.includes(',') ? 'are' : 'is'} visible. ` : ''}${objects ? `Visible objects include ${objects}. ` : ''}${actionSentence} ${expression} The camera uses ${camera}. The subjects move only through the described visible action while the established eyeline axis and screen sides remain stable. ${dialogue}`.trim();
  });

  const soundscape = buildAudioManifest(storyboards, language);
  const music = officialNoMusic(storyboards, language);
  const cleanFrame = language === 'zh'
    ? '画面里不要出现字幕、文字、标志、水印或界面。'
    : 'No subtitles, captions, titles, speech bubbles, logos, watermarks, interface graphics, or readable text appear in the frame.';
  const detailed = `${style}${visualOverride ? (language === 'zh' ? ` ${visualOverride}。` : ` ${visualOverride}.`) : ''} ${cleanFrame} ${language === 'zh' ? '只在动作发生时切镜头，不淡入、不淡出、不叠化。' : 'Cuts are motivated by visible action; no fades or dissolves.'}\n${shotParagraphs.join('\n')}`;

  if (isFirstLastMode) {
    const bindings = characters.map((name, index) => language === 'zh'
      ? `<Subject ${index + 1}> 是 <Picture 1> 和 <Picture 2> 中的${name}。两张图里是同一个人。`
      : `<Subject ${index + 1}> is ${name} in <Picture 1> and <Picture 2>; preserve the same identity across both pictures.`).join(' ');
    const alignment = language === 'zh'
      ? `<Picture 1> 是 0.00 秒的画面。<Picture 2> 是 ${duration.toFixed(2)} 秒的画面。`
      : `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${duration.toFixed(2)}-second mark of the target video.`;
    const prompt = `${alignment}\n\nintegrated_multimodal_description: ${bindings} ${detailed} ${language === 'zh' ? `视频结束时，画面变成 <Picture 2>。` : 'The shot naturally reaches the composition in <Picture 2> at the end.'}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`;
    return fitH3PromptBudget(language === 'zh' ? removeChineseVisibleCue(prompt) : prompt);
  }

  const pictureDefinitions = [
    ...(options.firstFrameUrl ? [language === 'zh'
      ? '<Picture 1> 是上一段视频的最后画面，也是本段视频 0.00 秒的画面。'
      : '<Picture 1> is the opening continuity frame inherited from the preceding clip and defines the visual state at 0.00 seconds.'] : []),
    ...storyboards.map((_, index) => language === 'zh'
      ? `<Picture ${index + referenceOffset}> 是 [Shot ${index + 1}] 的起始画面。人物、衣服、地点和光线保持一致。姿势和相机角度可以变化。`
      : `<Picture ${index + referenceOffset}> is the first frame of [Shot ${index + 1}]; preserve identity, wardrobe, location, and light, but not pose or viewpoint.`),
  ];
  const subjectDefinitions = characters.map((name, index) => {
    const pictures = storyboards.flatMap((storyboard, storyboardIndex) => storyboard.characters?.includes(name) ? [`<Picture ${storyboardIndex + referenceOffset}>`] : []);
    return language === 'zh'
      ? `<Subject ${index + 1}> 是${pictures.join('、') || '参考图片'}中的${name}。每个镜头里都是同一个人，脸、身体、头发、衣服和配饰不要改变。`
      : `<Subject ${index + 1}> is ${name} in ${pictures.join(', ') || 'the reference pictures'}; preserve the same face, body, hair, wardrobe, and accessories across all shots.`;
  });
  const audioDefinitions = referenceAudioNames.map((name, index) => {
    const subject = subjectId.get(name);
    const speaker = speakerId.get(name);
    return language === 'zh'
      ? `<Audio ${index + 1}> 是${subject ? `<Subject ${subject}>` : name}${speaker ? `（S${speaker}）` : ''}的声音参考。只学音色，不要复述参考音频里的内容。`
      : `<Audio ${index + 1}> is the voice-timbre reference for ${subject ? `<Subject ${subject}>` : name}${speaker ? ` (S${speaker})` : ''}; reference only the timbre, not the sample words, pauses, or timing.`;
  });
  const retention = [
    ...characters.map((name, index) => language === 'zh'
      ? `<Subject ${index + 1}>：${name}每次出现都是同一个人，衣服也相同。`
      : `<Subject ${index + 1}>: fully_preserved — ${name}'s identity and wardrobe remain consistent wherever the subject appears.`),
    ...pictureDefinitions.map((_, index) => language === 'zh'
      ? `<Picture ${index + 1}>：用作对应镜头的开头参考。`
      : `<Picture ${index + 1}>: reference — lock identity, world, and the opening state of its shot.`),
    ...audioDefinitions.map((_, index) => language === 'zh'
      ? `<Audio ${index + 1}>：只用来参考人物声音。`
      : `<Audio ${index + 1}>: reference — preserve voice identity only.`),
  ];
  const summaryPictures = storyboards.map((_, index) => `<Picture ${index + referenceOffset}>`).join(language === 'zh' ? '、' : ', ');
  const summary = language === 'zh'
    ? `用 ${summaryPictures} 生成一个 ${duration} 秒的视频，共 ${storyboards.length} 个连续镜头。${timedSpeech.length ? `片中有 ${timedSpeech.length} 段台词。` : '片中没有台词。'}`
    : `${summaryPictures} provide the opening references for ${storyboards.length} continuous shot${storyboards.length === 1 ? '' : 's'} in a ${duration}-second target video. ${timedSpeech.length ? `The video contains ${timedSpeech.length} dialogue event${timedSpeech.length === 1 ? '' : 's'}.` : 'The video contains no dialogue.'}`;

  const prompt = `subject_definitions:\n${[...subjectDefinitions, ...pictureDefinitions, ...audioDefinitions].join('\n')}\n\nsummary:\n${summary}\n\nretention_analysis:\n${retention.join('\n')}\n\ndetailed_description:\n${detailed}\n\noverall_soundscape:\n${soundscape}\n\nnon_diegetic_music:\n${music}`;
  return fitH3PromptBudget(language === 'zh' ? removeChineseVisibleCue(prompt) : prompt);
}

export function buildVideoSegmentPrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: VideoSegmentPromptOptions = {},
): string {
  return buildOfficialNaturalLanguagePrompt(storyboards, characterAudios, options);
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
