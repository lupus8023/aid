import type { CapturePreset, Storyboard } from '@/types';
import type { StoryPlan, Beat, WriterCharacter, WriterObject } from './types';
import { chatOnce, type ScriptProvider } from './llm';
import { extractJson } from './json';
import { generationDraft, recoverGeneration } from './generationDraft';
import type { VisualStyle } from '@/types';
import { buildImageCaptureContract, getProductionStylePreset } from '@/lib/promptArchitecture';
import { structuredRetryCorrection } from './storyWriter';
import { buildDirectorCaptureContract } from '@/lib/capturePresets';
import { videoDirectionWritingContract, validateVideoDirection, videoDirectionSourceKey, containsExactDialogue, isChineseVideoDirection, isEntityNameDialogue } from '@/lib/videoDirection';
import { applyDirectorFieldRepairProgress, buildDirectorFieldRepairPrompt, DirectorFieldRepairError, directorFieldRepairs, selectDirectorFieldRepairChunk } from './directorRepair';
import { isProviderContentRejection } from './providerPayload';
import { usesPhotographicReferences } from '@/lib/gptImageReferences';
import { buildGptImage2PhotographicContract } from '@/lib/gptImagePrompt';
import { storyboardVisualCastNames } from '@/lib/series/imageCastContract';
import { canonicalizeStoryIdentities, storyIdentityContract } from './storyIdentity';
import { characterProductionDescription, VISUAL_ASSET_AUTHORITY } from '@/lib/storyVisualAssets';

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
  const characterDetails = characters.map(c => `- ${c.name}: ${characterProductionDescription(c)}`).join('\n');
  const objectDetails = (objects.length ? objects.map(o => `- ${o.name}: ${o.description}`).join('\n') : '无') + `\n${VISUAL_ASSET_AUTHORITY}\n原图说明中的 [packaging] 是外包装，[product]/[material] 才是对应产品或膜体。旧稿若把包装名称用于贴脸、展开膜片等动作，使用实际膜体的登记名称和特征，保留动作、表情、运镜与逐字台词；不得把金色包装改画成金色膜片。以已选角色的原图服装为准，不根据贵妃/皇后等称谓另造服装。`;
  const firstIndex = beats[0]?.index || 0;
  const lastIndex = beats[beats.length - 1]?.index || 0;
  const stylePreset = getProductionStylePreset(visualStyle);

  const langInstruction = `项目语言 ${language === 'en' ? 'English' : '中文'} 只约束 speech 中的逐字台词。description、characterCostume 与 videoDirection 的 action/camera/detail/ending 使用中文；静态图片 prompt 和 sceneStyle 仍按生图模型需要使用英文。`;
  const videoDirectionShape = '{ "action": "完整、具象的中文可见动作句。", "camera": "完整、具象的中文摄影任务句。", "detail": "完整的中文可见细节句，或空字符串。", "ending": "完整的中文可见结束状态句。" }';

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
- 对白镜头不能按“谁说一句就切谁”机械覆盖。先用关系构图建立双方目标和空间，权力/信息发生变化时才切；用调度、景别或焦点先后交付说话者策略、听者反应与 speech.listenerState，不要求所有人全程同样清晰。lipSync 为 true 的说话者在其发声时须保留可辨认的口部。反应镜承担台词后果，不是漂亮头像。
- 同一 dialogueUnitId 是一个不可拆散的交流动作：提问/挑战要在构图里明确指向对象，回答/拒绝要接住前句压力，承诺/关键词在 callback/payoff 镜头以动作或关系变化回收。
- description 不得复述、翻译或引用 speech.exactLine，也不得把“停顿后说/以某种语气说”等声音导演指令写成画面动作；只描述可见的口型、视线、表情、阻挡与反应。精确台词和说法只由 speech 字段控制。
- 不得添加 beat 中没有的情节、台词、旁白、画外音、声音或角色行为。
- 如果用户原始输入含有 beat 未重复写出的明确视觉、服装、场景或语气要求，必须落实到 description/prompt，但不得改变剧情与镜头数量。

🌐 ${langInstruction}

🚨 名称精确匹配（强制）：characters 只允许使用下方可用角色名称（含参考角色与用户原文明确命名的文字角色）；objects 只允许使用已上传名称。不得创造新的命名角色。
图片 prompt 的 [角色全名](外观) 标记只用于本镜实际可见的角色，包含剧本已写明但不说话的同行者；不得用于对白提及者、画外音或未出镜角色。

