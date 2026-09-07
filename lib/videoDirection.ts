import type { Storyboard, StoryVideoDirection } from '@/types';

// Per-field writing/repair targets. The provider receives prose, not these
// fields: only the combined brief budget is a hard limit at compilation.
export const VIDEO_DIRECTION_LIMITS = { action: 300, camera: 180, detail: 140, ending: 140 } as const;
export const VIDEO_DIRECTION_MAX_CHARACTERS = 720;

const VIDEO_DIRECTION_WRITING_CONTRACT_BASE = `
视频镜头细化（videoDirection，与静态图片 prompt 分开）：
每个分镜是一段单镜单图视频，只使用本镜的分镜首帧，不在段内切到其他分镜。导演需把表演和摄影写成同一条可执行的时序。
- 走位与调度：从首帧已有的左右、前后、朝向和手持状态起步，说明谁先触发、谁随后反应，人物沿什么可见路径到哪里、何时停下或转身；多人镜明确各自位置与遮挡关系，不凭空新增演员。静态图必须选择这条行动的起点，不能把结果画成开场再要求重演动作。
- 摄影与表演同步：明确相机相对人物的起点、运动触发、跟随方向与距离变化，以及终点的景别/焦点。走位和相机运动共同服务一个叙事目的；固定机位用画内调度交付变化，不能每镜都泛写缓慢推进。
- 本镜末态与下镜初态分别设计：当前镜只完成自己的动作落点；下一张分镜应接住相容的手势、目光、运动方向与道具状态。机位变化由片段间剪辑完成，不把两张分镜渐变融合，也不在当前镜提前走完下一镜动作。
把锁定的 action、performance、stateBefore/stateAfter 与 editBridge 整理成可直接拍摄的短导演说明。不是重新编剧，不新增事件、人物、道具、对白或音效。
- action：可见起始状态→已有触发→一个主动作→物理结果。细到能拍：必要时写明哪只手/身体部位、接触什么位置、朝哪个方向施力、速度如何变化，物体如何随之移动。只落实已有行动，不添加无关小动作；不能把完整动作退回静态图片描述。
- 手与道具的接触：以首帧已见的接触关系为起点，只写本镜需要改变的接触点、支撑关系和最终归属。靠近但不触碰的动作要有清楚的间距与停止位置；拿起、放下、交接必须有连续的支撑转换。不能为了表现手势让空手凭空多出小物件，也不添加没有剧情依据的反复抓放、开合或绕行。快速下落、撞击等短促事件保持自然速度，不能为了填满镜长改成悬浮或慢动作；若剩余时间有已批准的反应则拍反应。
- camera：只写一个摄影任务：起始观察位置→运动类型、方向、幅度、速度/触发→结束时看见什么。幅度用有依据的距离、角度或构图变化（双人中景到单人近景），速度用匀速、与人物同速、触发后加速/减速；不要只写 small move、slow push 或 cinematic。
- 运镜边界：写清运动中需要留在画内的主体范围、关键动作或物体，以及可观察的结束条件（如遮挡解除、到达已指定构图）。仅用横移揭示关系时，交代保持原高度和焦距，避免把“逐步露出”扩展成额外推近或俯仰；剧情确需改变高度、焦距或让主体出画时，明确该变化及其落点。边界服务本镜叙事，不要求每镜所有人物全身入画。
- 为已有信息变化选择手法：横移通过前景视差揭示被遮挡的关系；推进/后撤改变主体与环境的占比；跟拍保持人物距离而让空间流过；移焦明确 A→B 和触发。不是每镜都动：locked-off camera 可让画内行动改变关系，固定机位移焦不等于移动相机。一镜到底只表示不切镜，不表示不运镜。不要把这些手法列成菜单或全部塞进一镜。
- I2V 从已有首帧的机位、人物位置与焦点开始，只写变化和必要的不变量，不重新摆开场。运动路径必须适合已知空间和镜长，不穿墙、不越轴；物理移动产生视差，变焦不冒充推轨。一个协调弧线可包含横移与转向，但不再叠加独立运镜。首尾帧模式必须连接两个硬锚点，不另造落点或中间切镜。文字输入无法确认的画外布局不要编造。
- 遵循拍摄方式：电影机位可预先占位、同步调度或延后揭示；手机/观察机位只在动作发生后修正，固定监控不动。对白按既定顺序，lipSync 为 true 的说话者在其发声时保持可辨认的口部；无需所有人和道具全程居中、同样清晰。
- detail：细写最能证明本镜动作的画面变化及其原因（如手掌压住桌沿时指节褪色、布料在受力处压缩后回弹、前景物体随横移掠过并露出后景）。不能用“丰富细节”替代描述。纯产品/环境镜不要添加眼神、表情或呼吸。不适用时写空字符串。
- ending：非全片终镜必须写一个剧情内可见转场落点，由下一镜接住已有动作方向、视线、焦点或物体状态；不能只写“自然转场”，不能提前演出下一镜事件。只有全片终镜保留结局余韵而不向下一镜转场。只写 camera/action 尚未说明的可见结果或下一镜接住的视线/运动；可在运动中交棒，不必每镜停稳、回正或恢复初始状态。不写观众理解或剧情评价。
- 使用自然先后/因果措辞（as/when/after/then），不写绝对秒数，不把每镜机械切成固定比例；节奏服从动作和现有镜长。
- 不靠 realistic/natural/cinematic/premium 等形容词充当动作或细节，不堆相机缺陷、风格标签、否定清单，不重复参考图已经确定的服装、布景与身份。
{{LANGUAGE_RULE}}
- 细致是可见信息精确，不是形容词多；不要为了短而删掉决定画面的方位、接触、速度和落点。预算优先给这些信息，删重复标签。建议 action约260、camera约160、detail约120、ending约100字符；四项合计≤720是硬上限（含空格标点），字段可以共享余量，不因单项略超建议值删除有效细节。同一信息只写一次，简单镜头不凑字数。
- 先在预算内写完整句子。超限时删重复修饰、缩短次要细节，保留主体、触发、主动作、结果及摄影任务；不能截断单词、裁句拼接或删除否定词来满足限额。
{{LANGUAGE_EXAMPLE}}
`;

