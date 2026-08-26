import { createVideoTask, getVideoTaskStatus } from './apimart';
import type { Storyboard } from '@/types';
import { buildVideoContinuityRules, getProductionStylePreset } from './promptArchitecture';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds } from './videoSegments';
import { buildAudioManifest, buildNonDiegeticMusic, compileTimedSpeech, isDirectingInstructionDialogue, storyboardAudioPlan, storyboardSpeech, validateSpeechLanguage } from './speechAudioContract';

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
  return `${text.slice(0, cut > limit * 0.65 ? cut : limit).trim()}${/[\u3400-\u9fff]/.test(text) ? '。' : '.'}`;
}

type H3TimelineDialogueEvent = {
  id: string;
  speaker: string;
  kind: 'on_screen' | 'off_screen';
  spoken_once: string;
  first_word_at: string;
  duration_policy: 'natural_from_exact_text';
  after_spoken_once: string;
  delivery: string;
};

function h3TimelineJson(value: Record<string, unknown>, compact = false): string {
  // H3's published prompt contract is section-based Context-IR rather than a
  // JSON API. Keep those official outer sections, but serialize the dense
  // shot timeline as valid JSON so dialogue, camera, action and sound cannot
  // collapse into one ambiguous prose sentence. Compact JSON is used for
  // multi-shot clips to preserve H3's 7000-character prompt ceiling.
  return JSON.stringify(value, null, compact ? 0 : 2);
}

function h3VoiceContract(eventCount: number): Record<string, unknown> {
  if (!eventCount) {
    return {
      priority: 'HIGHEST',
      intelligible_human_voice: false,
      legal_vocal_events: 0,
      every_moment: 'ROOM_TONE_ONLY_ZERO_VOICE',
      visual_cuts_are_audio_events: false,
      narrator: false,
      ad_lib: false,
      singing: false,
    };
  }
  return {
    priority: 'HIGHEST',
    legal_vocal_events: eventCount,
    vocalize_only: 'dialogue_events[].spoken_once',
    exact_verbatim_once: true,
    one_continuous_event_per_character: true,
    event_order_locked: true,
    duration_policy: 'NATURAL_FROM_EXACT_TEXT_NO_END_TIMESTAMP',
    after_each_event: 'STOP_AFTER_EXACT_FINAL_WORD_THEN_ROOM_TONE',
    fill_to_timeline_boundary: false,
    direction_data_vocalized: false,
    narrator: false,
    ad_lib: false,
    singing: false,
    every_other_moment: 'ROOM_TONE_ONLY_ZERO_VOICE',
    visual_cuts_are_audio_events: false,
    vocal_extras_or_reference_sample_leakage: false,
  };
}

function h3ReferenceAudioContract(): Record<string, unknown> {
  return {
    purpose: 'identity_timbre_only',
    ignore_source: 'words_phonemes_pauses_timing_semantics',
    reproduce_source_fragments: false,
  };
}

function h3FinalPriorityContract(): Record<string, unknown> {
  return {
    spoken_content: 'dialogue_events_only',
    other_time: 'nonvocal',
    conflicts: 'audio_event_lock_wins',
  };
}

