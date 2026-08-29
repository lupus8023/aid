import type { CapturePreset, Storyboard } from '@/types';
import type { StoryPlan, Beat, WriterCharacter, WriterObject } from './types';
import { chatOnce, type ScriptProvider } from './llm';
import { extractJson } from './json';
import type { VisualStyle } from '@/types';
import { buildImageCaptureContract, getProductionStylePreset } from '@/lib/promptArchitecture';
import { structuredRetryCorrection } from './storyWriter';
import { buildDirectorCaptureContract } from '@/lib/capturePresets';

// 导演阶段：把编剧产出的 StoryPlan 可视化成分镜（Storyboard[]）。
// 关键点：镜头数量/顺序/台词/时长/转场/连续关系【忠实于 StoryPlan】，只补画面/视频提示词与定妆。
export function buildDirectorPrompt(input: {
  storyPlan: StoryPlan;
  beats: Beat[];
  batchNumber: number;
  totalBatches: number;
  previousShots?: Array<Record<string, unknown>>;
  continuesSequence?: boolean;
  nextBeats?: Beat[];
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
}): string {
  const { storyPlan, beats, batchNumber, totalBatches, previousShots = [], continuesSequence = false, nextBeats = [], characters, objects, language, visualStyle, capturePreset } = input;
  const characterDetails = characters.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const objectDetails = objects.length ? objects.map(o => `- ${o.name}: ${o.description}`).join('\n') : '无';
  const firstIndex = beats[0]?.index || 0;
  const lastIndex = beats[beats.length - 1]?.index || 0;
  const stylePreset = getProductionStylePreset(visualStyle);

  const langInstruction = language === 'en'
    ? 'MANDATORY: output description, prompt and characterCostume in ENGLISH.'
    : '强制：description 使用中文，prompt 使用英文，characterCostume 使用具体可视描述。';

  const storySpine = {
    title: storyPlan.title,
    theme: storyPlan.theme,
    logline: storyPlan.logline,
    protagonist: storyPlan.protagonist,
    externalWant: storyPlan.externalWant,
    internalNeed: storyPlan.internalNeed,
    stakes: storyPlan.stakes,
    obstacle: storyPlan.obstacle,
    finalChoice: storyPlan.finalChoice,
    consequence: storyPlan.consequence,
    change: storyPlan.change,
    storyAnchor: storyPlan.storyAnchor,
    visualMotif: storyPlan.visualMotif,
    emotionalArc: storyPlan.emotionalArc,
    centralDramaticQuestion: storyPlan.centralDramaticQuestion,
    audiencePromise: storyPlan.audiencePromise,
    dialogueArc: storyPlan.dialogueArc,
    montageStrategy: storyPlan.montageStrategy,
  };

  return `你是一位电影导演兼分镜师。全片剧本已经锁定。现在只处理导演批次 ${batchNumber}/${totalBatches}（镜头 ${firstIndex}–${lastIndex}），把本批 beats 可视化为可拍摄分镜。

📌 用户原始输入已由 StoryPlan、需求核对表、详细 beats 与逐字 speech 锁定。为避免每个导演批次重复发送整部长稿造成超时或安全误判，本阶段只执行下方结构化合同；不得改写锁定剧情与台词。

编剧对用户意图的理解：${storyPlan.intentSummary || '未提供'}
需求核对表：${JSON.stringify(storyPlan.requirements || [], null, 2)}

🎯 最高原则：忠实于 StoryPlan，不重新创作
- 本批分镜数量必须等于 ${beats.length}，顺序与 index ${firstIndex}–${lastIndex} 完全一致，不得增删或重排。
- 台词、动作、时长、转场和连续关系来自 beat；你负责设计景别、运镜、机位、场景成像基线与正式图片 prompt。
- performance 是演员执行合同：description 必须逐个落实其中的 objective、blocking、gesture、expression、gaze、breath、reaction 与 subtext，但不得把字段名或心理说明直接写成画面文字。微表情要通过眼球、眉眼、嘴角、下颌、呼吸、重心和距离的可见变化表现。
- 必须让 dramaticPurpose、cause、conflict、choice、consequence 和 stateBefore/stateAfter 在画面中可见；镜头必须改变信息、关系、决定或物理状态，不能只制造氛围。
- informationGain 是本镜必须交付给观众的理解；用人物阻挡、视线、反应、道具状态与结果构图让它可读。audienceQuestion 决定镜尾要保留什么悬念，montageRole 决定它与相邻镜的语义关系。
- editBridge 是编剧锁定的剪辑交棒：本镜镜尾必须留下其中指定的动作、视线、物体、声音或因果结果，让下一镜接住，并让两镜并置后产生指定的观众推论。不得改成淡入淡出、叠化等后期特效。
- speech 是权威对白，不能改写、删减或写进图像 prompt。对白发生时，description 要安排清楚说话者与聆听者的可见表演；无对白时不要虚构开口动作。
- 对白镜头不能按“谁说一句就切谁”机械覆盖。先用关系构图建立双方目标和空间，权力/信息发生变化时才切；说话者的策略、听者的即时反应以及 speech.listenerState 指定的说后变化必须同时可读。反应镜承担台词后果，不是漂亮头像。
- 同一 dialogueUnitId 是一个不可拆散的交流动作：提问/挑战要在构图里明确指向对象，回答/拒绝要接住前句压力，承诺/关键词在 callback/payoff 镜头以动作或关系变化回收。
- description 不得复述、翻译或引用 speech.exactLine，也不得把“停顿后说/以某种语气说”等声音导演指令写成画面动作；只描述可见的口型、视线、表情、阻挡与反应。精确台词和说法只由 speech 字段控制。
- 不得添加 beat 中没有的情节、台词、旁白、画外音、声音或角色行为。
- 如果用户原始输入含有 beat 未重复写出的明确视觉、服装、场景或语气要求，必须落实到 description/prompt，但不得改变剧情与镜头数量。

🌐 ${langInstruction}

🚨 名称精确匹配（强制）：characters 只允许使用下方可用角色名称（含参考角色与用户原文明确命名的文字角色）；objects 只允许使用已上传名称。不得创造新的命名角色。

📋 可用角色：
${characterDetails}
📦 已上传物体：
${objectDetails}

📖 全片故事脊柱：
${JSON.stringify(storySpine, null, 2)}

上一批最后两镜的视觉交接：
${JSON.stringify(previousShots.slice(-2), null, 2)}

交接类型：${continuesSequence
  ? '同一场次续拍。保持人物位置和银幕方向、服装、道具、主光方向、空间关系与曝光基线。'
  : '新场次开始。保持人物身份、服装、关键道具和剧情状态；允许按新场次明确重建地点、时间、光源、构图和银幕方向。'}

本批详细剧本（权威）：
${JSON.stringify(beats, null, 2)}

后续两镜剧情目标（只铺垫，不得提前发生）：
${JSON.stringify(nextBeats.slice(0, 2).map(beat => ({ index: beat.index, action: beat.action, cause: beat.cause, dramaticPurpose: beat.dramaticPurpose })), null, 2)}

🎬 分镜可视化要求：
1. description：必须以「[景别，机位角度]」开头，包含动作主体、环境、情绪氛围、运镜方式、物理细节（布料/水流/光影）。
   - 先写触发，再写角色的选择/反应，最后写可见物理后果；只描述镜头能拍到的身体、表情、道具、位置与物理状态，禁止把 informationGain、audienceQuestion、功效、价值或观众理解直接改写成画面句子。
2. prompt（英文图像提示词）：
   - 可用角色与已上传物体用 [名称](2-3 个外观关键词) 格式；无名临时角色/物体直接描述。
   - 不要写成关键词堆砌。使用紧凑的摄影因果链，顺序固定为：SUBJECT/ACTION → CAMERA POSITION & DISTANCE → LENS PERSPECTIVE → COMPOSITION & OCCLUSION → FOCUS PLANE & DEPTH LAYERS → MOTIVATED LIGHT → EXPOSURE/COLOR/MATERIAL RESPONSE。
   - CAMERA 必须写清相机相对主体的高度、距离和朝向；不能只写 eye-level、close-up。
   - COMPOSITION 必须写清主体在画面中的位置、留白方向，以及前景/中景/背景关系；需要时使用真实遮挡、非对称裁切或贴近地面的机位，不要每镜都中央构图。
   - FOCUS 必须指定唯一焦点平面，并说明近景与远景如何衰减；景深由焦距感、相机距离、主体与背景距离共同决定，禁止无理由地每镜都浅景深或整幅虚化。
   - LIGHT 必须来自场景中可解释的方向与光源，写清软硬、大小、反射/负补光、阴影密度与距离衰减；同一 sequence 延续光源方向，但每个机位呈现不同的入射角和材质反应。
   - IMAGE RESPONSE 必须描述有限动态范围、高光滚降、暗部层次、白平衡与皮肤/布料/金属/水面等材质的漫反射和高光。仅在成像系统支持时加入轻微颗粒、暗角、边缘柔化、色散、光晕或手机锐化，禁止随机堆叠镜头缺陷。
   - 每条 prompt 控制在 65–95 个英文词；最重要、最独特的摄影信息放在前 45 个词，保证九宫格压缩后仍保留镜头差异。
   - 禁止艺术风格词（anime/cartoon/Ghibli/realistic 等），视觉风格由参考图决定。
   - 精确执行 beat.characters：每个列出的角色在画面中只出现一次，未列出的角色不出现；角色设定图中的多角度/多姿势只用于识别同一身份，不得复制为多人。
   - 禁止字幕、标题、对白文字、气泡、Logo、水印或任何可读文字。
3. characterCostume：为每个在本镜头出现的角色给一套服装/发型/配饰/颜色描述，跨镜头保持一致。
4. shotSize / cameraMove / angle：为剧本动作选择一个明确且可执行的景别、单一物理运镜和机位；相邻镜头避免机械重复。
   - 相机替观众感受剧情，不做装饰性漂移：动作镜跟住速度与触点；反应镜可做一次短推近；孤立/失落可克制拉远；关系纠偏可从轻微失衡机位回到水平。每镜只能有一个主要运镜，特殊情绪机位不能连续滥用。
   - 动作按“进入→加速/施力→撞点/决定→短回落”组织；速度感来自加速度，不来自整段匀速快或匀速慢。除非 beat 明确要求主观时间，否则禁止慢动作、bullet time、长时间悬停和无目的 slow push。
   - 微表演必须错峰启动：通常眼球先于头部，视线/呼吸先于眉眼，眉眼先于嘴唇/下颌，身体重心先于手臂；相邻通道保留约 0.1–0.3 秒自然时差，不要所有五官和肢体同时动作。每镜只设一个清晰动作峰值，其余时间允许稳定观察，禁止人物从头到尾不停活动。
   - 有接触或施力时写出真实物理链：接近→接触→软组织/衣物/道具先受压或蓄力→压力增加→短保持→逐渐释放→惯性/弹性回弹。只让受力区域明显变形，松开后保留约 0.2–0.4 秒残余状态，不能一帧复原。
   - 关键信息或反应落定后保留 0.25–0.6 秒可读呼吸；普通内容不额外停顿。镜尾仍要留下动作、视线、道具、前景遮挡、焦点或可见后果作为下一镜的交棒。
   - 每个接缝只选择一种剪辑语法：动作匹配、视线匹配、道具/形状匹配、前景遮挡藏切、焦点接力、因果切、对照切或平行切。保持运动矢量、速度和银幕方向连续；禁止用淡入淡出、叠化或任意擦除掩盖不连续。
   - 蒙太奇必须有句法：因果切让前镜结果触发后镜动作；平行切比较同时发生的压力；对照切让前后价值发生碰撞；省略切跳过重复过程但保留动作起点、关键变化与结果。每一切既回答上一个观众问题，又打开更具体的下一个问题。
5. sceneStyle：用紧凑英文记录本 sequence 的相机/镜头家族、主光方向与软硬/色温、环境反射或负补光、有限曝光、高光滚降、阴影密度、色彩响应和主要材质。连续 sequence 内保持相同基线。

🎥 项目成像基线（只用于落实摄影物理，不要原样复制成长段落）：
Selected production style: ${stylePreset.label} — ${stylePreset.description}
${buildImageCaptureContract(visualStyle)}
${buildDirectorCaptureContract(capturePreset)}

连续镜头应共享同一相机/镜头家族、色彩响应、主光方向和场景材质；每镜只改变有叙事理由的机位、距离、焦点、遮挡和曝光反应。真实感来自一致的物理因果，而不是反复添加 cinematic、8K、masterpiece、photorealistic 等泛化词。

不要输出视频生成提示词。下游会把 1–4 个分镜重新编组成一个不超过 15 秒的 H3 片段，并按统一制作风格生成时间轴式导演说明。

📝 输出（只输出 JSON 数组，按 beat 顺序，第 i 个元素对应第 i 个 beat）：
[
  {
    "index": ${firstIndex},
    "description": "镜头描述",
    "prompt": "English image prompt",
    "shotSize": "景别",
    "cameraMove": "单一物理运镜",
    "angle": "机位",
    "sceneStyle": "English scene capture baseline",
    "characterCostume": { "角色名": "服装造型描述" }
  }
]`;
}

