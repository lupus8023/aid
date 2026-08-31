import type { Storyboard, StoryVideoDirection } from '@/types';

// Per-field writing/repair targets. The provider receives prose, not these
// fields: only the combined brief budget is a hard limit at compilation.
export const VIDEO_DIRECTION_LIMITS = { action: 300, camera: 180, detail: 140, ending: 140 } as const;
export const VIDEO_DIRECTION_MAX_CHARACTERS = 720;

export const VIDEO_DIRECTION_WRITING_CONTRACT = `
视频镜头细化（videoDirection，与静态图片 prompt 分开）：
把锁定的 action、performance、stateBefore/stateAfter 与 editBridge 转写成英文、可直接拍摄的短导演说明。不是重新编剧，不新增事件、人物、道具、对白或音效。
- action：可见起始状态→已有触发→一个主动作→物理结果。细到能拍：必要时写明哪只手/身体部位、接触什么位置、朝哪个方向施力、速度如何变化，物体如何随之移动。只落实已有行动，不添加无关小动作；不能把完整动作退回静态图片描述。
- camera：只写一个摄影任务：起始观察位置→运动类型、方向、幅度、速度/触发→结束时看见什么。幅度用有依据的距离、角度或构图变化（双人中景到单人近景），速度用匀速、与人物同速、触发后加速/减速；不要只写 small move、slow push 或 cinematic。
- 为已有信息变化选择手法：横移通过前景视差揭示被遮挡的关系；推进/后撤改变主体与环境的占比；跟拍保持人物距离而让空间流过；移焦明确 A→B 和触发。不是每镜都动：locked-off camera 可让画内行动改变关系，固定机位移焦不等于移动相机。一镜到底只表示不切镜，不表示不运镜。不要把这些手法列成菜单或全部塞进一镜。
- I2V 从已有首帧的机位、人物位置与焦点开始，只写变化和必要的不变量，不重新摆开场。运动路径必须适合已知空间和镜长，不穿墙、不越轴；物理移动产生视差，变焦不冒充推轨。一个协调弧线可包含横移与转向，但不再叠加独立运镜。首尾帧模式必须连接两个硬锚点，不另造落点或中间切镜。文字输入无法确认的画外布局不要编造。
- 遵循拍摄方式：电影机位可预先占位、同步调度或延后揭示；手机/观察机位只在动作发生后修正，固定监控不动。对白按既定顺序，lipSync 为 true 的说话者在其发声时保持可辨认的口部；无需所有人和道具全程居中、同样清晰。
- detail：细写最能证明本镜动作的画面变化及其原因（如手掌压住桌沿时指节褪色、布料在受力处压缩后回弹、前景物体随横移掠过并露出后景）。不能用“丰富细节”替代描述。纯产品/环境镜不要添加眼神、表情或呼吸。不适用时写空字符串。
- ending：只写 camera/action 尚未说明的可见结果或下一镜接住的视线/运动；可在运动中交棒，不必每镜停稳、回正或恢复初始状态。不写观众理解或剧情评价。
- 使用自然先后/因果措辞（as/when/after/then），不写绝对秒数，不把每镜机械切成固定比例；节奏服从动作和现有镜长。
- 不靠 realistic/natural/cinematic/premium 等形容词充当动作或细节，不堆相机缺陷、风格标签、否定清单，不重复参考图已经确定的服装、布景与身份。
- 四个字段一律英文，已登记角色/物体名称允许原样保留。中文剧本必须翻译完整动作与结果，不能丢弃。不得引用、翻译或概括逐字台词；对白只由 speech 控制。不写声音指令、口型台词暗示、<d> 标签或 H3 章节标记。
- 细致是可见信息精确，不是形容词多；不要为了短而删掉决定画面的方位、接触、速度和落点。预算优先给这些信息，删重复标签。建议 action约260、camera约160、detail约120、ending约100字符；四项合计≤720是硬上限（含空格标点），字段可以共享余量，不因单项略超建议值删除有效细节。同一信息只写一次，简单镜头不凑字数。
- 先在预算内写完整句子。超限时删重复修饰、缩短次要细节，保留主体、触发、主动作、结果及摄影任务；不能截断单词、裁句拼接或删除否定词来满足限额。
例：不要写“她自然地表现震惊，镜头电影感推进”。可写 action="Lin draws the photograph from the envelope; her grip loosens when she sees it." camera="From the table-height medium shot, dolly forward at an even pace as Lin lowers her hand, ending close on the photograph between her fingers." detail="Her smile fades before her fingers release." ending="The photograph lands face-up; her hand remains suspended." 另一种既有构图适用的写法：camera="Locked-off close shot: as Lin's thumb stops on the torn seam, rack focus once from the paper edge to her eyes behind it."（仅学习写法，不复制故事、机位或动作。）
`;

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

