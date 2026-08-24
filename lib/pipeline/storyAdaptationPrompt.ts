import { normalizeTargetShotCount, targetDurationSeconds } from './shotCount';
import { isDirectingInstructionDialogue, speechSeconds } from '@/lib/speechAudioContract';

const ADAPTED_SHOT_LINE = /^\s*(?:[-*#]+\s*)?(?:\*\*)?(?:SHOT|镜头)\s*0*(\d+)\b/iu;
const DIALOGUE_MARKER = /(?:dialogue|台词)\s*[:：]/iu;
const SPOKEN_LINE = /([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,4}|[\p{Script=Han}]{1,12})\s*[:：]\s*[“"]([^”"]+)[”"]/gu;

export interface AdaptedStoryValidation {
  valid: boolean;
  errors: string[];
  shotCount: number;
}

/**
 * Validate the human-readable adapted screenplay at the same production
 * boundary used by the structured Story JSON and MiniMax H3 scheduler.  The
 * adaptation button must not return a draft that can only fail later.
 */
export function validateAdaptedStoryScript(
  script: string,
  targetShotCount?: number,
): AdaptedStoryValidation {
  const targetShots = normalizeTargetShotCount(targetShotCount);
  const shotLines = String(script || '').split(/\r?\n/).map(line => ({
    line,
    match: line.match(ADAPTED_SHOT_LINE),
  })).filter(item => item.match);
  const errors: string[] = [];

  if (shotLines.length !== targetShots) {
    errors.push(`镜头行数量为 ${shotLines.length}，必须严格为 ${targetShots}`);
  }

  shotLines.forEach((item, offset) => {
    const shotIndex = Number(item.match?.[1]);
    const expectedIndex = offset + 1;
    if (shotIndex !== expectedIndex) {
      errors.push(`第 ${expectedIndex} 条镜头行编号为 ${shotIndex || '空'}，必须连续编号为 ${expectedIndex}`);
    }

    const marker = item.line.match(DIALOGUE_MARKER);
    if (!marker) {
      errors.push(`镜头 ${shotIndex || expectedIndex} 缺少“台词：角色：“原文””或“台词：无”字段`);
      return;
    }
    const dialogueText = item.line.slice((marker.index || 0) + marker[0].length).trim()
      .replace(/\*\*\s*$/, '')
      .trim();
    if (/^(?:无|none|n\/a)[。.!！]?$/iu.test(dialogueText)) return;

    const turns = [...dialogueText.matchAll(SPOKEN_LINE)].map(match => ({
      speaker: String(match[1] || '').trim(),
      text: String(match[2] || '').replace(/\s+/g, ' ').trim(),
    })).filter(turn => turn.speaker && turn.text);
    if (!turns.length) {
      errors.push(`镜头 ${shotIndex || expectedIndex} 的台词格式无法转换为 Story JSON`);
      return;
    }
    if (turns.length > 3) {
      errors.push(`镜头 ${shotIndex || expectedIndex} 有 ${turns.length} 轮台词，H3 单段最多安排 3 轮；请拆到相邻镜头`);
    }
    const directingTurn = turns.find(turn => isDirectingInstructionDialogue(turn.text));
    if (directingTurn) {
      errors.push(`镜头 ${shotIndex || expectedIndex} 把表演指令写进了可朗读台词：“${directingTurn.text}”`);
    }
    const speechDuration = turns.reduce((total, turn) => total + speechSeconds(turn.text), 0);
    const requiredDuration = speechDuration
      + Math.max(0, turns.length - 1) * 0.35
      + 0.45
      + 0.55;
    if (requiredDuration > 15) {
      errors.push(`镜头 ${shotIndex || expectedIndex} 的 ${turns.length} 轮台词至少需要 ${requiredDuration.toFixed(1)} 秒，超过 H3 15 秒；压缩新增台词，原文则按标点连续拆到相邻镜头`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    shotCount: shotLines.length,
  };
}

export function buildStoryAdaptationCorrection(errors: string[]): string {
  return `\n\n上一次改编稿未通过 AID 视频 JSON 生产校验：\n${errors.slice(0, 12).map((error, index) => `${index + 1}. ${error}`).join('\n')}\n请从用户原始输入重新输出完整改编稿，不要只修补局部。普通原稿台词可在不改变剧情事实、意图和回应关系的前提下压缩改写；只有用户明确标注“必须逐字保留/不可改”的台词才保持原字词和顺序，必要时沿自然标点拆成连续片段分配到相邻镜头。最终每镜最多 3 轮对白，含轮间 0.35 秒、开头 0.45 秒和结尾 0.55 秒后必须不超过 15 秒。只输出完整改编剧本。`;
}

export function buildStoryAdaptationPrompt(input: {
  brief: string;
  language?: 'zh' | 'en';
  targetShotCount?: number;
}): string {
  const language = input.language === 'en' ? 'en' : 'zh';
  const targetShots = normalizeTargetShotCount(input.targetShotCount);
  const targetSeconds = targetDurationSeconds(targetShots);
  const shotDigits = String(targetShots).length;
  const outputRule = language === 'en'
    ? `Write the entire adapted screenplay in English. Output exactly ${targetShots} numbered story beats, from SHOT ${String(1).padStart(shotDigits, '0')} through SHOT ${targetShots}.`
    : `使用中文输出完整改编剧本。严格输出 ${targetShots} 个编号剧情节拍，从“镜头 ${String(1).padStart(shotDigits, '0')}”连续写到“镜头 ${targetShots}”。`;
  const lineFormat = language === 'en'
    ? `SHOT NN | sequence/location | one visible action that changes the situation | dialogue: Character: “complete playable line” Character: “ordered response” or NONE`
    : `镜头 NN｜场次/地点｜一个会改变局面的可见动作｜台词：角色：“完整、可表演的台词” 角色：“按顺序回应的台词”或“无”`;

  return `你是一位影视改编编剧。用户提供的可能是一句话构想、故事梗概、小说片段或详细剧本。你的任务不是泛化扩写，而是把原文改编成符合 AID 制作规格、能继续生成分镜的镜头节拍剧本。

AID 制作规格（最高优先级）：
- ${outputRule}
- 目标成片约 ${targetSeconds} 秒，平均每镜约 5 秒；允许根据台词、动作和情绪停顿微调，但不得改变镜头总数。
- 先在内部把 ${targetShots} 镜分配给开场、发展、升级、高潮和收束，并确保各场额度之和严格等于 ${targetShots}。
- 每个镜头只写一个明确、可见、可表演的动作单元；前一镜的结果必须成为后一镜的原因。
- 镜头编号不得重复、跳号、合并或用“若干镜头”“蒙太奇数镜”等方式代替。

改编原则：
- 保留用户明确给出的剧情事实、人物关系、事件顺序、结局、风格和禁止事项；用户文本中的其他镜头数要求与 AID 制作规格冲突时，以 ${targetShots} 镜为准。用户主动使用“改写剧本”即授权把普通原稿台词改写成可制作对白，但不得改变其事实、意图、说话者和回应关系。
- 输入越具体，剧情改动越少；只补足因果、转场、可见动作和必要的情绪推进，不另造核心设定。
- 若原文内容不足以支撑 ${targetShots} 镜，通过动作过程、反应、选择、后果和环境互动增加有效剧情节拍，禁止用重复走路、凝视或空镜凑数。
- 若原文内容过多，合并重复信息但保留关键事件，绝不能把多个关键动作塞进同一镜。
- 先按场次设计完整的“意图→阻力→转折→结果”：角色进场时想得到什么、采用什么策略、被谁/什么阻挡、最后因一个可见选择而改变局面。每场结尾必须让人物、关系、信息或风险至少一项发生不可逆变化。
- 台词是角色行动，不是标语。先在内部为每场设计对白推进：提出问题/挑战或隐瞒 → 对方回应或拒绝 → 信息/关系改变 → 后续承诺、关键词或谎言得到回收。听者的回应和说后变化与说话本身同等重要。
- 用户未要求对白、旁白或口播时，仍优先以动作和表情叙事；但私人目标、误解、关系转折、承诺、拒绝、决定和回收若仅靠画面会含混，就必须写足以理解剧情的必要对白。不得添加画外音、路人台词、笑声、哼唱或无来源人声。
- 普通原稿台词允许压缩、重写或合并，使它更自然、更可表演并满足 H3 时长，但必须保留说话者、剧情事实、意图、回应关系和关键称谓。只有用户明确写明“必须逐字保留”“不可改”“原句照读”等锁定要求时，才把对应台词视为逐字权威文本。
- 对明确锁定的逐字台词，以全片连续台词为准：若一条锁定台词无法装入一个 H3 片段，必须沿自然标点把原句连续拆到相邻镜头，保持原字词、说话者和先后顺序，不得硬塞进一镜，也不得删改或重复。
- 新增或改写台词必须自然、具体、有对象并推进局面；不限制为“一句很短的话”。同一镜可有 1–3 条按顺序发生的短对答，只要预计能在 15 秒内完成并留出说后反应。
- 输出会直接转换为 Story JSON。每镜最多 3 轮台词；按中文约 4.2 字/秒、英文约 2.4 词/秒估算，并计入轮间 0.35 秒、开头至少 0.45 秒、结尾至少 0.55 秒，总计不得超过 H3 15 秒。预计超时就压缩普通台词；明确锁定的逐字台词则连续拆到相邻镜头。
- “先停顿再说”“以坚定语气说”“无其他角色在场”等属于表演/场面指令，绝不能放进引号成为可朗读台词；本阶段需要的信息应写进可见动作，台词引号内只能出现角色真正说出口的字词。
- 禁止孤立口号和失去指代的碎片，如“再来”“不行”“快了”“不能停”或英文 Again/No/Almost，除非它所回应的问题、对象或动作明确保留在同一镜的前一句里。若跨镜或跨片段，台词必须自足，让观众只听这一句也知道角色在回应什么、决定什么。
- 每个有对白的场次至少形成一个完整对白单元；问题不能永远没有回答，承诺/谎言/关键词必须在后镜变化或回收。不能让连续镜头各说互不相干的漂亮句子。
- 蒙太奇只压缩过程，不删除因果：相邻画面必须形成因果、平行、对照或省略中的一种明确关系；每次并置都要让观众得到新理解。
- 本阶段只改编故事，不写焦距、运镜、光圈、摄影参数、图片提示词或视频提示词。

输出格式：
1. 先用不超过 5 行写：片名、故事主线、人物目标、核心阻碍、情绪弧线。
2. 再按场次分组，但每个镜头必须各占一行并严格使用以下格式：
${lineFormat}
3. 输出前逐项自检：必须恰好存在 ${targetShots} 行镜头节拍，最后一行编号必须是 ${targetShots}。
4. 只输出改编后的剧本，不解释改编过程。

用户原始输入：
${input.brief.trim()}`;
}