function roundedTimelineBoundary(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function buildAuthoritativeTimeBlocks(
  timeline: Array<{ start: number; end: number }>,
  timedSpeech: ReturnType<typeof compileTimedSpeech>,
): Array<Record<string, unknown>> {
  if (!timeline.length) return [];
  const boundaries = [...new Set([
    ...timeline.flatMap(range => [roundedTimelineBoundary(range.start), roundedTimelineBoundary(range.end)]),
    // Speech end estimates remain an internal capacity check only. Publishing
    // them made H3 treat the estimate as a duration target and occasionally
    // invent syllables or words to fill the remaining time. Only the exact
    // onset is part of the model-facing timeline.
    ...timedSpeech.map(line => roundedTimelineBoundary(line.start)),
  ])].sort((a, b) => a - b);
  const startedShots = new Set<number>();

  return boundaries.slice(0, -1).flatMap((start, index) => {
    const end = boundaries[index + 1];
    if (end - start < 0.001) return [];
    const midpoint = start + (end - start) / 2;
    const shotIndex = Math.max(0, timeline.findIndex((range, rangeIndex) => (
      midpoint >= range.start - 0.001
      && (midpoint < range.end - 0.001 || rangeIndex === timeline.length - 1)
    )));
    // Dialogue timing exists only in dialogue_events[].first_word_at. Never
    // attach an event id, lip state or voice state to one of these interval
    // rows: a 00:00.800-00:10.300 visual block can otherwise look like a
    // 9.5-second speech target even when the actual line lasts four seconds.
    // These intervals are exclusively a visual shot/action index.
    const isFirstBlockOfShot = !startedShots.has(shotIndex);
    startedShots.add(shotIndex);
    const atShotEnd = Math.abs(end - timeline[shotIndex].end) < 0.002;
    const actionPhase = isFirstBlockOfShot && atShotEnd ? `VISUAL_S${shotIndex + 1}_EXECUTE_COMPLETE`
      : isFirstBlockOfShot ? `VISUAL_S${shotIndex + 1}_BEGIN`
        : atShotEnd ? `VISUAL_S${shotIndex + 1}_COMPLETE_HANDOFF` : `VISUAL_S${shotIndex + 1}_CONTINUE_NO_RESET`;
    return [{
      window: `${h3Timestamp(start)}-${h3Timestamp(end)}`,
      shot_contract: `S${shotIndex + 1}`,
      action_phase: actionPhase,
    }];
  });
}

function buildShotContracts(
  storyboards: Storyboard[],
  shotDescriptions: Array<Record<string, unknown>>,
  language: 'zh' | 'en',
  compact = false,
): Array<Record<string, unknown>> {
  return storyboards.map((storyboard, index) => {
    const shot = shotDescriptions[index] || {};
    const relationship = compactText(
      storyboard.stateBefore?.relationships
        || storyboard.stateAfter?.relationships
        || (language === 'zh' ? '保持已建立的人物关系、视线轴和银幕侧' : 'preserve established relationship, eyeline axis and screen sides'),
      70,
    );
    const cast = (storyboard.characters || []).join(language === 'zh' ? '、' : ', ');
    const hasContact = /(?:抓|握|按|压|推|拉|撞|触|夹|捏|踩|落地|击|碰|grip|grab|press|push|pull|strike|impact|touch|pinch|land|contact)/i
      .test(`${storyboard.action || ''} ${storyboard.description || ''}`);
    const motionPhysics = hasContact
      ? (language === 'zh'
          ? (compact ? '接近→接触→受力→释放→局部回弹' : '接近→接触→可见受力/压缩→增力→短暂保持→逐渐释放→局部回弹；只让受力区变形')
          : (compact ? 'approach→contact→load→release→local rebound' : 'approach, contact, visible load/compression, increase force, brief hold, gradual release, local rebound; deform only the loaded region'))
      : (language === 'zh'
          ? (compact ? '可信质量/加速度/跟随；不漂移' : '保持可信质量、加速度和跟随；不得匀速漂移')
          : (compact ? 'mass/acceleration/follow-through; no drift' : 'believable mass, acceleration and follow-through; no uniform drift'));
    const fullAction = language === 'zh' ? chineseAuthoritativeAction(storyboard) : authoritativeShotAction(storyboard);
    const actionLimit = compact && fullAction.length > 180 ? 120 : 240;
    return {
      id: `S${index + 1}`,
      reference: shot.visual_reference,
      cast: compact ? compactText(shot.cast, 58) : shot.cast,
      framing: shot.framing,
      camera: shot.camera,
      action: compactActionArc(fullAction, actionLimit),
      visual_transition: compactText(shot.transition_or_end, compact ? 180 : 260),
      motion_physics: motionPhysics,
      blocking_relation: compact
        ? (language === 'zh' ? `${cast || '无角色'}：关系/视线轴/银幕侧锁定；动作走位` : `${cast || 'no character'}: relation/axis/side locked; action-led blocking`)
        : (language === 'zh'
            ? `${relationship}；${cast || '无角色'}只按动作走位，不漂移/瞬移`
            : `${relationship}; ${cast || 'no character'} blocks only through action; no drift/teleport`),
      sound: shot.synchronized_sound,
    };
  });
}

function h3FrameTextContract(): Record<string, boolean> {
  return {
    subtitles: false,
    captions: false,
    titles_or_speech_bubbles: false,
    logos_watermarks_or_ui: false,
    readable_text: false,
    spoken_words_audio_only: true,
  };
}

function fitH3PromptBudget(prompt: string): string {
  if (prompt.length <= 7000) return prompt;
  const chineseTemplate = prompt.includes('叙事弧：') || prompt.includes('没有音乐。不得生成配乐');
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
      ? 'retention_analysis:\n保留所有已声明的身份、服装、世界和音色绑定。\n\ndetailed_description:'
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

function dialogueSafeVisualAction(value: unknown, exactSpokenLines: string[], language: 'zh' | 'en'): string {
  const visual = sanitizeVisualDirection(value, exactSpokenLines);
  if (!exactSpokenLines.length || !visual) return visual;

  // Native H3 can treat semantic screenplay prose as another utterance even
  // when the real line is correctly wrapped in <d>. Keep only observable
  // physical clauses in a speaking shot. In particular, never restate what a
  // product "means", what the audience learns, or what the line establishes.
  const semanticClause = language === 'zh'
    ? /(?:观众|受众|用户|听者|核心价值|优越性|产品价值|意义|观点|结论|真相|信息|定义为|理解|明白|意识到|认识到|相信|期待|好奇|关注|联想到|联系起来|说明|解释|强调|揭示|告诉|介绍|讲解|表达|传达)/i
    : /(?:audience|viewer|listener|meaning|core value|product value|benefit|message|conclusion|truth|information|understands?|realizes?|learns?|believes?|expects?|becomes? curious|focuses? on|connects?|explains?|emphasizes?|reveals?|tells?|introduces?|describes?|communicates?|establishes? that)/i;
  const clauses = visual
    // Do not split on an ASCII period: names such as "Dr. Pan" are common in
    // these prompts and must remain intact. Semantic tails are normally
    // separated by commas/semicolons; Chinese sentence punctuation is safe.
    .split(/(?<=[。！？；;])|\s*[,，]\s*/)
    .map(clause => clause.trim().replace(/[,，;；]+$/, ''))
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
  const microArc = /愤怒|生气|angry|anger|furious|confront/.test(source)
    ? 'brow, eyelids and jaw tighten toward the key phrase, then yield to the listener reaction'
    : /害怕|恐惧|紧张|fear|afraid|tense|anxious|uncertain/.test(source)
      ? 'breath and eyeline tighten, the mouth loses certainty, then the gaze tests the listener'
      : /悲|难过|伤心|哭|sad|grief|sorrow|broken/.test(source)
        ? 'held breath, wet lower eyelids and lip tension deepen without theatrical crying'
        : /坚定|果断|决心|determined|firm|resolute|decisive/.test(source)
          ? 'eyeline locks and posture settles on the decision, then excess tension releases'
          : 'breath, eyeline and facial tension change once, then hand the result to the listener';
  return `${emotionPhrase}, ${onsetPhrase}, ${pacePhrase}; ${microArc}`;
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
  // Consequence/listener fields often paraphrase the spoken proposition. H3
  // has demonstrably vocalized that prose before the tagged line, so a shot
  // with dialogue must express its result visually through the physical action
  // rather than repeating it as explanatory text.
  const visibleResult = spokenLines.length ? '' : sanitizeVisualDirection(storyboard.consequence || '', spokenLines);
  const includesResult = visibleResult && action.toLocaleLowerCase().includes(visibleResult.toLocaleLowerCase());
  const cast = (storyboard.characters || []).join(', ') || 'The visible subject';
  const fallbackAction = `${cast} performs one natural, restrained gesture with a single eyeline and weight shift while addressing the established listener`;
  return compactActionArc(
    // The screenplay action owns what happens. The image prompt is only a
    // static visual anchor and must never replace causal action. Preserve the
    // separately locked visible consequence too: this is what makes a shot
    // advance the story instead of ending on an attractive but empty pose.
    `${action || fallbackAction}${visibleResult && !includesResult ? ` Visible result: ${visibleResult}` : ''}`,
    320,
  );
}

function silentNarrativePerformance(storyboard: Storyboard): string {
  const spokenLines = storyboardSpeech(storyboard).map(line => line.exactLine);
  if (spokenLines.length) return '';
  const listenerChanges = (storyboard.speech || [])
    .map(line => line.listenerState)
    .filter((value): value is string => Boolean(value && !isDirectingInstructionDialogue(value)));
  // Only visible performance belongs in H3. Abstract screenplay explanations
  // are intentionally excluded because Ref2VA may vocalize prose. The action
  // field already contains trigger -> choice -> visible result.
  const parts = listenerChanges.length
    ? [`During the scheduled line, visibly perform the listener change: ${listenerChanges.join('; ')}`]
    : [];
  return compactText(sanitizeNarrativeDirection(parts, spokenLines), 220);
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
  const environment = plan.environment.length ? plan.environment.slice(0, 3).map(item => compactText(item, 42)).join(', ') : 'location room tone';
  const foley = plan.foley.length ? plan.foley.slice(0, 3).map(item => compactText(item, 42)).join(', ') : 'only sounds caused by the visible action';
  const humanLayer = plan.backgroundHuman === 'indistinct_nonverbal'
    ? 'Background people contribute only an indistinct nonverbal presence.'
    : '';
  if (!plan.environment.length && !plan.foley.length && !humanLayer) {
    return 'Only visibly caused contacts produce restrained synchronized Foley.';
  }
  return `The audible layer is ${environment}, with ${foley} synchronized to visible causes. ${humanLayer}`.trim();
}

function cinematicTransition(previous: Storyboard, next: Storyboard): string {
  const authoredBridge = compactText(previous.editBridge, 160);
  if (authoredBridge) {
    return `the authored story bridge: ${authoredBridge}`;
  }
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

function shotActionSchedule(storyboard: Storyboard, range: { start: number; end: number }, compact = false): string {
  const span = Math.max(0.1, range.end - range.start);
  const initiation = Math.min(range.end, range.start + Math.min(0.25, span * 0.08));
  const commitment = range.start + span * 0.28;
  const consequence = range.start + span * 0.62;
  const recovery = range.start + span * 0.84;
  // Keep detailed_description observable and playable. Abstract cause/pressure/
  // choice prose used to repeat the screenplay in several explanatory
  // sentences; Ref2VA occasionally vocalized those sentences as narration.
  // The authoritative action already contains the causal beat, so only send
  // the physical performance and its timing here.
  const narrative = silentNarrativePerformance(storyboard);
  const actionText = `${storyboard.action || ''} ${storyboard.description || ''}`.toLowerCase();
  const hasContact = /(?:抓|握|按|压|推|拉|撞|触|夹|捏|踩|落地|击|碰|grip|grab|press|push|pull|strike|impact|touch|pinch|land|contact)/i.test(actionText);
  const microPerformance = storyboard.clipType === 'reaction' || storyboard.clipType === 'dialogue' || storyboard.clipType === 'performance'
    ? 'Stagger micro-actions by 0.1–0.3s: eyes lead head; breath/eyeline lead brow and lids; mouth/jaw follow. Do not animate every facial channel continuously.'
    : 'Stagger anticipation, weight shift, limb action and follow-through by 0.1–0.3s; do not launch every body part together.';
  const contactPhysics = hasContact
    ? 'Physical contact sequence: approach, touch, visible compression/load, increase force, brief hold, gradual release, then local rebound/inertia; only the loaded region deforms.'
    : 'Preserve believable mass, acceleration and follow-through; no uniform-speed drift.';
  if (storyboardSpeech(storyboard).length) {
    const action = authoritativeShotAction(storyboard);
    const actionSentence = /[.!?。！？]$/.test(action) ? action : `${action}.`;
    return compact
      ? `${actionSentence} Real time. Start once at first_word_at; natural pace; stop and close mouth after the exact tagged text. No end time or fill. Residual motion; no slow motion.`
      : `${actionSentence} Keep the visible action continuous at real-time speed. Start the tagged line only at first_word_at, speak the exact text once at a natural conversational pace, and stop immediately after its natural final word; there is no target end timestamp to fill. Then close the mouth and preserve a motivated reaction or residual motion through the end of the shot; no slow motion or extended hold.`;
  }
  if (compact) {
    return `${authoritativeShotAction(storyboard)} Start by ${h3Timestamp(initiation)}; one peak/consequence by ${h3Timestamp(consequence)}; recover by ${h3Timestamp(recovery)} with 0.2–0.4s residual. Stagger channels 0.1–0.3s; ${hasContact ? 'contact→load→release→local rebound' : 'preserve mass/acceleration'}. Real time; no slow motion.`;
  }
  return `${authoritativeShotAction(storyboard)} ${narrative ? `Silent performance: ${narrative}` : ''} Start by ${h3Timestamp(initiation)}; commit by ${h3Timestamp(commitment)}; one action peak and visible consequence by ${h3Timestamp(consequence)}; release/recover by ${h3Timestamp(recovery)}; preserve 0.2–0.4s residual motion or expression into ${h3Timestamp(range.end)}. ${microPerformance} ${contactPhysics} Real-time cycle; no slow motion/extended holds. Cadence: ${shotMotionCadence(storyboard)}`;
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
  'follow-reference': '严格继承参考图的媒介、镜头表现、表演尺度和运动节奏；相机运动必须由动作驱动，剪辑遵循因果，不得出现通用的 AI 漂移感。',
  'cinematic-natural': '真实自然的实拍电影质感：皮肤与布料真实，曝光宽容度有限，白平衡自然，运动模糊符合光学规律；相机保留轻微人为惯性与对焦恢复。表演克制，以潜台词和微反应推进，按真实速度运动，不默认慢动作。',
  'warm-film': '温暖的光化学胶片记忆感：皮肤有纹理，暖色实景光源、轻微光晕和细颗粒；表演亲密且有触感，相机呼吸自然，剪辑抒情但持续推进，不得全程慢动作。',
  'neo-noir': '冷峻黑色电影压力感：暗部保留纹理，硬质有源轮廓光、遮挡与负空间明确；表演防御克制，延迟反应后完成一次果断动作，并在突然揭示前短暂停顿。',
  documentary: '手机、微单或肩扛摄影机的观察纪录质感：使用现场光、日常反差、轻微手持抖动、自动对焦和曝光恢复以及不完美的再构图；行为像现场发生，只在动作或反应被发现时剪切。',
  commercial: '高级商业影像的精确质感：高光受控，材质反应准确，视差可重复；接触动作编排清晰，以快速证据特写推进，并落到一个明确的主视觉结果。',
  anime: '电影级二维动画：线条与角色模型稳定；动作按预备、关键姿势、撞点、恢复组织，轮廓清楚，视差受控，只在情绪标点处使用冲击切和目的明确的停格。',
  '3d-cg': '电影级三维动画：拓扑和物理材质稳定；运动有重量、加减速、接触压缩与回落；虚拟摄影机遵循真实镜头规律，以轮廓和动作剪辑，不得使用通用环绕镜头。',
  'stop-motion': '手工定格动画：微缩材质可触摸，逐姿势推进并保留逐帧纹理、接触与回落；使用固定或桌面摄影机，动作节点清楚，不得出现光滑的三维插值。',
};

function chinesePerformanceControl(emotion: string, delivery: string): string {
  const source = `${emotion || ''} ${delivery || ''}`.toLowerCase();
  const emotionPhrase = /坚定|果断|决心|determined|firm|resolute/.test(source)
    ? '克制而坚定'
    : /害怕|恐惧|紧张|fear|afraid|tense|anxious/.test(source)
      ? '收住的紧张感'
      : /悲|难过|伤心|sad|grief|sorrow/.test(source)
        ? '克制的悲伤'
        : /愤怒|生气|angry|anger|furious/.test(source)
          ? '压住的愤怒'
          : /喜悦|开心|温柔|happy|warm|gentle|joy/.test(source)
            ? '细微的温暖'
            : '符合场景且克制的情绪';
  const onsetPhrase = /停顿|沉默|pause|hesitat/.test(source) ? '先有一次短暂自然停顿' : '自然直接起声';
  const pacePhrase = /快速|急促|fast|quick|urgent/.test(source)
    ? '使用偏快的对话语速'
    : /缓慢|慢速|slow|measured/.test(source)
      ? '使用有分寸的对话语速'
      : '使用自然对话语速';
  const microArc = /愤怒|生气|angry|anger|furious|confront/.test(source)
    ? '眉眼和下颌在关键词处收紧，随后把结果交给听者反应'
    : /害怕|恐惧|紧张|fear|afraid|tense|anxious|uncertain/.test(source)
      ? '呼吸和视线先收紧，嘴部失去确定感，随后用目光试探听者'
      : /悲|难过|伤心|哭|sad|grief|sorrow|broken/.test(source)
        ? '屏住的呼吸、湿润的下眼睑和嘴唇张力加深，但不戏剧化哭泣'
        : /坚定|果断|决心|determined|firm|resolute|decisive/.test(source)
          ? '视线锁定，姿态在决定处落稳，随后释放多余张力'
          : '呼吸、视线和面部张力只变化一次，随后把结果交给听者';
  return `${emotionPhrase}，${onsetPhrase}，${pacePhrase}；${microArc}`;
}

function chineseCameraMotion(storyboard: Storyboard, index: number): string {
  const source = `${storyboard.cameraMove || ''} ${storyboard.description || ''}`.toLowerCase();
  if (/(?:静止|固定|static|locked)/i.test(source)) return '整段固定机位';
  if (/(?:手持|handheld|shoulder)/i.test(source)) return '克制的中速手持跟随；跟住动作后落稳，不漂浮';
  if (/(?:拉远|拉出|pull out|dolly out|zoom out)/i.test(source)) return '小幅中速拉远，揭示改变后的空间状态';
  if (/(?:推近|推进|推镜|push in|dolly in|zoom in)/i.test(source)) return '小幅中速推近，落在决定性反应上';
  if (/(?:左摇|pan left)/i.test(source)) return '小幅中速向左摇镜，揭示下一信息';
  if (/(?:右摇|pan right)/i.test(source)) return '小幅中速向右摇镜，揭示下一信息';
  if (/(?:摇|pan)/i.test(source)) return '小幅中速摇镜，跟随可见动作';
  if (/(?:横移|左移|右移|truck|slide)/i.test(source)) return '小幅中速横移，保持运动方向和视差';
  if (/(?:跟|tracking|follow)/i.test(source)) return '小幅中速跟随主体，落在动作后果上';
  if (/(?:升|pedestal up|crane up|tilt up)/i.test(source)) return '小幅中速上升，揭示改变后的垂直关系';
  if (/(?:降|pedestal down|crane down|tilt down)/i.test(source)) return '小幅中速下降，落在动作细节上';
  switch (storyboard.clipType) {
    case 'establishing': return '用一次有目的的横向或纵向揭示在一秒内建立空间，然后落稳';
    case 'insert': return '稳定展示细节，只做一次短暂再构图或焦点落位，不漂移';
    case 'reaction': return '一次短促克制的推近，落在变化后的表情上，然后稳定';
    case 'dialogue':
    case 'performance': return '以稳定的关系构图为主，只做一次由动作驱动的轻微弧移或推近，不持续漂移';
    case 'action': return '中速跟随主体，在决定性接触中保持速度和银幕方向';
    case 'montage': return '一次短促明确的摇镜或再构图，与动作节点同时落下';
    case 'long_take': return '一次由人物调度驱动的连续跟随，空间清楚并以真实速度持续推进';
    default: return index === 0 ? '中速跟随动作；从运动中开始并落在结果上' : '一次短促的动作跟随，落在改变后的状态上';
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
              : '由剧情决定的景别';
  const angle = /仰|low angle/.test(framing) ? '低机位仰拍'
    : /俯|top|high angle/.test(framing) ? '高机位俯拍'
      : /过肩|over.?shoulder/.test(framing) ? '过肩机位'
        : /fpv|主观/.test(framing) ? '角色主观机位'
          : '自然视平线机位';
  return `${size}，${angle}`;
}

function chineseShotCadence(storyboard: Storyboard): string {
  switch (storyboard.clipType) {
    case 'insert':
    case 'montage': return '按真实速度紧凑推进；从动作中进入，加速到一个清晰撞点，再短暂落稳；不得慢动作';
    case 'reaction': return '触发和反应均按真实速度；只保留一个短暂可读标点，随后继续；不得慢动作';
    case 'dialogue':
    case 'performance': return '自然对话速度；手势只辅助台词，不拉长台词；不得留空停顿';
    case 'long_take': return '持续的真实速度调度，压力变化且不断推进；不得慢动作';
    case 'establishing': return '主动、真实速度地揭示空间并落在故事主体上；不得空泛漂移';
    default: return '按真实速度果断推进；加速到撞点或决定，再短暂落稳；不得慢动作';
  }
}

function chineseShotSoundCue(storyboard: Storyboard): string {
  const plan = storyboardAudioPlan(storyboard);
  const environment = plan.environment.length ? plan.environment.slice(0, 3).map(item => compactText(item, 42)).join('、') : '场景底噪';
  const foley = plan.foley.length ? plan.foley.slice(0, 3).map(item => compactText(item, 42)).join('、') : '仅画面可见动作造成的声音';
  const humanLayer = plan.backgroundHuman === 'indistinct_nonverbal' ? '背景人物只能形成模糊、不可辨词义的非语言声层。' : '';
  if (!plan.environment.length && !plan.foley.length && !humanLayer) return '只为画面中明确发生的接触生成克制且同步的拟音。';
  return `可听声层为${environment}；${foley}只与画面中可见的成因同步。${humanLayer}`;
}

function chineseTransition(previous: Storyboard, next: Storyboard): string {
  const rawBridge = compactText(previous.editBridge, 160);
  // Story-planning scaffold keys are useful to the writer but are not visual
  // directions. Never leak placeholders such as `centralDramaticQuestion` or
  // English `causal trigger / audienceInference` labels into a Chinese H3
  // prompt; H3 may both mis-stage them and attempt to vocalize them.
  const authoredBridge = /(?:[A-Za-z]{3,}|[a-z]+_[a-z_]+)/.test(rawBridge)
    ? ''
    : rawBridge;
  if (authoredBridge) return `按剧本指定的视觉交接：${authoredBridge}`;
  const previousCharacters = new Set(previous.characters || []);
  const sharedCharacters = (next.characters || []).filter(name => previousCharacters.has(name));
  const previousObjects = new Set(previous.objects || []);
  const sharedObjects = (next.objects || []).filter(name => previousObjects.has(name));
  if (next.continuousFromPrev || next.continuityFrom === previous.id || (next.continuityFrom && next.continuityFrom === `scene-${previous.sceneNumber}`)) {
    return '在动作中做动作匹配切，保持矢量、速度、银幕方向和物理状态';
  }
  const role = String(next.montageRole || '').toLowerCase();
  if (/(?:contrast|对照)/.test(role)) return '使用对照切，让动作、尺度或价值的改变产生新含义，同时延续故事问题';
  if (/(?:parallel|平行)/.test(role)) return '匹配同时发生的动作、方向或有因声音，让两种处境形成一个平行戏剧概念';
  if ((previous.consequence || previous.nextCause) && next.cause) return '从可见后果直接因果切入下一物理触发';
  if (sharedObjects.length) return `匹配${sharedObjects[0]}的运动或接触，切到它改变后的状态`;
  if (sharedCharacters.length) return `由${sharedCharacters[0]}的视线或手势带出匹配切，并保持银幕方向`;
  if (previous.sequenceId === next.sequenceId && previous.locationId === next.locationId) {
    return previous.sceneNumber % 2 === 0
      ? '用穿过画面的身体或道具形成前景遮挡藏切，并保持空间与速度'
      : '使用焦点接力：前镜主体离开焦平面时，下一主体在相同空间关系中变清晰';
  }
  return '使用共享的运动矢量、形状、有因光线变化或画面动作造成的声音完成匹配切并进入新空间';
}

function chineseAuthoritativeAction(storyboard: Storyboard): string {
  const spokenLines = storyboardSpeech(storyboard).map(line => line.exactLine);
  const action = dialogueSafeVisualAction(storyboard.action || storyboard.description, spokenLines, 'zh');
  const result = spokenLines.length ? '' : sanitizeVisualDirection(storyboard.consequence || '', spokenLines);
  const includesResult = result && action.toLocaleLowerCase().includes(result.toLocaleLowerCase());
  const cast = (storyboard.characters || []).join('、') || '画面主体';
  const fallbackAction = `${cast}面对既定交流对象，以一次自然克制的手势、视线变化和重心转移完成可见表演`;
  return compactActionArc(`${action || fallbackAction}${result && !includesResult ? ` 可见后果：${result}` : ''}`, 320);
}

function chineseSilentPerformance(storyboard: Storyboard): string {
  const spokenLines = storyboardSpeech(storyboard).map(line => line.exactLine);
  if (spokenLines.length) return '';
  const listenerChanges = (storyboard.speech || [])
    .map(line => line.listenerState)
    .filter((value): value is string => Boolean(value && !isDirectingInstructionDialogue(value)));
  return listenerChanges.length
    ? compactText(sanitizeNarrativeDirection(`在计划台词期间，只用可见表演呈现听者变化：${listenerChanges.join('；')}`, spokenLines), 220)
    : '';
}

function chineseShotSchedule(storyboard: Storyboard, range: { start: number; end: number }, compact = false): string {
  const span = Math.max(0.1, range.end - range.start);
  const initiation = Math.min(range.end, range.start + Math.min(0.25, span * 0.08));
  const commitment = range.start + span * 0.28;
  const consequence = range.start + span * 0.62;
  const recovery = range.start + span * 0.84;
  const actionText = `${storyboard.action || ''} ${storyboard.description || ''}`.toLowerCase();
  const hasContact = /(?:抓|握|按|压|推|拉|撞|触|夹|捏|踩|落地|击|碰|grip|grab|press|push|pull|strike|impact|touch|pinch|land|contact)/i.test(actionText);
  const action = chineseAuthoritativeAction(storyboard);
  if (storyboardSpeech(storyboard).length) {
    const actionSentence = /[。！？]$/.test(action) ? action : `${action}。`;
    return compact
      ? `${actionSentence}真实速度；只在 first_word_at 开始一次，自然语速说完准确标签文字后立即停声闭嘴；无结束时间，不填充。保留残余动作；不得慢动作。`
      : `${actionSentence}可见动作按真实速度连续完成；只在 first_word_at 开始标签中的准确台词，以自然对话语速完整说一次，说完自然的最后一个字立即停止，不得为了对齐时间补音、加字或拖长；提示词不规定台词结束时间。随后嘴闭合，只保留有动机的反应或残余动作直到镜头结束；不得慢动作或延长停顿。`;
  }
  if (compact) {
    return `${action} 最迟 ${h3Timestamp(initiation)} 启动；在 ${h3Timestamp(consequence)} 前完成一个动作峰值及其后果；到 ${h3Timestamp(recovery)} 恢复，并保留 0.2–0.4 秒残余状态。各动作通道错开 0.1–0.3 秒；${hasContact ? '接近→接触→受力→释放→局部回弹' : '保持可信的质量与加速度'}。真实速度，不得慢动作。`;
  }
  const narrative = chineseSilentPerformance(storyboard);
  const micro = storyboard.clipType === 'reaction' || storyboard.clipType === 'dialogue' || storyboard.clipType === 'performance'
    ? '微动作错开 0.1–0.3 秒：眼睛先于头，呼吸和视线先于眉眼，嘴和下颌随后；不要让所有面部通道持续运动。'
    : '预备、重心转移、肢体动作和跟随错开 0.1–0.3 秒；不要让所有身体部位同时启动。';
  const physics = hasContact
    ? '物理接触按接近、触碰、可见压缩或蓄力、增力、短暂保持、逐渐释放、局部惯性或弹性回弹推进；只有受力区域明显变形。'
    : '保持可信的质量、加速度和跟随；不得匀速漂移。';
  return `${action}${narrative ? ` 无声表演：${narrative}` : ''} 最迟 ${h3Timestamp(initiation)} 启动；到 ${h3Timestamp(commitment)} 完成动作承诺；在 ${h3Timestamp(consequence)} 前完成一个动作峰值及其可见后果；到 ${h3Timestamp(recovery)} 释放或恢复；把 0.2–0.4 秒残余动作或表情延续至 ${h3Timestamp(range.end)}。${micro}${physics}完整动作周期按真实速度完成；不得慢动作或延长停顿。节奏：${chineseShotCadence(storyboard)}`;
}

function chineseArcRole(value: unknown): string {
  const role = String(value || '').toLowerCase();
  if (/establish|setup|opening|建立|开场/.test(role)) return '建立';
  if (/reaction|反应/.test(role)) return '反应';
  if (/decision|choice|决定|选择/.test(role)) return '决定';
  if (/consequence|result|结果|后果/.test(role)) return '后果';
  if (/climax|高潮/.test(role)) return '高潮';
  if (/resolution|结局|收束/.test(role)) return '收束';
  return '发展';
}

function buildChineseVideoSegmentPrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: VideoSegmentPromptOptions = {},
): string {
  const first = storyboards[0];
  if (!first) throw new Error('视频片段至少需要一个分镜');
  const duration = Math.min(15, Math.max(4, options.duration || estimateVideoSegmentSeconds(storyboards)));
  const compactMode = storyboards.length >= 3;
  const timeline = allocateSegmentTimeline(storyboards, duration);
  const characters = [...new Set(storyboards.flatMap(storyboard => storyboard.characters || []))];
  const isFirstLastMode = Boolean(options.firstFrameUrl && storyboards.length === 1);
  const referenceOffset = options.firstFrameUrl ? 2 : 1;
  const timedSpeech = compileTimedSpeech(storyboards, timeline);
  const speechLanguageError = validateSpeechLanguage(storyboards, 'zh');
  if (speechLanguageError) throw new Error(speechLanguageError);
  const referenceAudioNames = (options.referenceAudioNames?.length ? options.referenceAudioNames : characterAudios.map(audio => audio.character)).filter(Boolean).slice(0, 3);
  const subjectId = new Map(characters.map((name, index) => [name, index + 1]));
  const audioId = new Map(referenceAudioNames.map((name, index) => [name, index + 1]));
  const speechEventCount = timedSpeech.length;
  const voiceContract = h3VoiceContract(speechEventCount);

  const renderDialogue = (): H3TimelineDialogueEvent[] => timedSpeech
    .map((line, lineIndex) => {
      const subject = subjectId.get(line.character);
      const audio = audioId.get(line.character);
      const source = subject
        ? `<Subject ${subject}>${audio ? `/<Audio ${audio}>` : ''}`
        : audio ? `<Audio ${audio}>` : 'ON_SCREEN_SPEAKER';
      const volume = line.volume === 'raised' ? 'CONTROLLED_RAISED'
        : line.volume === 'soft' ? 'SOFT'
          : line.volume === 'whisper' ? 'RESTRAINED_WHISPER'
            : 'NATURAL';
      const start = h3Timestamp(line.start);
      return {
        id: `D${lineIndex + 1}`,
        speaker: source,
        kind: line.lipSync ? 'on_screen' : 'off_screen',
        spoken_once: `<d>[${dialogueLanguage(line.exactLine)}] ${line.exactLine}</d>`,
        first_word_at: start,
        duration_policy: 'natural_from_exact_text',
        after_spoken_once: line.lipSync ? 'stop_voice_and_close_mouth' : 'stop_voice_keep_visible_mouths_closed',
        delivery: `${volume}_CONVERSATIONAL_RESTRAINED_ONE_ARC`,
      };
    });
  const dialogueEvents = renderDialogue();

  const shotDescriptions = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const shotSeconds = Math.max(0.1, range.end - range.start);
    const referenceNumber = index + referenceOffset;
    const beatCharacters = [...new Set(storyboard.characters || [])];
    const cast = beatCharacters.length
      ? `可见角色各只出现一个：${beatCharacters.map(name => subjectId.get(name) ? `<Subject ${subjectId.get(name)}>（${name}）` : name).join('、')}；不得出现其他故事角色。`
      : '本镜头不出现故事角色。';
    const entry = index === 0
      ? options.firstFrameUrl ? '继承的首帧已经处于运动中；延续其动势、视线和相机惯性。' : '直接从可见动作开始，并在一秒内建立必要的空间关系。'
      : `从 [Shot ${index}] 的有因物理转场连续进入。`;
    const pictureAnchor = isFirstLastMode
      ? index === storyboards.length - 1 ? `<Picture 2> 只规定最终构图。最迟在 ${h3Timestamp(range.start + shotSeconds * 0.84)} 完成主体动作；最后 16% 时长自然落入该构图；不得匀速插值或把一个手势放慢。` : ''
      : `<Picture ${referenceNumber}> 规定本镜头起始视觉状态。`;
    const handoff = index < storyboards.length - 1
      ? `在 ${h3Timestamp(range.end)}，通过${chineseTransition(storyboard, storyboards[index + 1])}进入 [Shot ${index + 2}]。`
      : `到 ${h3Timestamp(range.end)}，保留一个有动机的动作、视线或后果，不得停成僵死画面。`;
    const props = (storyboard.objects || []).length ? `可见故事道具为：${(storyboard.objects || []).join('、')}。` : '';
    if (compactMode) {
      const compactCast = beatCharacters.length
        ? `角色各一次：${beatCharacters.map(name => subjectId.get(name) ? `<Subject ${subjectId.get(name)}>（${name}）` : name).join('、')}；无额外角色。`
        : '没有角色。';
      return {
        shot: index + 1,
        range: `${h3Timestamp(range.start)}-${h3Timestamp(range.end)}`,
        visual_reference: pictureAnchor,
        cast: compactCast,
        framing: chineseShotFraming(storyboard),
        visual_action: chineseShotSchedule(storyboard, range, true),
        camera: compactText(chineseCameraMotion(storyboard, index), 90),
        transition_or_end: compactText(handoff, 180),
      };
    }
    return {
      shot: index + 1,
      range: `${h3Timestamp(range.start)}-${h3Timestamp(range.end)}`,
      entry,
      visual_reference: pictureAnchor,
      cast,
      props,
      framing: chineseShotFraming(storyboard),
      visual_action: chineseShotSchedule(storyboard, range),
      camera: chineseCameraMotion(storyboard, index),
      synchronized_sound: chineseShotSoundCue(storyboard),
      transition_or_end: handoff,
    };
  });
  const shotContracts = buildShotContracts(storyboards, shotDescriptions, 'zh', compactMode || storyboards.length > 1);
  const timeBlocks = buildAuthoritativeTimeBlocks(timeline, timedSpeech);

  const visualOverride = compactActionArc(sanitizeVisualDirection(options.visualOverride, timedSpeech.map(line => line.exactLine)), compactMode ? 360 : 720);
  const styleOpening = `${CHINESE_H3_STYLE[String(first.visualStyle || 'cinematic-natural')] || CHINESE_H3_STYLE['cinematic-natural']}${visualOverride ? ` 补充画面要求：${visualOverride}。这段补充只影响画面，不得改变动作、对白或声音。` : ''} 剪辑必须由物理动作或因果推动，不得淡入淡出或叠化。`;
  const fittedPhysics = compactMode
    ? '保持因果、身份、服装、空间、光线、银幕方向、身体与布料及道具重量和对白视线轴。所有带时间的字段具有最高约束力；不得舞台化表演或慢动作。'
    : '保持连续因果和可信的身体、布料与道具重量。保持空间、光线、银幕方向以及对白视线轴和人物画面侧；只有通过可见的中性运动才能越轴。每个身份只出现一次，脸、身体、头发、服装保持稳定。所有带时间的字段具有最高约束力。表演通过呼吸、视线、面部张力和重心变化推进；不得舞台化表演或持续喊叫。';
  const soundscape = buildAudioManifest(storyboards, 'zh');
  const nonDiegeticMusic = buildNonDiegeticMusic(storyboards, 'zh');
  const timelineJson = h3TimelineJson({
    schema: 'aid_h3_timeline_v5',
    duration: `${duration.toFixed(3)}s`,
    silent_direction_data: true,
    audio_event_lock: voiceContract,
    dialogue_events: dialogueEvents,
    reference_audio_contract: h3ReferenceAudioContract(),
    visual_style: compactMode ? compactText(styleOpening, 70) : styleOpening,
    frame_text_policy: h3FrameTextContract(),
    shot_contracts: shotContracts,
    timeline: timeBlocks,
    continuity: fittedPhysics,
    final_priority: h3FinalPriorityContract(),
  }, compactMode || storyboards.length > 1);

  if (isFirstLastMode) {
    const firstLastBindings = [
      ...characters.map((name, index) => `<Subject ${index + 1}> 是 <Picture 1> 与 <Picture 2> 中的${name}；两张图保持同一身份。`),
      ...referenceAudioNames.map((name, index) => {
        const subject = subjectId.get(name);
        return `<Audio ${index + 1}> 只提供${subject ? `<Subject ${subject}>` : name}的音色；忽略样本原词和时序。`;
      }),
    ].join(' ');
    return fitH3PromptBudget(`参考图片与目标视频的时间对齐——Picture 1（来自 Shot 1）对应目标视频 0.00 秒；Picture 2（来自 Shot 1）对应目标视频 ${duration.toFixed(2)} 秒。

integrated_multimodal_description: ${firstLastBindings}
timeline_json:
${timelineJson}

overall_soundscape: ${soundscape}

non_diegetic_music: ${nonDiegeticMusic}`);
  }

  const pictureDefinitions = [
    ...(options.firstFrameUrl ? ['<Picture 1> 是从上一段生成视频继承的连续性首帧，精确规定 0.00 秒的状态。'] : []),
    ...storyboards.map((_, index) => `<Picture ${index + referenceOffset}> 规定 [Shot ${index + 1}] 的起始视觉状态；保留身份、服装、地点和光线，不锁定姿势或视点。`),
  ];
  const subjectDefinitions = characters.map((name, index) => {
    const pictures = storyboards.flatMap((storyboard, storyboardIndex) => storyboard.characters?.includes(name) ? [`<Picture ${storyboardIndex + referenceOffset}>`] : []);
    return `<Subject ${index + 1}> 是${pictures.join('、') || '参考素材'}中的${name}；脸、身体、头发、服装和配饰必须始终属于同一个身份。`;
  });
  const audioDefinitions = referenceAudioNames.map((name, index) => {
    const subject = subjectId.get(name);
    return `<Audio ${index + 1}> 只提供${subject ? `<Subject ${subject}>` : name}的音色身份；忽略样本原有词语和时序，不得模仿样本台词。`;
  });
  const retention = [
    ...subjectDefinitions.map((_, index) => compactMode
      ? `<Subject ${index + 1}>：保留身份和服装。`
      : `<Subject ${index + 1}>：在${storyboards.flatMap((storyboard, shotIndex) => storyboard.characters?.includes(characters[index]) ? [`[Shot ${shotIndex + 1}]`] : []).join('、')}中完整保留身份和服装。`),
    ...pictureDefinitions.map((_, index) => `<Picture ${index + 1}>：作为视觉参考；锁定身份和世界，不锁定姿势或视点。`),
    ...audioDefinitions.map((_, index) => `<Audio ${index + 1}>：只提供音色；忽略源音频的词语和时序。`),
  ];
  const summaryPictures = storyboards.map((_, index) => `<Picture ${index + referenceOffset}>`).join('、');
  const narrativeArc = storyboards.map(storyboard => chineseArcRole(storyboard.montageRole || storyboard.clipType)).join('→');

  return fitH3PromptBudget(`subject_definitions:
${[...subjectDefinitions, ...pictureDefinitions, ...audioDefinitions].join('\n')}

summary:
[${options.firstFrameUrl ? '关键帧和' : ''}参考素材${audioDefinitions.length ? '及音频' : ''}] ${summaryPictures}；${storyboards.length} 个因果镜头 / ${duration} 秒 / 同一个制作世界；${speechEventCount ? `${speechEventCount} 个计划对白事件，除此之外没有人声` : '没有人声'}。叙事弧：${narrativeArc || '发展→后果'}。

retention_analysis:
${retention.join('\n')}

detailed_description:
timeline_json:
${timelineJson}

overall_soundscape:
${soundscape}

non_diegetic_music:
${nonDiegeticMusic}`);
}

export function buildVideoSegmentPrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: VideoSegmentPromptOptions = {},
): string {
  if (options.language === 'zh') {
    return buildChineseVideoSegmentPrompt(storyboards, characterAudios, options);
  }
  const first = storyboards[0];
  if (!first) throw new Error('视频片段至少需要一个分镜');
  const duration = Math.min(15, Math.max(4, options.duration || estimateVideoSegmentSeconds(storyboards)));
  // Three detailed shots plus multiple voice identities can already exceed
  // H3's hard prompt ceiling after adding complete micro-action timing. Use
  // the lossless compact form from three shots onward; it removes duplicated
  // look/sound prose, never actions, exact dialogue or timestamps.
  const compactMode = storyboards.length >= 3;
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
  const audioId = new Map(referenceAudioNames.map((name, index) => [name, index + 1]));
  const speechEventCount = timedSpeech.length;
  const voiceContract = h3VoiceContract(speechEventCount);

  const renderDialogue = (): H3TimelineDialogueEvent[] => timedSpeech
    .map((line, lineIndex) => {
      const name = line.character;
      const text = line.exactLine;
      const subject = subjectId.get(name);
      const audio = audioId.get(name);
      const source = subject
        ? `<Subject ${subject}>${audio ? `/<Audio ${audio}>` : ''}`
        : audio ? `<Audio ${audio}>` : 'ON_SCREEN_SPEAKER';
      const volume = line.volume === 'raised' ? 'CONTROLLED_RAISED'
        : line.volume === 'soft' ? 'SOFT'
          : line.volume === 'whisper' ? 'RESTRAINED_WHISPER'
            : 'NATURAL';
      const start = h3Timestamp(line.start);
      return {
        id: `D${lineIndex + 1}`,
        speaker: source,
        kind: line.lipSync ? 'on_screen' : 'off_screen',
        spoken_once: `<d>[${dialogueLanguage(text)}] ${text}</d>`,
        first_word_at: start,
        duration_policy: 'natural_from_exact_text',
        after_spoken_once: line.lipSync ? 'stop_voice_and_close_mouth' : 'stop_voice_keep_visible_mouths_closed',
        delivery: `${volume}_CONVERSATIONAL_RESTRAINED_ONE_ARC`,
      };
    });
  const dialogueEvents = renderDialogue();

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
    const pictureAnchor = isFirstLastMode
      ? index === storyboards.length - 1
        ? `<Picture 2> is final composition only. Finish primary action by ${h3Timestamp(range.start + shotSeconds * 0.84)}; use final 16% to resolve into it; do not uniformly interpolate or slow one gesture.`
        : ''
      : `<Picture ${referenceNumber}> starts this shot.`;
    const handoff = index < storyboards.length - 1
      ? `At ${h3Timestamp(range.end)}, move into [Shot ${index + 2}] by ${cinematicTransition(storyboard, storyboards[index + 1])}.`
      : `By ${h3Timestamp(range.end)}, leave a motivated motion, eyeline or consequence rather than a dead hold.`;
    const props = (storyboard.objects || []).length
      ? `The visible story props are ${(storyboard.objects || []).join(', ')}.`
      : '';
    if (compactMode) {
      const compactCast = beatCharacters.length
        ? `Cast once: ${beatCharacters.map(name => subjectId.get(name) ? `<Subject ${subjectId.get(name)}> (${name})` : name).join(', ')}; no extras.`
        : 'No character.';
      // The full ambience/Foley manifest is emitted once below. In a dense
      // four-shot segment this per-shot cue only needs the synchronized cause;
      // keeping another 135 characters per shot could push a valid causal
      // prompt over H3's 7000-character ceiling.
      return {
        shot: index + 1,
        range: `${h3Timestamp(range.start)}-${h3Timestamp(range.end)}`,
        visual_reference: pictureAnchor,
        cast: compactCast,
        framing: officialShotFraming(storyboard),
        visual_action: shotActionSchedule(storyboard, range, true),
        camera: compactText(officialCameraMotion(storyboard, index), 90),
        transition_or_end: compactText(handoff, 180),
      };
    }
    return {
      shot: index + 1,
      range: `${h3Timestamp(range.start)}-${h3Timestamp(range.end)}`,
      entry,
      visual_reference: pictureAnchor,
      cast,
      props,
      framing: officialShotFraming(storyboard),
      visual_action: shotActionSchedule(storyboard, range),
      camera: officialCameraMotion(storyboard, index),
      synchronized_sound: shotSoundCue(storyboard),
      transition_or_end: handoff,
    };
  });
  const shotContracts = buildShotContracts(storyboards, shotDescriptions, 'en', compactMode || storyboards.length > 1);
  const timeBlocks = buildAuthoritativeTimeBlocks(timeline, timedSpeech);

  // A refreshed/model-edited prompt is supplementary visual direction. The
  // screenplay action, camera, timing, exact dialogue and sound manifest are
  // authored separately below and remain authoritative. Bound the override
  // here (preserving its opening and payoff) so one verbose single-shot edit
  // cannot push an otherwise valid H3 job a few characters over 7000.
  const visualOverride = compactActionArc(
    sanitizeVisualDirection(options.visualOverride, timedSpeech.map(line => line.exactLine)),
    compactMode ? 360 : 720,
  );
  const styleOpening = `${style.h3Direction}${visualOverride ? ` Visual-only override: ${visualOverride} This direction is visual-only.` : ''} Cuts are physical and motivated, never fades or dissolves.`;
  const physics = buildVideoContinuityRules(hasVoiceReferences)
    .replace(/\n+/g, ' ')
    .replace(/PHYSICS:|CONSTRAINTS:/g, '')
    .replace('Timed action, camera, dialogue and sound fields are authoritative.', 'Timed fields are authoritative.')
    .trim();
  const fittedPhysics = compactMode
    ? 'Preserve causality, identity, wardrobe, geography, light, screen direction, body/cloth/prop weight and dialogue eyelines. Timed fields are authoritative; no stage acting or slow motion.'
    : physics;
  // Official H3 format keeps dialogue exclusively inside detailed_description.
  // overall_soundscape contains ambience, Foley and non-verbal human sound only.
  const soundscape = buildAudioManifest(storyboards);
  const nonDiegeticMusic = buildNonDiegeticMusic(storyboards);
  const timelineJson = h3TimelineJson({
    schema: 'aid_h3_timeline_v5',
    duration: `${duration.toFixed(3)}s`,
    silent_direction_data: true,
    audio_event_lock: voiceContract,
    dialogue_events: dialogueEvents,
    reference_audio_contract: h3ReferenceAudioContract(),
    visual_style: compactMode ? compactText(styleOpening, 70) : styleOpening,
    frame_text_policy: h3FrameTextContract(),
    shot_contracts: shotContracts,
    timeline: timeBlocks,
    continuity: fittedPhysics,
    final_priority: h3FinalPriorityContract(),
  }, compactMode || storyboards.length > 1);

  if (isFirstLastMode) {
    const firstLastBindings = [
      ...characters.map((name, index) => `<Subject ${index + 1}> is ${name} in <Picture 1> and <Picture 2>; preserve one identity across both pictures.`),
      ...referenceAudioNames.map((name, index) => {
        const subject = subjectId.get(name);
        return `<Audio ${index + 1}> supplies only the timbre for ${subject ? `<Subject ${subject}>` : name}; ignore its source words and timing.`;
      }),
    ].join(' ');
    return fitH3PromptBudget(`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${duration.toFixed(2)}-second mark of the target video.

integrated_multimodal_description: ${firstLastBindings}
timeline_json:
${timelineJson}

overall_soundscape: ${soundscape}

non_diegetic_music: ${nonDiegeticMusic}`);
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
      return `<Audio ${index + 1}> provides only the voice timbre for ${subject ? `<Subject ${subject}>` : name}; ignore its original words and timing, and never imitate the sample utterance.`;
    });
  const retention = [
    ...subjectDefinitions.map((_, index) => compactMode
      ? `<Subject ${index + 1}>: preserve identity/wardrobe.`
      : `<Subject ${index + 1}>: fully_preserved identity/wardrobe across ${storyboards.flatMap((storyboard, shotIndex) => storyboard.characters?.includes(characters[index]) ? [`[Shot ${shotIndex + 1}]`] : []).join(',')}.`),
    ...pictureDefinitions.map((_, index) => `<Picture ${index + 1}>: reference; lock identity/world, not pose/viewpoint.`),
    ...audioDefinitions.map((_, index) => `<Audio ${index + 1}>: timbre only; ignore source words/timing.`),
  ];
  const summaryPictures = storyboards.map((_, index) => `<Picture ${index + referenceOffset}>`).join(', ');

  const narrativeArc = storyboards
    .map(storyboard => String(storyboard.montageRole || storyboard.clipType || 'development'))
    .join(' -> ');

  return fitH3PromptBudget(`subject_definitions:
${[...subjectDefinitions, ...pictureDefinitions, ...audioDefinitions].join('\n')}

summary:
[${options.firstFrameUrl ? 'keyframe + ' : ''}references${audioDefinitions.length ? ' + audio' : ''}] ${summaryPictures}; ${storyboards.length} causal shots / ${duration}s / one production world; ${speechEventCount ? `${speechEventCount} scheduled dialogue event${speechEventCount === 1 ? '' : 's'} and no other voice` : 'no human voice'}. Arc:${narrativeArc || 'development->consequence'}.

retention_analysis:
${retention.join('\n')}

detailed_description:
timeline_json:
${timelineJson}

overall_soundscape:
${soundscape}

non_diegetic_music:
${nonDiegeticMusic}`);
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