📋 可用角色：
${characterDetails}
${storyIdentityContract(characters)}
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
   - 像向摄影师描述眼前这一刻：谁在做什么、相机在哪里、人物与环境如何重叠、光从哪里来。用连贯、具体的短句；不写关键词串或渲染规范，也不要求每镜填满同一套技术字段。
   - CAMERA 必须写清相机相对主体的高度、距离和朝向；不能只写 eye-level、close-up。
   - COMPOSITION 必须写清主体在画面中的位置、留白方向，以及前景/中景/背景关系；需要时使用真实遮挡、非对称裁切或贴近地面的机位，不要每镜都中央构图。
   - 只说明故事需要看清什么、哪些背景可以暗下去或看不清；不要为了真实感强加微距细节、极浅景深或镜头瑕疵。
   - 静态图光线沿用角色定稿的柔硬度、色调和质感，按剧本写出当前光源方向；不新增风格化处理，也不以“去美颜、粗糙写实”覆盖定稿。
   - 不使用材质/渲染工程术语：不要在成稿中罗列 PBR、subsurface scattering、material response、microcontrast、highlight roll-off、global illumination、shader、ray tracing。用具体可见的现象代替；不要求每种表面都清楚、漂亮、发亮。
   - 幻想设定保留原种族、造型和地理；写实项目可用实体化妆、服装、布景与道具灯来表现，不能借此把生物改成人类或把真实水下剧情改成空摄影棚。不要让摄影器材或剧组入镜。
   - 每条 prompt 约 55–95 个英文词，长度服从这一镜所需的信息，不补通用风格口号。最独特的行动与机位放在前面。
   - 静态图沿用所选角色原图的身份、服装、媒介、皮肤质感、光线与审美；不要重写风格，不加 cinematic、photorealistic、电影调色、胶片颗粒等通用风格词。没有参考图才按项目风格建立基线。道具参考只控制产品设计与细节，不能改写人物风格。
   - 精确执行 beat.characters 中的命名角色：每个只出现一次，不新增命名角色。剧本明确写出的无名背景侍从、群众可保留为次要人物；没有写到就不添加，不能让群众复制主角面孔。角色参考图的多视图不是多个人。
   - 禁止叠加字幕、标题、对白文字、气泡、水印和界面文字；仅保留参考产品实物表面原有的标签、Logo与印字，不新增或改写。
3. characterCostume：为每个在本镜头出现的角色给一套服装/发型/配饰/颜色描述，跨镜头保持一致。
4. shotSize / cameraMove / angle：为剧本动作选择一个明确且可执行的景别、单一物理运镜和机位；相邻镜头避免机械重复。
   - 先确定本镜要揭示的信息或关系变化，再选一个摄影任务；cameraMove 写具体方向与幅度，不以“轻微调整”代替设计。参照前后镜的景别、运动方向、焦点与落点组织节奏，不连续套用固定全景或慢推。固定构图有叙事作用时保留，不按比例强加运动。具体执行写入 videoDirection.camera，其他字段不得给出相反指令。
   - 动作按“进入→加速/施力→撞点/决定→短回落”组织；速度感来自加速度，不来自整段匀速快或匀速慢。除非 beat 明确要求主观时间，否则禁止慢动作、bullet time、长时间悬停和无目的 slow push。
   - 微表演只选择本镜需要的可见反应，不罗列五官运动清单。视线、转头和重心变化应符合动作因果，避免所有部位同时启动；每镜只保留一个主动作，其余时间允许稳定观察。
   - 有接触或施力时写出真实物理链：接近→接触→软组织/衣物/道具先受压或蓄力→压力增加→短保持→逐渐释放→惯性/弹性回弹。只让受力区域明显变形，松开后保留约 0.2–0.4 秒残余状态，不能一帧复原。
   - 关键信息或反应落定后保留 0.25–0.6 秒可读呼吸；普通内容不额外停顿。镜尾仍要留下动作、视线、道具、前景遮挡、焦点或可见后果作为下一镜的交棒。
   - 人物行为与摄影机行为分开设计：人物按剧情触发产生可见反应，不机械套用“先眼球后头部再手臂”的全套过程；摄影机按下方拍摄方式合同执行，电影调度可以同步运动，观察拍摄才要求滞后跟随，固定监控保持固定。
   - “自然”不能靠随机晃动或瑕疵词堆砌。每个构图漂移、遮挡、失焦、曝光修正或动态模糊都必须由人物突然移动、受限机位、前景穿过或具体成像系统引起。允许短暂无事发生、动作做到一半停下、头发/衣物没有整理完以及反应逐渐消退；不要为了填满时长让人物持续活动。
   - prompt 是静态分镜，只选择行为链中一个可拍到的物理瞬间；不得在同一张图里同时描述“先做 A、随后做 B、最后做 C”。完整动作顺序留给 description/performance 和下游视频时间线。
   - 无对白镜头禁止出现“自言自语、像要说话、嘴唇说了半句、听见某种声音”等可能触发模型生成人声的暗示；只能描述无歧义的可见触发和身体反应。对白内容只存在于 speech 字段。
   - 每个接缝只选择一种剪辑语法：动作匹配、视线匹配、道具/形状匹配、前景遮挡藏切、焦点接力、因果切、对照切或平行切。保持运动矢量、速度和银幕方向连续；禁止用淡入淡出、叠化或任意擦除掩盖不连续。
   - 蒙太奇必须有句法：因果切让前镜结果触发后镜动作；平行切比较同时发生的压力；对照切让前后价值发生碰撞；省略切跳过重复过程但保留动作起点、关键变化与结果。每一切既回答上一个观众问题，又打开更具体的下一个问题。