// 合并 LLM 输出的画面化字段与 beat 的结构字段，产出最终 Storyboard[]。
function mergeBeats(
  storyPlan: StoryPlan,
  rawShots: any[],
  aspectRatio: Storyboard['aspectRatio'],
  capturePreset?: CapturePreset,
): Storyboard[] {
  const beats = storyPlan.sequences.flatMap(seq => seq.beats.map(beat => ({ ...beat, sceneStyle: beat.sceneStyle || seq.sceneStyle })));

  return beats.map((beat: Beat, i: number) => {
    const raw = Array.isArray(rawShots) ? rawShots[i] : undefined;
    const continuityFrom = beat.continuityFrom && beat.continuityFrom > 0
      ? `scene-${beat.continuityFrom}`
      : undefined;

    return {
      id: `scene-${i + 1}`,
      sceneNumber: i + 1,
      action: beat.action,
      performance: beat.performance,
      sequenceId: beat.sequenceId,
      locationId: beat.locationId,
      description: typeof raw?.description === 'string' ? raw.description : beat.action,
      prompt: typeof raw?.prompt === 'string' ? raw.prompt : beat.promptDraft || beat.action,
      videoPrompt: undefined,
      characters: beat.characters,
      objects: beat.objects,
      dialogueLines: beat.dialogueLines,
      speech: beat.speech,
      audioPlan: beat.audioPlan,
      clipType: beat.clipType,
      shotSize: typeof raw?.shotSize === 'string' ? raw.shotSize : beat.shotSize,
      cameraMove: typeof raw?.cameraMove === 'string' ? raw.cameraMove : beat.cameraMove,
      angle: typeof raw?.angle === 'string' ? raw.angle : beat.angle,
      dramaticPurpose: beat.dramaticPurpose,
      cause: beat.cause,
      conflict: beat.conflict,
      choice: beat.choice,
      consequence: beat.consequence,
      characterChange: beat.characterChange,
      nextCause: beat.nextCause,
      informationGain: beat.informationGain,
      dialoguePurpose: beat.dialoguePurpose,
      dialogueUnitId: beat.dialogueUnitId,
      dialogueObligation: beat.dialogueObligation,
      dialogueContext: beat.dialogueContext,
      dialogueTurns: beat.dialogueTurns,
      montageRole: beat.montageRole,
      editBridge: beat.editBridge,
      audienceQuestion: beat.audienceQuestion,
      stateBefore: beat.stateBefore,
      stateAfter: beat.stateAfter,
      durationHint: beat.durationHint,
      videoDuration: beat.durationHint, // 内容驱动时长：让每个镜头有长有短
      transition: beat.transition,
      continuityFrom,
      continuousFromPrev: Boolean(continuityFrom),
      sceneStyle: typeof raw?.sceneStyle === 'string' ? raw.sceneStyle : beat.sceneStyle,
      characterCostume: raw?.characterCostume && typeof raw.characterCostume === 'object' ? raw.characterCostume : undefined,
      status: 'pending' as const,
      aspectRatio,
      capturePreset,
    };
  });
}