export function videoDirectionWritingContract(_language: 'zh' | 'en' = 'zh'): string {
  // H3 visual prose is always authored in Chinese. The project language affects
  // exact dialogue only. This mirrors the production A/B result where the same
  // Chinese visual brief avoided the burned captions produced by its English
  // translation, while also following blocking and expressions more precisely.
  const languageRule = '- 四个字段一律使用简洁、自然的中文；已登记角色/物体正名原样保留。项目语言只约束 speech 中的逐字台词。不得引用、翻译或概括逐字台词；对白只由 speech 控制。不写声音指令、暗示人物说出具体内容、<d> 标签或 H3 章节标记。';
  const example = '例：不要写“她自然地表现震惊，镜头电影感推进”。可写 action="林从信封中抽出照片；看清照片时，她的右手逐渐松开。" camera="从桌面高度的中景开始，随着林放低右手匀速推近，最后停在她指间的照片近景。" detail="她的笑意先消失，随后手指才松开。" ending="照片正面朝上落在桌面，右手仍悬在上方。" 另一种既有构图适用的写法：camera="固定机位近景；林的拇指停在破损封口时，只做一次移焦，从纸张边缘移到后方的双眼。"（仅学习写法，不复制故事、机位或动作。）';
  return VIDEO_DIRECTION_WRITING_CONTRACT_BASE
    .replace('{{LANGUAGE_RULE}}', languageRule)
    .replace('{{LANGUAGE_EXAMPLE}}', example);
}

// Backward-compatible default for callers that do not carry project language.
export const VIDEO_DIRECTION_WRITING_CONTRACT = videoDirectionWritingContract('zh');