5. sceneStyle：用20–40个英文词记录当前地点、时段与主要现场光源，供同场景镜头复用。不要复制整季场景说明、将来变灯方案、材质清单或渲染术语。

🎥 项目成像基线（静态 prompt 有角色定稿时不使用下列风格段，只还原分镜事实并继承角色原图）：
Selected production style: ${stylePreset.label} — ${stylePreset.description}
${usesPhotographicReferences(visualStyle) ? buildGptImage2PhotographicContract(visualStyle, capturePreset) : buildImageCaptureContract(visualStyle)}
${buildDirectorCaptureContract(capturePreset)}

连续镜头应共享同一相机/镜头家族、色彩响应、主光方向和场景材质；每镜只改变有叙事理由的机位、距离、焦点、遮挡和曝光反应。真实感来自一致的物理因果，而不是反复添加 cinematic、8K、masterpiece、photorealistic 等泛化词。

不要输出完整 H3 提示词或章节模板。按下方 JSON 为每镜输出完整分镜字段，其中 videoDirection 是独立于静态 prompt 的中文拍摄指令；下游会把 1–4 个分镜重新编组成一个不超过 15 秒的 H3 片段，统一加入参考绑定、切镜时间与逐字对白。
${videoDirectionWritingContract('zh')}

🚨 videoDirection 输出前逐字段自检：
- action / camera / detail / ending 的动作、状态、方位、摄影与连接词必须全部使用中文；已登记角色、物体正名原样保留。
- 对白中的概念、引号词、官职泛称或剧情总结不是可见动作，不能留在 videoDirection；把它们改成可拍到的身体动作和物理结果。
- 四个字段不得混入英文导演说明、逐字台词、日文、韩文或西里尔字符。逐项检查本批全部 ${beats.length} 镜后再输出 JSON。