export function buildDirectorBatches(storyPlan: StoryPlan, maxBatchSize = 9): Beat[][] {
  const size = Math.max(1, Math.min(9, Math.floor(maxBatchSize) || 9));
  const batches: Beat[][] = [];
  for (const sequence of storyPlan.sequences) {
    for (let index = 0; index < sequence.beats.length; index += size) {
      batches.push(sequence.beats.slice(index, index + size));
    }
  }
  return batches;
}

function isDirectorShot(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const shot = value as Record<string, unknown>;
  return typeof shot.description === 'string' || typeof shot.prompt === 'string';
}

// Providers do not always preserve the requested top-level wrapper. Normalize
// their common response shapes before validating the authoritative shot count.
export function normalizeDirectorShots(value: any, expectedCount: number): any[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  for (const key of ['shots', 'storyboards', 'items', 'data']) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const key of ['shot', 'storyboard', 'result', 'output', 'data']) {
    if (!value[key] || typeof value[key] !== 'object') continue;
    const nested = normalizeDirectorShots(value[key], expectedCount);
    if (nested.length) return nested;
  }

  return expectedCount === 1 && isDirectorShot(value) ? [value] : [];
}

function directorResponseShape(value: any): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== 'object') return typeof value;
  return `object(${Object.keys(value).slice(0, 8).join(',') || 'no keys'})`;
}