/** New H3 prompts require Chinese visual prose; registered Latin names may stay. */
export function isChineseVideoDirectionField(value: string, entityNames: string[] = []): boolean {
  const prose = [...entityNames].filter(Boolean).sort((a, b) => b.length - a.length)
    .reduce((text, name) => text.replaceAll(name, ' '), String(value || ''))
    .replace(/<\/?(?:Picture|Subject|Object|Audio|d)(?:\s+\d+)?>/gi, ' ');
  const han = prose.match(/\p{Script=Han}/gu)?.length || 0;
  const latin = prose.match(/[A-Za-z]/g)?.length || 0;
  return han > 0 && latin <= Math.max(2, Math.floor(han * 0.25));
}

export function isChineseVideoDirection(value: StoryVideoDirection, entityNames: string[] = []): boolean {
  return (Object.keys(VIDEO_DIRECTION_LIMITS) as Array<keyof StoryVideoDirection>).every(field => {
    const text = String(value[field] || '').trim();
    if (!text) return field === 'detail';
    return isChineseVideoDirectionField(text, entityNames);
  });
}

export function videoDirectionEntityNames(shot: Partial<Storyboard>): string[] {
  return [...new Set([
    ...(shot.characters || []), ...(shot.objects || []),
    ...(shot.performance || []).map(cue => cue.character),
  ].filter(Boolean))].sort((a, b) => b.length - a.length);
}

export function withoutVideoEntityNames(value: string, names: string[]): string {
  return [...names].filter(Boolean).sort((a, b) => b.length - a.length)
    .reduce((text, name) => text.replaceAll(name, 'Subject'), value);
}

/**
 * Providers occasionally shorten a CJK character name (for example 沈贵妃 ->
 * 贵妃). Accept only an unambiguous suffix of a registered name and restore the
 * canonical spelling before validating visual prose.
 */
export function canonicalizeVideoDirectionEntityAliases(value: string, names: string[]): string {
  const canonical = [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))];
  return value.replace(/\p{Script=Han}{2,}/gu, token => {
    if (canonical.includes(token)) return token;
    const matches = canonical.filter(name => name.endsWith(token));
    return matches.length === 1 ? matches[0] : token;
  });
}

const normalizedDialogue = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

export function isEntityNameDialogue(line: string, entityNames: string[]): boolean {
  const needle = normalizedDialogue(line);
  return Boolean(needle) && entityNames.some(name => normalizedDialogue(name) === needle);
}