📝 输出（只输出 JSON 数组，按 beat 顺序，第 i 个元素对应第 i 个 beat）：
[
  {
    "index": ${firstIndex},
    "description": "镜头描述",
    "prompt": "English image prompt",
    "videoDirection": ${videoDirectionShape},
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
  visualStyle?: VisualStyle,
  knownCharacterNames: string[] = [],
): Storyboard[] {
  const beats = storyPlan.sequences.flatMap(seq => seq.beats.map(beat => ({ ...beat, sceneStyle: beat.sceneStyle || seq.sceneStyle })));

  return beats.map((beat: Beat, i: number) => {
    const raw = Array.isArray(rawShots) ? rawShots[i] : undefined;
    const continuityFrom = beat.continuityFrom && beat.continuityFrom > 0
      ? `scene-${beat.continuityFrom}`
      : undefined;

    const storyboard: Storyboard = {
      id: `scene-${i + 1}`,
      sceneNumber: i + 1,
      action: beat.action,
      performance: beat.performance,
      sequenceId: beat.sequenceId,
      locationId: beat.locationId,
      description: typeof raw?.description === 'string' ? raw.description : beat.action,
      prompt: typeof raw?.prompt === 'string' ? raw.prompt : beat.promptDraft || beat.action,
      videoPrompt: undefined,
      videoDirection: raw?.videoDirection,
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
      visualStyle,
    };
    storyboard.characters = storyboardVisualCastNames(storyboard, knownCharacterNames);
    storyboard.videoDirectionSource = videoDirectionSourceKey(storyboard);
    return storyboard;
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

export function stripExactDialogueFromDescription(value: unknown, beat?: Pick<Beat, 'speech'>, entityNames: string[] = []): string {
  let description = String(value || '').replace(/\p{Script=Cyrillic}+/gu, '');
  for (const line of beat?.speech || []) {
    const exactLine = String(line.exactLine || '').trim();
    if (!exactLine) continue;
    const speechAttribution = '(?:(?:低声|高声|轻声)?(?:说出|说道|说)|\\b(?:says?|asks?|replies?|whispers?|shouts?))\\s*[,.:：]?\\s*';
    const flexibleExactLine = [...normalizedDialogueMatch(exactLine)]
      .map(character => escapeRegExp(character))
      .join('[\\s\\p{P}\\p{S}]*');
    if (isEntityNameDialogue(exactLine, entityNames)) {
      // Remove quoted/attributed speech only, never the actor performing the action.
      description = description.replace(new RegExp(`(?:${speechAttribution})?[“"'「『]${flexibleExactLine}[\\s\\p{P}\\p{S}]*?[”"'」』]|${speechAttribution}${flexibleExactLine}[。.!！?？]?`, 'giu'), '');
      continue;
    }
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
  requireVideoDirection = false,
): void {
  if (shots.length !== beats.length) {
    throw new Error(`返回 ${shots.length} 镜，要求 ${beats.length} 镜（响应结构：${sourceShape}）`);
  }
  const problems: string[] = [];
  shots.forEach((shot, index) => {
    try {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)) {
      throw new Error(`第 ${beats[index]?.index || index + 1} 镜不是有效对象`);
    }
    const missing = ['description', 'prompt'].filter(key => typeof shot[key] !== 'string' || !shot[key].trim());
    if (missing.length) {
      throw new Error(`第 ${beats[index]?.index || index + 1} 镜缺少 ${missing.join('、')}`);
    }
    if (requireVideoDirection || shot.videoDirection !== undefined) {
      try {
        shot.videoDirection = validateVideoDirection(shot.videoDirection, entityNames, (beats[index]?.speech || []).map(line => line.exactLine), requireVideoDirection);
        if (!isChineseVideoDirection(shot.videoDirection, entityNames)) throw new Error('videoDirection 的 action/camera/detail/ending 必须使用中文，登记专名除外');
      } catch (error) {
        throw new Error(`第 ${beats[index]?.index || index + 1} 镜：${error instanceof Error ? error.message : error}`);
      }
    }
    const description = withoutEntityNames(shot.description, entityNames);
    if (/\p{Script=Cyrillic}/u.test(description)) {
      throw new Error(`第 ${beats[index]?.index || index + 1} 镜 description 混入了异常西里尔字符`);
    }
    for (const line of beats[index]?.speech || []) {
      if (containsExactDialogue(shot.description, line.exactLine, entityNames)) {
        throw new Error(`第 ${beats[index]?.index || index + 1} 镜 description 重复了权威台词`);
      }
    }
    } catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  });
  if (problems.length) throw new Error(problems.join('；'));
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
  /** Explicit redo key; participates in draft identity so a deliberate visual
   * rewrite never restores a valid response from an earlier visual pass. */
  generationRevision?: string;
}): Promise<Storyboard[]> {
  const { storyPlan: submittedPlan, characters, objects, apiKey, aspectRatio, language = 'zh', visualStyle, capturePreset, scriptProvider, scriptModel = 'gpt-4o', dmxApiKey, generationRevision } = input;
  const storyPlan = canonicalizeStoryIdentities(submittedPlan, characters);
  const registeredEntityNames = [...characters.map(character => character.name), ...objects.map(object => object.name)];
  // The motion brief is additional output, so keep each response bounded.
  const batches = buildDirectorBatches(storyPlan, 6);
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
        cameraMove: shot.cameraMove,
        videoDirection: shot.videoDirection,
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
    let repairFeedback: DirectorFieldRepairError | undefined;
    const maxAttempts = 8;
    try {
      batchShots = await recoverGeneration({
        draft: generationDraft('story-director', [generationRevision || '', prompt, scriptProvider, scriptModel, apiKey, dmxApiKey]),
        attempts: maxAttempts,
        shouldRetry: error => !isProviderContentRejection(error),
        generate: async (previous, lastError, attempt) => {
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, Math.min(10_000, attempt === 2 ? 1_500 : attempt * 2_000)));
        }
        // Retry a small field patch, not the whole validated batch. Re-derive
        // from the retained draft even after a transport/patch error so a
        // transient failure cannot send us back to rewriting correct shots.
        let retained: any[] | undefined;
        if (previous) {
          try { retained = normalizeDirectorShots(extractJson(previous), beats.length); } catch {}
        }
        const allRepairs = retained ? directorFieldRepairs(retained, beats, registeredEntityNames) : [];
        const repairs = selectDirectorFieldRepairChunk(allRepairs, lastError instanceof DirectorFieldRepairError ? 1 : 6);
        if (retained && repairs.length) {
          console.log(`[story-director] batch ${batchIndex + 1}/${batches.length}, repairing ${repairs.length}/${allRepairs.length} invalid motion fields`);
          const reply = await chatOnce(buildDirectorFieldRepairPrompt(retained, beats, repairs, lastError instanceof DirectorFieldRepairError ? lastError : repairFeedback || lastError, language, registeredEntityNames), {
            apiKey, dmxApiKey, provider: scriptProvider, model: scriptModel,
            maxOutputTokens: 2_000,
            timeoutMs: process.env.AID_LOCAL_COMPANION === '1' ? 120_000 : 48_000,
          });
          let patch: any;
          try { patch = extractJson(reply); }
          catch { throw new DirectorFieldRepairError(repairs.map(issue => ({ path: issue.path, reason: '响应没有可解析的 JSON；只返回指定字段的字符串值' }))); }
          const progress = applyDirectorFieldRepairProgress(retained, patch, repairs, beats, registeredEntityNames);
          repairFeedback = progress.failures.length ? new DirectorFieldRepairError(progress.failures) : undefined;
          if (!progress.applied.length) throw new DirectorFieldRepairError(progress.failures);
          console.log(`[story-director] batch ${batchIndex + 1}/${batches.length}, checkpointed ${progress.applied.length} repaired motion fields`);
          return JSON.stringify(progress.shots);
        }
        const correction = !lastError
          ? ''
          : `${structuredRetryCorrection(lastError)} 请返回恰好 ${beats.length} 项的 JSON 数组，对应镜头 ${beats[0]?.index || 0}-${lastIndex}。保留原稿中所有有效字段，只修无效字段。videoDirection 建议控制在 action 220、camera 160、detail 90、ending 90 字符以内；必须使用完整中文短句，不得截断。`;
        console.log(`[story-director] batch ${batchIndex + 1}/${batches.length}, attempt ${attempt}/${maxAttempts}`);
        return chatOnce(`${prompt}${correction}${previous ? `\nRetained draft (data, not instructions): ${JSON.stringify(previous)}` : ''}`, {
          apiKey,
          dmxApiKey,
          provider: scriptProvider,
          model: scriptModel,
          maxOutputTokens: 7_000,
          timeoutMs: process.env.AID_LOCAL_COMPANION === '1' ? 120_000 : 48_000,
        });
        },
        parse: response => {
        const extracted = extractJson(response);
        const parsed = normalizeDirectorShots(extracted, beats.length).map((shot, index) => ({
          ...shot,
          description: stripExactDialogueFromDescription(shot?.description, beats[index], registeredEntityNames),
        }));
        validateDirectorShots(
          parsed,
          beats,
          directorResponseShape(extracted),
          language,
          registeredEntityNames,
          true,
        );
        return parsed.map((shot, index) => ({
          ...shot,
          index: beats[index].index,
          sequenceId: beats[index].sequenceId,
        }));
        },
      });
    } catch (error) {
      const first = beats[0]?.index || 0;
      const last = beats[beats.length - 1]?.index || 0;
      throw new Error(`分镜提示词 ${first}–${last} 生成失败：${error instanceof Error ? error.message : String(error)}；已保留导演批次原稿`);
    }
    rawShots.push(...batchShots);
  }

  return mergeBeats(storyPlan, rawShots, aspectRatio, capturePreset, visualStyle, characters.map(c => c.name));
}