function normalizedDialogueMatch(value: unknown): string {
  return String(value || '')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function withoutEntityNames(value: unknown, names: string[]): string {
  return names.reduce(
    (text, name) => text.replaceAll(String(name || ''), ''),
    String(value || ''),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripExactDialogueFromDescription(value: unknown, beat?: Pick<Beat, 'speech'>): string {
  let description = String(value || '').replace(/\p{Script=Cyrillic}+/gu, '');
  for (const line of beat?.speech || []) {
    const exactLine = String(line.exactLine || '').trim();
    if (!exactLine) continue;
    const speechAttribution = '(?:(?:低声|高声|轻声)?(?:说出|说道|说)|\\b(?:says?|asks?|replies?|whispers?|shouts?))\\s*[,.:：]?\\s*';
    const flexibleExactLine = [...normalizedDialogueMatch(exactLine)]
      .map(character => escapeRegExp(character))
      .join('[\\s\\p{P}\\p{S}]*');
    description = description.replace(
      new RegExp(`(?:${speechAttribution})?[“”"']?${flexibleExactLine}[\\s\\p{P}\\p{S}]*`, 'giu'),
      '',
    );
  }
  return description
    .replace(/[“”"']\s*[“”"']/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function validateDirectorShots(
  shots: any[],
  beats: Beat[],
  sourceShape: string,
  language: 'zh' | 'en' = 'zh',
  entityNames: string[] = [],
): void {
  if (shots.length !== beats.length) {
    throw new Error(`返回 ${shots.length} 镜，要求 ${beats.length} 镜（响应结构：${sourceShape}）`);
  }
  shots.forEach((shot, index) => {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)) {
      throw new Error(`第 ${beats[index]?.index || index + 1} 镜不是有效对象`);
    }
    const missing = ['description', 'prompt'].filter(key => typeof shot[key] !== 'string' || !shot[key].trim());
    if (missing.length) {
      throw new Error(`第 ${beats[index]?.index || index + 1} 镜缺少 ${missing.join('、')}`);
    }
    const description = withoutEntityNames(shot.description, entityNames);
    if (/\p{Script=Cyrillic}/u.test(description)) {
      throw new Error(`第 ${beats[index]?.index || index + 1} 镜 description 混入了异常西里尔字符`);
    }
    if (language === 'en' && /\p{Script=Han}/u.test(description)) {
      throw new Error(`第 ${beats[index]?.index || index + 1} 镜 description 未按英文输出`);
    }
    if (language === 'zh' && /\b[A-Za-z]{4,}\b/.test(description)) {
      throw new Error(`第 ${beats[index]?.index || index + 1} 镜 description 混入了未解释的英文词`);
    }
    const normalizedDescription = normalizedDialogueMatch(shot.description);
    for (const line of beats[index]?.speech || []) {
      const exactLine = normalizedDialogueMatch(line.exactLine);
      if (exactLine && normalizedDescription.includes(exactLine)) {
        throw new Error(`第 ${beats[index]?.index || index + 1} 镜 description 重复了权威台词`);
      }
    }
  });
}

export async function directStoryboard(input: {
  storyPlan: StoryPlan;
  characters: WriterCharacter[];
  objects: WriterObject[];
  apiKey: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  language?: 'zh' | 'en';
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
  scriptProvider?: ScriptProvider;
  scriptModel?: string;
  dmxApiKey?: string;
}): Promise<Storyboard[]> {
  const { storyPlan, characters, objects, apiKey, aspectRatio, language = 'zh', visualStyle, capturePreset, scriptProvider, scriptModel = 'gpt-4o', dmxApiKey } = input;
  const batches = buildDirectorBatches(storyPlan);
  const allBeats = storyPlan.sequences.flatMap(sequence => sequence.beats);
  const rawShots: any[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const beats = batches[batchIndex];
    const lastIndex = beats[beats.length - 1]?.index || 0;
    const prompt = buildDirectorPrompt({
      storyPlan,
      beats,
      batchNumber: batchIndex + 1,
      totalBatches: batches.length,
      previousShots: rawShots.slice(-2).map(shot => ({
        index: shot.index,
        description: shot.description,
        shotSize: shot.shotSize,
        angle: shot.angle,
        sceneStyle: shot.sceneStyle,
        characterCostume: shot.characterCostume,
      })),
      continuesSequence: rawShots.length > 0 && rawShots[rawShots.length - 1]?.sequenceId === beats[0]?.sequenceId,
      nextBeats: allBeats.filter(beat => beat.index > lastIndex).slice(0, 2),
      characters,
      objects,
      language,
      visualStyle,
      capturePreset,
    });
    let batchShots: any[] | undefined;
    let lastError: unknown;
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts && !batchShots; attempt += 1) {
      try {
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, Math.min(10_000, attempt === 2 ? 1_500 : attempt * 2_000)));
        }
        const correction = attempt === 1
          ? ''
          : `${structuredRetryCorrection(lastError)} Return a JSON array with exactly ${beats.length} items for shots ${beats[0]?.index || 0}-${lastIndex}.`;
        console.log(`[story-director] batch ${batchIndex + 1}/${batches.length}, attempt ${attempt}/${maxAttempts}`);
        const response = await chatOnce(`${prompt}${correction}`, {
          apiKey,
          dmxApiKey,
          provider: scriptProvider,
          model: scriptModel,
          maxOutputTokens: 7_000,
          timeoutMs: process.env.AID_LOCAL_COMPANION === '1' ? 120_000 : 48_000,
        });
        const extracted = extractJson(response);
        const parsed = normalizeDirectorShots(extracted, beats.length).map((shot, index) => ({
          ...shot,
          description: stripExactDialogueFromDescription(shot?.description, beats[index]),
        }));
        validateDirectorShots(
          parsed,
          beats,
          directorResponseShape(extracted),
          language,
          [...characters.map(character => character.name), ...objects.map(object => object.name)],
        );
        batchShots = parsed.map((shot, index) => ({
          ...shot,
          index: beats[index].index,
          sequenceId: beats[index].sequenceId,
        }));
      } catch (error) {
        lastError = error;
        console.warn(`[story-director] batch ${batchIndex + 1} failed:`, error instanceof Error ? error.message : error);
      }
    }
    if (!batchShots) {
      const first = beats[0]?.index || 0;
      const last = beats[beats.length - 1]?.index || 0;
      throw new Error(`分镜提示词 ${first}–${last} 生成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
    rawShots.push(...batchShots);
  }

  return mergeBeats(storyPlan, rawShots, aspectRatio, capturePreset);
}