/** A spoken vocative such as “裴大人。” does not make every visual actor reference dialogue. */
export function containsExactDialogue(text: string, line: string, entityNames: string[] = []): boolean {
  const needle = normalizedDialogue(line);
  if (!needle) return false;
  if (isEntityNameDialogue(line, entityNames)) {
    return [...text.matchAll(/[“「『"']([^”」』"']+)[”」』"']/gu)]
      .some(match => normalizedDialogue(match[1]) === needle)
      || new RegExp(`(?:\\b(?:says?|asks?|replies?|whispers?|shouts?)|说道|说出|喊道)\\s*[:：,]?\\s*${line.trim().replace(/[\s\p{P}\p{S}]/gu, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(text);
  }
  // A short line such as "Yes" must not match the visible word "eyes".
  return /^[a-z]+$/.test(needle) && needle.length <= 4
    ? new RegExp(`\\b${needle}\\b`, 'i').test(text)
    : normalizedDialogue(text).includes(needle);
}

export function validateVideoDirectionField(field: keyof StoryVideoDirection, value: unknown, entityNames: string[] = [], exactLines: string[] = [], checkCameraSpecificity = false, enforceFieldLimit = true): string {
  if (typeof value !== 'string') throw new Error(`videoDirection.${field} 必须为字符串`);
  const text = canonicalizeVideoDirectionEntityAliases(value.replace(/\s+/g, ' ').trim(), entityNames);
  if (!text && field !== 'detail') throw new Error(`videoDirection.${field} 不能为空`);
  if (enforceFieldLimit && text.length > VIDEO_DIRECTION_LIMITS[field]) throw new Error(`videoDirection.${field} 为 ${text.length} 字符，修稿预算 ${VIDEO_DIRECTION_LIMITS[field]}；请重写完整短句，不要截断`);
  const prose = withoutVideoEntityNames(text, entityNames);
  // Base validation remains bilingual so a saved English project can be read
  // and migrated. The production gate (`currentChineseVideoDirection`) is the
  // single place that requires Chinese before H3 submission.
  if (/[\p{Script=Cyrillic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(prose)) throw new Error(`videoDirection.${field} 包含不支持的文字；导演说明请使用中文`);
  // `开口` is also a physical noun in camera directions (车尾开口、袋子开口、
  // 破损开口). Only reject it when an actual speech verb follows. Treating the
  // bare noun as dialogue made a valid retained draft impossible to repair.
  if (/<\/?d>|\[(?:Shot|Chinese|English)\b|(?:subject_definitions|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:|\b(?:says?|whispers?|speaks?|shouts?|voiceover|narration|dialogue)\b|(?:说道|说出|开口(?:说|道|问|答|回答|讲话|发言)|低语|耳语|喊道|大喊|旁白|画外音|对白|台词|念出|读出)/i.test(prose)) throw new Error(`videoDirection.${field} 混入台词或声音指令；只写可见动作`);
  for (const line of exactLines) {
    if (containsExactDialogue(text, line, entityNames)) throw new Error(`videoDirection.${field} 重复了权威台词`);
  }
  if (field === 'action' && (/^(?:(?:the\s+)?(?:main\s+)?subject|\w+)\s+(?:completes? one clear physical action|makes? one natural gesture)/i.test(text)
    || /^(?:角色|人物|主体)(?:完成|做出)(?:一个|一次)?(?:清晰|自然|明确)?(?:的)?(?:动作|手势)[。.!！]?$/u.test(text)
    || /^(?:(?:realistic|natural|cinematic|premium|beautiful)(?:[\s,.!-]+)?)+[.!]?$/i.test(text)
    || /^(?:(?:真实|自然|电影感|高级|唯美)[，、。.!！\s]*)+$/u.test(text))) {
    throw new Error('videoDirection.action 不能只是通用动作或风格形容词；写明具体动作与可见变化');
  }
  if (checkCameraSpecificity && field === 'camera'
    && (/\b(?:small|slight|short|minor)\s+(?:lateral\s+)?(?:settle|reframe|reframing|adjustment|shift|movement|move)\b/i.test(prose)
      || /(?:轻微|稍微|小幅)(?:调整|移动|重构|重新构图|横移)/u.test(prose))
    && !(/\b(?:left|right|forward|backward|backwards|back|toward|towards|away|clockwise|counterclockwise|metres?|meters?|degrees?|rack focus)\b/i.test(prose)
      || /(?:向左|向右|向前|向后|靠近|远离|顺时针|逆时针|米|度|移焦|拉焦|从.+到)/u.test(prose))) {
    throw new Error('videoDirection.camera 只有模糊微调；保留摄影意图，写明方向、幅度或起止构图及触发，不能仅说 slight lateral settle');
  }
  if (checkCameraSpecificity && field === 'camera' && /\blocked(?:-off|\s+off|\s+at)\b/i.test(prose)
    && /\b(?:dolly|truck|pan|tilt|nudge|reframe|track|orbit|arc)\b/i.test(prose)
    && !/\b(?:then|until|before|after)\b/i.test(prose)) {
    throw new Error('videoDirection.camera 同时要求固定与移动；明确选择固定机位（可移焦）或一条连续运动，不能同时 locked-off 又 nudge/reframe');
  }
  if (checkCameraSpecificity && field === 'camera' && /(?:固定机位|镜头固定|固定镜头)/u.test(prose)
    && /(?:推近|拉远|横移|跟拍|摇摄|摇镜|环绕|升降|重新构图)/u.test(prose)
    && !/(?:然后|随后|直到|之前|之后)/u.test(prose)) {
    throw new Error('videoDirection.camera 同时要求固定与移动；明确选择固定机位（可移焦）或一条连续运动');
  }
  return text;
}

export function validateVideoDirection(value: unknown, entityNames: string[] = [], exactLines: string[] = [], checkCameraSpecificity = false): StoryVideoDirection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('缺少 videoDirection 镜头细化');
  const raw = value as Record<string, unknown>;
  const budgetProblems: string[] = [];
  for (const field of Object.keys(VIDEO_DIRECTION_LIMITS)) {
    const value = raw[field];
    if (typeof value !== 'string') budgetProblems.push(`videoDirection.${field} 必须为字符串`);
    else {
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text && field !== 'detail') budgetProblems.push(`videoDirection.${field} 不能为空`);
    }
  }
  if (budgetProblems.length) throw new Error(budgetProblems.join('；'));
  const result = {} as StoryVideoDirection;
  for (const field of Object.keys(VIDEO_DIRECTION_LIMITS) as Array<keyof StoryVideoDirection>) {
    result[field] = validateVideoDirectionField(field, raw[field], entityNames, exactLines, checkCameraSpecificity, false);
  }
  const length = Object.values(result).reduce((sum, text) => sum + text.length, 0);
  if (length > VIDEO_DIRECTION_MAX_CHARACTERS) throw new Error(`videoDirection 共 ${length} 字符，上限 ${VIDEO_DIRECTION_MAX_CHARACTERS}；保留动作与结果，删重复修饰`);
  return result;
}

// Visual inputs only. Dialogue is validated separately and can be redistributed
// across shots by segment planning without invalidating the visual brief.
export function videoDirectionSourceKey(shot: Partial<Storyboard>): string {
  const text = JSON.stringify([
    shot.action, shot.description, shot.prompt, shot.performance, shot.stateBefore, shot.stateAfter,
    shot.characters, shot.objects, shot.cameraMove, shot.shotSize, shot.angle, shot.editBridge, shot.clipType,
    shot.visualStyle || 'cinematic-natural', shot.capturePreset || 'cinematic-narrative', shot.durationHint,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `vd2-${(hash >>> 0).toString(36)}`;
}

export function currentVideoDirection(shot: Storyboard): StoryVideoDirection | undefined {
  if (!shot.videoDirection || (shot.videoDirectionSource && shot.videoDirectionSource !== videoDirectionSourceKey(shot))) return undefined;
  return validateVideoDirection(shot.videoDirection, videoDirectionEntityNames(shot), [
    ...(shot.speech || []).map(line => line.exactLine),
    ...(shot.dialogueLines || []).map(line => line.text),
    ...Object.values(shot.dialogue || {}),
  ]);
}

/** Current production contract: visual direction is Chinese regardless of dialogue language. */
export function currentChineseVideoDirection(shot: Storyboard): StoryVideoDirection | undefined {
  const direction = currentVideoDirection(shot);
  return direction && isChineseVideoDirection(direction, videoDirectionEntityNames(shot)) ? direction : undefined;
}

/** Recover old binding-only changes, never bless a changed action/prompt as current. */
export function recoverReorderedObjectDirection(shot: Storyboard): Storyboard {
  if (!shot.videoDirection || !shot.videoDirectionSource || shot.videoDirectionSource === videoDirectionSourceKey(shot)) return shot;
  const objects = shot.objects || [];
  // Legacy reference binding reordered this small list into library order.
  // A matching old fingerprint proves ALL other visual inputs are unchanged.
  if (!objects.length || objects.length > 6 || new Set(objects).size !== objects.length) return shot;
  const matches = (prefix: string[], remaining: string[]): boolean => {
    // Old bindStoryboardReferences also added explicit [prop] tags already
    // authored in the unchanged image prompt. No arbitrary new prop is ignored.
    if (remaining.every(name => shot.prompt?.includes(`[${name}]`))
      && videoDirectionSourceKey({ ...shot, objects: prefix }) === shot.videoDirectionSource) return true;
    return remaining.some((name, index) => matches([...prefix, name], remaining.filter((_, i) => i !== index)));
  };
  if (!matches([], objects)) return shot;
  try { validateVideoDirection(shot.videoDirection, videoDirectionEntityNames(shot), (shot.speech || []).map(line => line.exactLine)); }
  catch { return shot; }
  // Updating the source also invalidates clips compiled through the stale-brief
  // fallback, while retaining their paid media in the existing cache.
  return { ...shot, videoDirectionSource: videoDirectionSourceKey(shot) };
}