export function validateVideoDirectionField(field: keyof StoryVideoDirection, value: unknown, entityNames: string[] = [], exactLines: string[] = [], checkCameraSpecificity = false, enforceFieldLimit = true): string {
  if (typeof value !== 'string') throw new Error(`videoDirection.${field} 必须为字符串`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text && field !== 'detail') throw new Error(`videoDirection.${field} 不能为空`);
  if (enforceFieldLimit && text.length > VIDEO_DIRECTION_LIMITS[field]) throw new Error(`videoDirection.${field} 为 ${text.length} 字符，修稿预算 ${VIDEO_DIRECTION_LIMITS[field]}；请重写完整短句，不要截断`);
  const prose = withoutVideoEntityNames(text, entityNames);
  if (/[\p{Script=Han}\p{Script=Cyrillic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(prose)) throw new Error(`videoDirection.${field} 必须用英文完整转写，名称除外`);
  if (/<\/?d>|\[(?:Shot|Chinese|English)\b|(?:subject_definitions|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:|\b(?:says?|whispers?|speaks?|shouts?|voiceover|narration|dialogue)\b/i.test(prose)) throw new Error(`videoDirection.${field} 混入台词或声音指令；只写可见动作`);
  const normalized = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  for (const line of exactLines) {
    const needle = normalized(line);
    // A short line such as "Yes" must not match the visible word "eyes".
    const copied = /^[a-z]+$/.test(needle) && needle.length <= 4
      ? new RegExp(`\\b${needle}\\b`, 'i').test(text)
      : needle && normalized(text).includes(needle);
    if (copied) throw new Error(`videoDirection.${field} 重复了权威台词`);
  }
  if (field === 'action' && (/^(?:(?:the\s+)?(?:main\s+)?subject|\w+)\s+(?:completes? one clear physical action|makes? one natural gesture)/i.test(text)
    || /^(?:realistic|natural|cinematic|premium|beautiful)(?:[\s,.!-]+(?:realistic|natural|cinematic|premium|beautiful))*[.!]?$/i.test(text))) {
    throw new Error('videoDirection.action 不能只是通用动作或风格形容词；写明具体动作与可见变化');
  }
  if (checkCameraSpecificity && field === 'camera'
    && /\b(?:small|slight|short|minor)\s+(?:lateral\s+)?(?:settle|reframe|reframing|adjustment|shift|movement|move)\b/i.test(prose)
    && !/\b(?:left|right|forward|backward|backwards|back|toward|towards|away|clockwise|counterclockwise|metres?|meters?|degrees?|rack focus)\b/i.test(prose)) {
    throw new Error('videoDirection.camera 只有模糊微调；保留摄影意图，写明方向、幅度或起止构图及触发，不能仅说 slight lateral settle');
  }
  if (checkCameraSpecificity && field === 'camera' && /\blocked(?:-off|\s+off|\s+at)\b/i.test(prose)
    && /\b(?:dolly|truck|pan|tilt|nudge|reframe|track|orbit|arc)\b/i.test(prose)
    && !/\b(?:then|until|before|after)\b/i.test(prose)) {
    throw new Error('videoDirection.camera 同时要求固定与移动；明确选择固定机位（可移焦）或一条连续运动，不能同时 locked-off 又 nudge/reframe');
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
    shot.visualStyle || 'cinematic-natural', shot.capturePreset || 'cinematic-narrative',
  ]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `vd1-${(hash >>> 0).toString(36)}`;
}

export function currentVideoDirection(shot: Storyboard): StoryVideoDirection | undefined {
  if (!shot.videoDirection || (shot.videoDirectionSource && shot.videoDirectionSource !== videoDirectionSourceKey(shot))) return undefined;
  return validateVideoDirection(shot.videoDirection, videoDirectionEntityNames(shot), [
    ...(shot.speech || []).map(line => line.exactLine),
    ...(shot.dialogueLines || []).map(line => line.text),
    ...Object.values(shot.dialogue || {}),
  ]);
}
