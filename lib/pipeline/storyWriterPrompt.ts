import type { WriterCharacter, WriterObject } from './types';
import { normalizeTargetShotCount, targetDurationSeconds } from './shotCount';

export interface SourceShotAdaptationGroup {
  targetIndex: number;
  sourceShotRefs: number[];
  lockedSourceShots: string[];
}

/** Build a deterministic compression map for a numbered source screenplay. */
export function buildSourceShotAdaptationMap(synopsis: string, targetShotCount: number): SourceShotAdaptationGroup[] {
  const sequences: Array<{ id: string; shots: Array<{ index: number; line: string }> }> = [];
  let current = { id: 'source-sequence-1', shots: [] as Array<{ index: number; line: string }> };
  sequences.push(current);
  for (const rawLine of String(synopsis || '').split(/\r?\n/)) {
    const heading = rawLine.match(/^\s*#{2,}\s*(?:SEQUENCE|场次)\s*([^\n]*)/iu);
    if (heading) {
      if (current.shots.length) {
        current = { id: heading[1]?.trim() || `source-sequence-${sequences.length + 1}`, shots: [] };
        sequences.push(current);
      } else {
        current.id = heading[1]?.trim() || current.id;
      }
      continue;
    }
    const shot = rawLine.match(/(?:SHOT|镜头)\s*0*(\d+)\b/iu);
    if (!shot) continue;
    current.shots.push({ index: Number(shot[1]), line: rawLine.trim() });
  }
  const populated = sequences.filter(sequence => sequence.shots.length);
  const sourceShotCount = populated.reduce((total, sequence) => total + sequence.shots.length, 0);
  if (!sourceShotCount || sourceShotCount <= targetShotCount || populated.length > targetShotCount) return [];

  const estimatedSpeechSeconds = (line: string) => [...line.matchAll(/[“"]([^”"]+)[”"]/gu)]
    .reduce((total, match) => {
      const text = match[1] || '';
      const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
      const words = (text.match(/[A-Za-z0-9']+/g) || []).length;
      const punctuation = (text.match(/[，。！？,.!?;；:：]/g) || []).length;
      // Keep this estimate identical to the final H3 speech scheduler.  The
      // older, faster 2.65 words/s estimate allowed a dialogue group through
      // the outline planner only for the video prompt to reject it later.
      return total + Math.max(0.8, han / 4.2 + words / 2.4 + punctuation * 0.08);
    }, 0);
  const allocations = populated.map(sequence => {
    const exact = (sequence.shots.length * targetShotCount) / sourceShotCount;
    const speechFloor = Math.ceil(sequence.shots.reduce((total, shot) => total + estimatedSpeechSeconds(shot.line), 0) / 13.2);
    const minCount = Math.max(1, speechFloor);
    return { sequence, count: Math.max(minCount, Math.floor(exact)), minCount, remainder: exact - Math.floor(exact) };
  });
  let allocated = allocations.reduce((total, item) => total + item.count, 0);
  while (allocated < targetShotCount) {
    const candidate = allocations
      .filter(item => item.count < item.sequence.shots.length)
      .sort((a, b) => b.remainder - a.remainder || b.sequence.shots.length - a.sequence.shots.length)[0];
    if (!candidate) break;
    candidate.count += 1;
    candidate.remainder = -1;
    allocated += 1;
  }
  while (allocated > targetShotCount) {
    const candidate = allocations
      .filter(item => item.count > item.minCount)
      .sort((a, b) => a.remainder - b.remainder || b.count - a.count)[0];
    if (!candidate) break;
    candidate.count -= 1;
    allocated -= 1;
  }

  const groups: SourceShotAdaptationGroup[] = [];
  for (const { sequence, count } of allocations) {
    const shotCount = sequence.shots.length;
    const dp = Array.from({ length: count + 1 }, () => Array(shotCount + 1).fill(Number.POSITIVE_INFINITY));
    const previous = Array.from({ length: count + 1 }, () => Array(shotCount + 1).fill(-1));
    dp[0][0] = 0;
    const groupCost = (start: number, end: number) => {
      const shots = sequence.shots.slice(start, end);
      const speech = shots.reduce((total, shot) => total + estimatedSpeechSeconds(shot.line), 0);
      const speechEvents = shots.reduce((total, shot) => total + [...shot.line.matchAll(/[“"]([^”"]+)[”"]/gu)].length, 0);
      const locations = new Set(shots.map(shot => shot.line.split('|')[1]?.trim()).filter(Boolean));
      const durationRisk = speech + Math.max(0, speechEvents - 1) * 0.12 + (speechEvents ? 1.8 : 0);
      return (durationRisk > 14.4 ? 100_000 + durationRisk * 1_000 : durationRisk * 12)
        + Math.max(0, shots.length - 1) * 2
        + Math.max(0, locations.size - 1) * 8;
    };
    for (let groupIndex = 1; groupIndex <= count; groupIndex += 1) {
      for (let end = groupIndex; end <= shotCount; end += 1) {
        const minStart = Math.max(groupIndex - 1, end - 4);
        for (let start = minStart; start < end; start += 1) {
          if (!Number.isFinite(dp[groupIndex - 1][start])) continue;
          const cost = dp[groupIndex - 1][start] + groupCost(start, end);
          if (cost < dp[groupIndex][end]) {
            dp[groupIndex][end] = cost;
            previous[groupIndex][end] = start;
          }
        }
      }
    }
    const partitions: Array<Array<{ index: number; line: string }>> = [];
    let end = shotCount;
    for (let groupIndex = count; groupIndex > 0; groupIndex -= 1) {
      const start = previous[groupIndex][end];
      if (start < 0) return [];
      partitions.unshift(sequence.shots.slice(start, end));
      end = start;
    }
    for (const shots of partitions) {
      groups.push({
        targetIndex: groups.length + 1,
        sourceShotRefs: shots.map(shot => shot.index),
        lockedSourceShots: shots.map(shot => shot.line),
      });
    }
  }
  return groups.length === targetShotCount ? groups : [];
}

export function buildStoryOutlinePrompt(input: {
  synopsis: string;
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
  targetShotCount?: number;
}): string {
  const { synopsis, characters, objects, language } = input;
  const targetShots = normalizeTargetShotCount(input.targetShotCount);
  const targetSeconds = targetDurationSeconds(targetShots);
  const characterDetails = characters.map(character => `- ${character.name}: ${character.description}${character.gender && character.gender !== 'unknown' ? `；已知性别=${character.gender}` : ''}${character.ageGroup && character.ageGroup !== 'unknown' ? `；已知年龄段=${character.ageGroup}` : ''}`).join('\n');
  const objectDetails = objects.length
    ? objects.map(object => `- ${object.name}: ${object.description}`).join('\n')
    : 'None';
  const outputLanguage = language === 'en'
    ? 'All story text must be English; preserve uploaded entity names exactly.'
    : '所有故事文本必须使用中文；已上传实体名称保持原样。';
  const sourceAdaptationMap = buildSourceShotAdaptationMap(synopsis, targetShots);

  return `你是长片总编剧。只做【全片故事骨架与镜头地图】，不要写详细分镜、摄影 prompt、声音设计或逐镜状态 JSON。

最高优先级：准确执行用户明确的剧情、人物关系、顺序、结局、台词、风格与禁止事项；只在留白处创作。
${outputLanguage}

用户原始输入：
${synopsis}

可用角色（含已上传角色与用户原文明确命名的文字角色；characters 只能使用这些精确名称）：
${characterDetails}

已上传物体（objects 只能使用这些精确名称）：
${objectDetails}

制作规格：全片严格 ${targetShots} 镜，目标约 ${targetSeconds} 秒。

${sourceAdaptationMap.length ? `编号原稿压缩合同（权威）：原稿镜数多于目标镜数。每个 targetIndex 必须只改编对应 sourceShotRefs 的相邻原镜；actionGoal 合并其动作因果，所有原台词逐字保留在 requiredDialogueLines。不得跨组搬运、遗漏或按比例猜测台词位置。\n${JSON.stringify(sourceAdaptationMap, null, 2)}` : ''}

先锁定全片因果链、人物弧线、核心观众问题、高潮选择、结局、伏笔回收与对白弧线，再分配 sequences。每个 sequence 的 beatMap 只写极简镜头地图；所有 beatMap 合计必须严格 ${targetShots} 条，全片 index 从 1 连续到 ${targetShots}。

叙事设计规则：
- 故事不是事件清单。每个 sequence 都要提出一个 dramaticQuestion，并在 turningPoint 用角色行动改变答案；exitHook 让下一场成为必然。
- 每镜必须产生 informationGain：观众新知道一个事实、误解被修正、关系/目标/风险发生变化，或一个伏笔得到推进；不能只重复“很危险/很伤心”。
- audienceQuestion 记录观众此刻追问什么。镜头可以回答旧问题，但必须同时提出更具体的新问题，直到高潮回收 centralDramaticQuestion。
- dialoguePurpose 规划台词的叙事功能：question、answer、reveal、conceal、challenge、refusal、decision、promise、callback、payoff 或 visual_only。不要把“台词克制”误解为默认禁言；当私人目标、关系变化、选择、承诺或回收无法仅靠画面准确表达时，必须规划有效台词。
- 用 dialogueUnitId 把跨镜的提问/回答、挑战/拒绝、承诺/回收绑定为同一连续对白单元；dialogueContext 写清这句台词承接的事实以及说完后听者必须改变的认知/关系。不能把一个完整交流拆成互不相干的口号。
- 非 visual_only 镜头必须先写 dialogueTurns，再由执行编剧写逐字台词。每个 turn 锁定 speaker、function、contentGoal、respondsTo：contentGoal 要写清该角色必须传递的新事实/立场/选择，不能只写“表达担心”“说一句鼓励”或孤立感叹。需要问答、挑战/回应、揭示/反应时，在同镜或同一 dialogueUnitId 的连续镜头安排完整轮次，不能只留下提问或半句。
- 同一人物在一个 beat 里只能有一个 dialogueTurn；同一 dialogueUnitId 的连续 beat 若可能被合并为一个 H3 片段，也不得让同一人物二次起声。把该人物要说的多个信息点合并成一个完整 contentGoal；禁止 A→A 分段和 A→B→A 返回结构。
- dialogueObligation 为 required 时必须生成台词，不得在详细剧本阶段静默降为 visual_only；optional 才允许在动作已经完全表达信息时删除；visual 表示明确无对白。
- 对白要形成跨镜呼应：问题必须得到回答或故意延迟；承诺/谎言/关键词必须在后面产生变化或回收。台词不能复述画面动作，也不能是脱离上下文的口号。
- montageRole 决定剪辑语义：setup、development、escalation、parallel、contrast、decision、consequence、bridge、payoff、resolution。并置必须产生新的理解，不是旅游式画面罗列。
- editBridge 不是“淡入淡出”特效，而是本镜的可见/可听结果如何被下一镜接住：因果触发、动作匹配、视线、物体状态、声音桥、平行或对照，并写清两镜并置后观众新增的推论。统一格式为“bridgeType: 具体可见/可听交棒; audienceInference: 观众由两镜并置新理解什么”。终镜必须写“terminal image: 解决后的可见新生活”，不能再引向下一事件。
- characters 必须为每个可用角色规划 role、gender、ageGroup 与 voiceProfile。gender 只能是 female、male、nonbinary、unknown；ageGroup 只能是 child、young_adult、adult、senior、unknown。用户原文有定义时严格服从；原文未定义时，由本阶段明确做出一次角色设计选择，使后续形象与声音共用同一性别/年龄，不得让图片模型和音频模型各自猜测。只有用户明确要求身份保持未知时才写 unknown。voiceProfile 只描述年龄感、音高、质感、气质、语速和语言，不写可朗读台词。

连续性规则：
- 前一条 consequence 必须成为后一条 cause，或明确推动下一场。
- actionGoal 是该镜头唯一可见动作/局面变化，不是摄影描述。
- emotionalTurn 写镜头前后变化；没有变化也要写“保持X但新增Y信息”。
- 任何非 visual_only 的 dialoguePurpose 都必须先在 requiredSpeaker 绑定一个上方可用角色的精确名称。用户指定台词还要在 requiredLine 中逐字保留；若只是规划由执行编剧创作的必要台词，requiredSpeaker 保留角色名而 requiredLine 留空。
- 用户原文明确命名并给出台词的文字角色保留自己的台词，绝不能转交给其他角色。未明确命名的路人或临时人声改成可见动作并设为 visual_only。
- 如果用户原稿已有编号镜头但制作规格要求不同镜数，必须按剧情语义把每条用户逐字台词重新安置到对应 actionGoal，保持说话者、原句和先后顺序；不得按旧镜号硬套、不得按比例搬运到不相干场次，也不得遗漏后半段台词。所有用户逐字台词都必须在某个 beat.requiredDialogueLines 中出现一次。
- sequence 的 entryState / exitState 必须能交接人物位置、关系、关键道具与情绪。
- 不要输出 shotSize、cameraMove、angle、sceneStyle、promptDraft、audioPlan、stateBefore 或 stateAfter；这些由后续阶段分批完成。

只输出以下 JSON 对象：
{
  "intentSummary": "准确复述用户要求",
  "requirements": [{ "id": "req-1", "text": "可核验要求", "category": "plot|character|setting|tone|format|pacing|dialogue|visual|avoid|other", "priority": "must|preference", "coveredBy": [1] }],
  "title": "片名",
  "theme": "主题",
  "logline": "一句话梗概",
  "protagonist": "主角名",
  "externalWant": "外在目标",
  "internalNeed": "内在需求",
  "stakes": "失败代价",
  "obstacle": "核心阻碍",
  "finalChoice": "高潮选择",
  "consequence": "最终结果",
  "change": "人物变化",
  "storyAnchor": "故事锚点",
  "visualMotif": "视觉母题",
  "emotionalArc": "全片情绪弧线",
  "structure": [{ "name": "opening|inciting_incident|first_threshold|midpoint_reversal|crisis_choice|climax_proof|resolution", "shotIndex": 1, "event": "该节点的可见事件/选择", "audienceShift": "节点前后观众理解如何改变" }],
  "centralDramaticQuestion": "开场提出、高潮回答的核心观众问题",
  "audiencePromise": "影片向观众承诺的类型体验与情感回报",
  "dialogueArc": "问题/承诺/冲突台词如何跨场推进并在结尾回收",
  "montageStrategy": "哪些过程省略、平行、对照或用因果剪辑压缩",
  "characters": [{ "name": "可用角色精确名称", "role": "剧情身份", "gender": "female|male|nonbinary|unknown", "ageGroup": "child|young_adult|adult|senior|unknown", "voiceProfile": "非台词的音色画像", "want": "欲望", "obstacle": "阻碍", "arc": "弧线", "subtext": "潜台词" }],
  "sequences": [{
    "id": "seq-1",
    "locationId": "english_location_key",
    "sceneGoal": "本场必须完成的剧情目标",
    "dramaticQuestion": "本场让观众追问的问题",
    "turningPoint": "本场改变局势或理解的决定性动作",
    "exitHook": "迫使故事进入下一场的未解决后果",
    "audienceEntry": "入场时观众已知/误以为的内容",
    "audienceExit": "离场时观众新增或修正的理解",
    "entryState": "人物/关系/道具/情绪入场状态",
    "exitState": "本场结束状态，供下一场继承",
    "shotCount": 9,
    "beatMap": [{
      "index": 1,
      "sourceShotRefs": [1],
      "actionGoal": "唯一可见动作与局面变化",
      "cause": "直接前因",
      "consequence": "直接后果",
      "emotionalTurn": "情绪或认知变化",
      "informationGain": "本镜让观众新增/修正的唯一关键信息",
      "dialoguePurpose": "question|answer|reveal|conceal|challenge|refusal|decision|promise|callback|payoff|visual_only",
      "dialogueUnitId": "dlg-1；同一问答/承诺回收使用同一个 id，无对白为空",
      "dialogueObligation": "required|optional|visual",
      "dialogueContext": "这句承接什么，听者听后必须理解/决定/关系改变什么",
      "dialogueTurns": [{ "speaker": "可用角色精确名称", "function": "question|answer|reveal|conceal|challenge|refusal|decision|promise|callback|payoff", "contentGoal": "本轮必须说清的新事实/立场/选择", "respondsTo": "回应的上一轮 contentGoal 或伏笔；首轮可空" }],
      "montageRole": "setup|development|escalation|parallel|contrast|decision|consequence|bridge|payoff|resolution",
      "editBridge": "bridgeType: 具体可见/可听交棒; audienceInference: 两镜并置后的新增理解；终镜写 terminal image: 解决后的可见新生活",
      "audienceQuestion": "本镜结束时观众继续追问的问题",
      "requiredSpeaker": "第一条指定台词的可用角色精确名称；无台词则空字符串",
      "requiredLine": "第一条用户指定台词或空字符串",
      "requiredDialogueLines": [{ "character": "可用角色精确名称", "text": "同一镜头内按原顺序保留的逐字台词" }]
    }]
  }]
}

输出前自检：sequences[].shotCount 之和、beatMap 长度之和都必须等于 ${targetShots}；index 必须无重复、无跳号地覆盖 1–${targetShots}。`;
}

export function buildStoryDialogueManuscriptPrompt(input: {
  outline: unknown;
  language: 'zh' | 'en';
}): string {
  const outline = (input.outline && typeof input.outline === 'object' ? input.outline : {}) as Record<string, any>;
  const sequences = Array.isArray(outline.sequences) ? outline.sequences : [];
  const spine = {
    title: outline.title,
    theme: outline.theme,
    logline: outline.logline,
    protagonist: outline.protagonist,
    externalWant: outline.externalWant,
    internalNeed: outline.internalNeed,
    stakes: outline.stakes,
    obstacle: outline.obstacle,
    finalChoice: outline.finalChoice,
    consequence: outline.consequence,
    change: outline.change,
    storyAnchor: outline.storyAnchor,
    emotionalArc: outline.emotionalArc,
    structure: outline.structure,
    centralDramaticQuestion: outline.centralDramaticQuestion,
    dialogueArc: outline.dialogueArc,
  };
  const roadmap = sequences.map((sequence: any) => ({
    id: sequence.id,
    sceneGoal: sequence.sceneGoal,
    dramaticQuestion: sequence.dramaticQuestion,
    audienceEntry: sequence.audienceEntry,
    audienceExit: sequence.audienceExit,
    turningPoint: sequence.turningPoint,
    beats: (Array.isArray(sequence.beatMap) ? sequence.beatMap : []).map((beat: any) => ({
      index: beat.index,
      actionGoal: beat.actionGoal,
      informationGain: beat.informationGain,
      emotionalTurn: beat.emotionalTurn,
      dialoguePurpose: beat.dialoguePurpose,
      dialogueUnitId: beat.dialogueUnitId,
      dialogueObligation: beat.dialogueObligation,
      dialogueContext: beat.dialogueContext,
      dialogueTurns: beat.dialogueTurns,
      requiredDialogueLines: beat.requiredDialogueLines,
      montageRole: beat.montageRole,
      audienceQuestion: beat.audienceQuestion,
    })),
  }));
  const outputLanguage = input.language === 'en'
    ? 'Write every exactLine in natural spoken English. Preserve entity names exactly.'
    : '所有 exactLine 使用自然中文口语；角色名称保持原样。';

  return `你是全片对白编剧。故事骨架和镜头地图已经锁定。你的唯一任务是一次性写完【全片连续台词稿】，让后续详细剧本、分镜和视频只负责调度，不能再把台词临时缩短。

${outputLanguage}

全片故事脊柱：
${JSON.stringify(spine, null, 2)}

按场次排列的对白路线：
${JSON.stringify(roadmap, null, 2)}

强制写作规则：
- 只为 dialogueTurns 中已经规划的轮次写台词；beatIndex、dialogueUnitId、turnIndex、speaker、function、contentGoal、respondsTo 数量与顺序完全不变。
- requiredDialogueLines 是用户逐字台词，exactLine 必须逐字等于对应原文。没有 requiredDialogueLines 的轮次才允许创作。
- exactLine 必须完整、可表演，并让只听这一句的观众听懂 contentGoal 中的新事实、立场或选择。不得把完整语义压成“不能停”“走吧”“我知道”“快点”或 Again/No/Almost 一类口号。
- 同一 dialogueUnitId 是一个完整交流动作。提问/挑战必须有明确对象；回答/拒绝必须真正接住 respondsTo；承诺、谎言、关键词必须在 callback/payoff 中发生变化，不得让连续台词各说各的。
- 每一句都要改变信息、关系、策略或决定。禁止重复画面、重复上一句、总结主题、解释观众已经看见的动作，禁止把每个人都写成同一种“漂亮金句”口气。
- 对白有潜台词：角色为达到当场目标而说，不直接朗读作者结论。只有高潮/回收允许把主题说得更清楚，但仍要落在角色当前选择上。
- 跨镜回应若可能被拆成不同 H3 片段，exactLine 必须带清楚的名词、对象或决定，不能只用失去指代的“它/那件事/这样”。
- 中文生成台词通常 24–48 个汉字；英文通常 12–28 个单词。按视频片段而非按分镜创作：同一人物跨相邻画面的相关信息必须写成一个连贯 exactLine，只在片段台词表出现一次；镜头切换不会生成第二条台词。片段可以包含多个不同说话者，但每人只出现一次，全部台词必须能在约 13 秒内自然说完并留下反应。
- exactLine 只包含真正说出口的字词。停顿、语气、表情、动作、无其他人在场等导演说明分别写入 subtext/listenerResult，绝不能进入 exactLine。
- meaningEvidence 必须逐字摘自 exactLine，是实际承载 contentGoal 的连续片段；中文至少 4 个汉字，英文至少 3 个单词。listenerResult 写台词落下后听者可见地改变了什么。

只输出：
{
  "turns": [{
    "beatIndex": 1,
    "dialogueUnitId": "dlg-1",
    "turnIndex": 1,
    "speaker": "角色精确名称",
    "function": "沿用规划",
    "contentGoal": "逐字沿用规划",
    "respondsTo": "逐字沿用规划",
    "exactLine": "完整可表演台词",
    "meaningEvidence": "exactLine 中交付 contentGoal 的原文片段",
    "subtext": "角色此刻真正想得到什么",
    "listenerResult": "听者听后可见的认知/关系/决定变化"
  }]
}

输出前逐项自检：turns 数量必须等于路线中 dialogueTurns 总数；每个规划轮次恰好出现一次，顺序不变；所有 exactLine 均能在 15 秒片段约束下完整说完。`;
}

export function buildStoryBeatBatchPrompt(input: {
  synopsis: string;
  outline: unknown;
  sequence: unknown;
  beatMap: Array<{ index: number }>;
  previousBoundary?: unknown;
  continuesSequence?: boolean;
  nextRoadmap?: Array<{ index: number }>;
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
}): string {
  const { outline, sequence, beatMap, previousBoundary, continuesSequence = false, nextRoadmap = [], characters, objects, language } = input;
  const outlineRecord = (outline && typeof outline === 'object' ? outline : {}) as Record<string, unknown>;
  const outlineSequences = Array.isArray(outlineRecord.sequences)
    ? outlineRecord.sequences as Array<{ beatMap?: Array<Record<string, unknown>> }>
    : [];
  const firstIndex = Number(beatMap[0]?.index || 0);
  const lastIndex = Number(beatMap[beatMap.length - 1]?.index || 0);
  const outputLanguage = language === 'en'
    ? 'All action, story, dialogue and state text must be English. Technical sound strings may also be English.'
    : 'action、剧情、状态和台词使用中文；sceneStyle、环境声和拟音使用简洁英文。';
  const storySpine = {
    title: outlineRecord.title,
    theme: outlineRecord.theme,
    logline: outlineRecord.logline,
    protagonist: outlineRecord.protagonist,
    externalWant: outlineRecord.externalWant,
    internalNeed: outlineRecord.internalNeed,
    stakes: outlineRecord.stakes,
    obstacle: outlineRecord.obstacle,
    finalChoice: outlineRecord.finalChoice,
    consequence: outlineRecord.consequence,
    change: outlineRecord.change,
    storyAnchor: outlineRecord.storyAnchor,
    visualMotif: outlineRecord.visualMotif,
    emotionalArc: outlineRecord.emotionalArc,
    centralDramaticQuestion: outlineRecord.centralDramaticQuestion,
    audiencePromise: outlineRecord.audiencePromise,
    dialogueArc: outlineRecord.dialogueArc,
    structure: outlineRecord.structure,
    montageStrategy: outlineRecord.montageStrategy,
    dialogueRoadmap: outlineSequences.flatMap(item => Array.isArray(item.beatMap) ? item.beatMap : [])
      .filter(item => item.dialogueObligation !== 'visual')
      .map(item => ({
        index: item.index,
        unit: item.dialogueUnitId,
        purpose: item.dialoguePurpose,
        context: item.dialogueContext,
        turns: item.dialogueTurns,
        editBridge: item.editBridge,
      })),
  };

  return `你是执行编剧。全片骨架已经锁定，只展开镜头 ${firstIndex}–${lastIndex} 的【详细剧本】，不得重写故事、改变镜头数量或提前/延后结局。

${outputLanguage}

用户原始输入已经在上一阶段被结构化锁定。为避免把整部长稿在每个批次重复发送、引发超时或安全误判，本批只使用下方全片故事脊柱、当前场次、权威镜头地图及其中的 requiredDialogueLines。逐字台词以 requiredDialogueLines 为最高优先级，不得改写。

全片故事脊柱：
${JSON.stringify(storySpine, null, 2)}

当前场次：
${JSON.stringify(sequence, null, 2)}

本批权威镜头地图（顺序与因果不可改变）：
${JSON.stringify(beatMap, null, 2)}

上一批交接状态（为空表示全片开场）：
${JSON.stringify(previousBoundary || null, null, 2)}

交接类型：${continuesSequence
  ? '同一场次续写。第一镜必须逐项继承人物位置、姿态、持物、服装、空间关系、时间和环境状态。'
  : '新场次开始。必须继承人物身份、服装、关系变化、已获得/失去的关键物和未解决因果；允许通过明确转场改变地点、时间、人物位置和环境状态。'}

后续两镜路线提示（只为铺垫，不得在本批提前发生）：
${JSON.stringify(nextRoadmap.slice(0, 2), null, 2)}

允许角色：
${characters.map(character => `- ${character.name}: ${character.description}`).join('\n')}
允许物体：
${objects.length ? objects.map(object => `- ${object.name}: ${object.description}`).join('\n') : 'None'}

写作规则：
- 严格输出 ${beatMap.length} 个 beats，对应 index ${firstIndex}–${lastIndex}；每个 beat 只展开对应 beatMap，不得合并、拆分、增删或调序。
- characters / objects 只能使用允许列表中的精确名称；临时环境元素只写在 action。
- cause → conflict → choice → consequence → nextCause 必须形成可见因果；前一镜 stateAfter 必须等于后一镜 stateBefore。最后的 payoff/resolution 镜不要凭空制造新冲突，conflict 应写已经解决的核心张力及仍需验证的余波，不能留空。
- 每镜必须落实 beatMap.informationGain 和 audienceQuestion。dramaticPurpose 说明局面为何改变，informationGain 说明观众因此理解了什么，两者不能互相复制。
- editBridge 逐字沿用 beatMap。它说明本镜结果如何成为下一镜的剪辑触发和观众推论；不能改成淡入淡出等后期特效。
- 每个 action 都要包含“触发→表演/动作→可见结果”，让后续导演能拍出因果，而不是只有人物走、看、停顿和气氛。
- 每镜只承担一个主动作弧：进入动作→加速/施力→明确触点或决定→0.25–0.6 秒可读结果。速度变化来自物理加速度和阻力，不得把整段动作默认写成匀速慢动作。
- 相邻镜头的动作和能量要形成长短交替；关键信息落定后给短呼吸，普通动作不能用无意义停顿拖时长。除非剧情明确要求时间主观化，否则禁止 slow motion、长时间悬停和空镜漂移。
- 每个镜尾必须留下一个可被下一镜接住的具体交棒：身体/道具运动方向、视线、前景遮挡、焦点变化、可见结果或由动作产生的声音；一个接缝只用一种交棒逻辑，并保持矢量、速度与银幕方向连续。
- 第一镜 stateBefore 必须按照上述交接类型承接上一批。若后续路线非空，最后一镜 nextCause 要准确铺向后续路线；若这是全片末镜且没有后续路线，nextCause 必须写已经达成的终局状态并明确不再触发新剧情，不能留空，也不能为了填字段凭空制造续集事件。
- 台词服务叙事，而不是一律从少。beatMap.requiredLine 非空时逐字写入 speech；否则按 dialoguePurpose 判断：私人目标、问题/回答、关系转折、谎言/揭示、承诺/回收或明确选择若仅靠画面会含混，就写必要台词；visual_only 才保持 speech=[]。禁止旁白、画外音、路人台词、笑声、哼唱和无来源人声。
- 台词必须承接上下文：用 storyFunction 标明 question/answer/reveal/refusal/decision/promise/callback/payoff；用 respondsTo 指向它回应的前一句信息或伏笔。不得写重复画面、孤立口号、通用感叹或没有对象的短句。
- beatMap.dialogueTurns 是全片台词稿锁定的逐条合同：speech 条数、说话者顺序和 storyFunction 必须逐项一致；exactLine 必须逐字等于 dialogueTurns.exactLine，不能改写、缩短或重新创作。contentGoal、respondsTo、meaningEvidence、subtext 和 listenerResult 都要原样保留为非朗读元数据。
- beatMap.dialogueUnitId、dialogueObligation、dialogueContext 是权威对白契约，逐项沿用。required 必须写 speech，不能因为动作可见而降为 visual_only；同一 dialogueUnitId 的问答/承诺/回收必须语义相接，听者的 listenerState 要写出听后发生的具体变化。
- 先把相邻 beat 看成待装入同一个 H3 片段的视觉参考，再安排片段级台词。一段允许多个不同人物依次说话，但每个人物只能对应一个连续 speech 条目；同一人物原本分散在多个 beat 的 story_required 信息点必须在首个发声 beat 合并成一段较长、自然、完整的 exactLine，后续 beat 的 speech=[]，禁止 A→A 分段和 A→B→A 返回说话。用户锁定的 requiredDialogueLines 仍逐字保留，若同一人物有多条则按原顺序无缝合并为一个发声块；总台词时长加首尾留白必须装入片段时长。不要为了凑数量写台词。
- 只有 dialogueObligation=optional 且没有 requiredLine 时，若本镜信息已经能靠动作完整、无歧义地交付，才可将 dialoguePurpose 明确改成 visual_only 并保持 speech=[]；dialogueObligation=required 或 requiredLine 非空时绝不能降级，也不能把一个角色的原话转嫁给另一个角色。
- beatMap.requiredDialogueLines 非空时，speech 必须逐条、逐字、按顺序等于该数组；requiredLine/requiredSpeaker 是首句兼容字段。绝不能漏句、串角色、合并旁白或把临时人物的话转嫁给主角。
- 自行创作 story_required 台词时，说话者必须在 characters 中以已上传精确名称出现；action 还要用当前输出语言清楚表现该可见角色正在开口。不要因为英文叙述使用自然称呼而改写 characters / speech.character 中的精确库名称。
- audioPlan 是唯一声音源。backgroundHuman 默认 none；环境声和拟音必须由地点或可见动作引起；未要求音乐时 music 为 none。
- transition 固定写 "cut"；时空和情绪变化通过动作、视线、物体、构图、焦点或声音桥完成，不使用 dissolve、fade 或 wipe 特效代替导演调度。
- 不生成摄影内容：不要输出 promptDraft、sceneStyle、shotSize、cameraMove、angle 或图像 prompt。

只输出：
{
  "beats": [{
    "index": ${firstIndex},
    "action": "一个明确、可见、可表演的动作单元",
    "characters": ["允许角色名"],
    "objects": ["允许物体名"],
    "clipType": "insert|reaction|establishing|action|dialogue|performance|montage|long_take",
    "dramaticPurpose": "本镜改变了什么",
    "cause": "直接前因",
    "conflict": "阻力或两难",
    "choice": "可见选择或空字符串",
    "consequence": "可见结果",
    "characterChange": "情绪/认知变化",
    "nextCause": "下一镜直接原因",
    "informationGain": "观众在本镜新增或修正的唯一理解",
    "dialoguePurpose": "沿用并具体落实 beatMap 的对白功能",
    "montageRole": "沿用 beatMap 的剪辑语义",
    "editBridge": "逐字沿用 beatMap 的剪辑交棒",
    "audienceQuestion": "本镜结束后观众追问的问题",
    "speech": [{ "character": "当前角色", "exactLine": "只填写角色真正说出口的逐字台词；导演指令必须留在 speech 之外", "emotion": "克制情绪", "delivery": "语速停顿重音", "volume": "whisper|soft|normal|raised", "lipSync": true, "listenerState": "听者听后具体改变的认知/情绪/决定", "storyFunction": "question|answer|reveal|refusal|decision|promise|callback|payoff", "respondsTo": "回应的前句/信息/伏笔；无则空", "source": "user_exact|story_required" }],
    "dialogueUnitId": "沿用 beatMap",
    "dialogueObligation": "required|optional|visual",
    "dialogueContext": "沿用 beatMap",
    "audioPlan": { "backgroundHuman": "none|indistinct_nonverbal", "environment": ["sound"], "foley": ["sound"], "music": "none", "silenceBefore": 0.0, "silenceAfter": 0.4 },
    "stateBefore": { "characters": "位置/状态", "objects": "道具状态", "environment": "环境状态", "relationships": "仅写画面可见的人物距离、朝向、视线轴和银幕侧；不得写观众理解、接受、疑问或剧情评价", "emotion": "情绪状态" },
    "stateAfter": { "characters": "位置/状态", "objects": "道具状态", "environment": "环境状态", "relationships": "仅写画面可见的人物距离、朝向、视线轴和银幕侧；不得写观众理解、接受、疑问或剧情评价", "emotion": "情绪状态" },
    "durationHint": 4.5,
    "transition": "cut",
    "continuityFrom": 0
  }]
}`;
}

// 编剧阶段 prompt：先准确理解用户约束，再把允许创作的空白发展成结构化故事。
// 与 storyAnalyzer 的分镜 prompt 相反：这里【鼓励创作】，分镜阶段才【忠实拆解】。
export function buildStoryPlanPrompt(input: {
  synopsis: string;
  characters: WriterCharacter[];
  objects: WriterObject[];
  language: 'zh' | 'en';
  targetShotCount?: number;
}): string {
  const { synopsis, characters, objects, language } = input;
  const targetShots = normalizeTargetShotCount(input.targetShotCount);
  const targetSeconds = targetDurationSeconds(targetShots);
  const characterNames = characters.map(c => c.name).join('、');
  const characterDetails = characters.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const objectNames = objects.map(o => o.name).join('、');
  const objectDetails = objects.length ? objects.map(o => `- ${o.name}: ${o.description}`).join('\n') : '无';

  const langInstruction = language === 'en'
    ? 'MANDATORY: ALL output text (theme, logline, want, obstacle, arc, subtext, action, dialogue text, sceneStyle) MUST be in ENGLISH. Only character/object names keep their original form.'
    : '强制：所有输出文本（主题、logline、欲望、阻碍、弧线、潜台词、动作、台词、sceneStyle）必须使用中文。角色/物体名称保持原样。';

  return `你是一位资深编剧兼需求分析师。用户输入可能是一句话概念，也可能是详细剧本、镜头要求、风格说明或禁止事项。
你的首要任务是准确执行用户意图；只有用户没有规定的部分，才由你进行专业的戏剧化创作。

🧭 指令优先级（从高到低，强制）
1. 用户明确写出的剧情事实、人物关系、场景、事件顺序、结局、指定台词、时长/镜头数、风格与禁止事项。
2. 可用角色与已上传物体的名称和描述。
3. 下方通用编剧原则。

需求理解规则：
- 不要把详细剧本误当成一句话灵感重写；输入越具体，改动越少。
- 不得删掉、替换、反转或弱化用户明确要求的事件和结局；不得擅自改变人物关系、时代、地点或类型。
- “不要/避免/必须/只要/保持/结尾是”等约束视为 must，绝不能被“更有戏剧性”覆盖。
- 如果用户指定镜头数量、总时长或结构，严格遵守；未指定时才按内容推导。
- 只在原文留白处补充因果、动作、过渡和潜台词。补充内容不得与原文冲突。
- 在输出前逐条自检：每个 must 要求必须能指向至少一个 beat；禁止事项的 coveredBy 可指向落实该约束的相关 beats。

🎯 Story Engine：先建立故事，再设计镜头
- 在不违背用户要求时，为故事寻找自然的局面变化；若用户明确要求平静、纪实、无反转，则不要强加转折。
- 在写 beats 前，先明确 protagonist、externalWant、internalNeed、stakes、obstacle、finalChoice、consequence、change 和 storyAnchor。它们必须贯穿全片，不能只是装饰字段。
- 每个角色必须有「想要的东西（want）」和「挡着他的东西（obstacle）」，这是戏剧性的根。
- 每个 beat 必须是因果动作：cause 引发 conflict，角色作出 choice，产生 consequence；consequence 或 nextCause 必须推动下一 beat。
- 每个 beat 必须有一个可见、可表演的 dramaticPurpose。禁止只写“人物站着、看着、慢慢走、镜头缓缓移动”而没有局面变化。
- 情绪弧线：起点情绪必须不同于终点情绪（如从压抑→释然，从疏离→靠近）。
- 台词必须有潜台词（subtext）：嘴上说的 ≠ 心里想的，不直说。
- 台词必须有叙事功能：能由动作清楚表达的内容不用重复说；但目标、关系、选择、承诺、谎言与回收若仅靠画面会含混，必须写必要台词。speech=[] 只代表这一镜确实适合纯视觉叙事，不能把“克制”执行成全片禁言。
- 不得为了“电影感”添加旁白、画外音、路人说话、感叹词、笑声、哼唱或无来源的人声。用户给出的指定台词必须逐字保留，不改写、不扩写。
- 视频片段是对白骨架，beat 只是片段内部的画面参考。预计会连续装入同一个 15 秒 H3 片段的 1–3 个相邻 beat，必须先共同确定一组有序台词事件，再分配画面动作；不得先给每个 beat 各写一句、最后再拼接。同一片段允许 A→B、A→B→C 等多人对白，但每个人物只能有一个连续发声块，禁止 A→A 分段或 A→B→A 再次起声。
- speech 是全片唯一权威台词源。一个片段中同一人物的多个信息点必须在第一个发声 beat 合并成一段较长、自然、完整的 speech；后续 beat 只用动作、反应、景别和走位承接该连续声音，speech=[]。speaker 必须在当前 characters 中；exactLine 只能包含角色真正说出口的逐字内容，绝不能填写“无人说话”“无其他角色在场”“其他角色沉默/闭嘴/无声反应”“先短暂停顿，再以坚定语气说”等导演或表演指令。情绪和说话方式写入 emotion/delivery，其他角色状态写进 action 或 state；不要用 silenceBefore 在同一人物的句子中间制造空档。
- audioPlan 是唯一权威声音源。backgroundHuman 默认 none；只有剧情明确需要人群存在感时才可用 indistinct_nonverbal，且绝不能产生可辨识词语。环境、拟音、音乐必须分层，未要求音乐时 music 写 none。
- 视觉母题（visualMotif）：一个反复出现的意象/道具，承载主题，首尾呼应（如一把伞、一盏灯、一封信）。

🌐 输出语言要求（强制）：
${langInstruction}

🚨 名称精确匹配（强制）
═══════════════════════════════════════════════════════════
1. 你只能使用上方可用角色和用户上传的物体名称。
2. beats[].characters 只能出现可用角色精确名称；beats[].objects 只能出现上传物体精确名称。
3. 绝对禁止创造新角色名/物体名放进 characters/objects 数组。
4. 不得再创造新的命名角色；无名路人、自然元素或未上传物体只在 action / promptDraft 中描述。
5. 用户明确要求出现的角色必须发挥作用；不要为了“用完素材”把无关角色强塞进故事。

📋 可用角色（含有参考角色与用户原文明确命名的文字角色）
${characterDetails}

✅ 允许的角色名称: ${characterNames}

📦 已上传物体（唯一允许的物体名称）
${objectDetails}
${objects.length ? `✅ 允许的物体名称: ${objectNames}` : '⚠️ 未上传物体'}

📖 用户原始输入（最高优先级，不得遗漏明确要求）
${synopsis}

⏱ 时长推导（durationHint，强制按内容推导）
- 中文约 4.5 字/秒，英文约 2.5 词/秒。
- 有台词的镜头：durationHint = 台词字数/语速 + 开头至少 0.8 秒 + 结尾至少 1 秒；中文 24–48 字通常约 6–12 秒。
- 无台词动作镜头：2-5 秒。
- 情绪停顿/留白镜头：4-8 秒（表达「电影感」的关键，不要全片一个速度）。
- 每个 beat 的 durationHint 是建议时长（秒），可以是一位小数；长镜头与短切交替才有节奏。
- 按 clipType 控制节奏：insert 2-4秒；reaction/establishing 3-6秒；action 4-7秒；dialogue/performance 5-8秒；montage 2-4秒；long_take 10-15秒。没有叙事理由不要用 long_take。

🎬 镜头/节奏要求
- 全片必须严格输出 ${targetShots} 个 beats，不多不少；这是制作规格，不是建议。
- 写 beats 前先在内部给 sequences 分配镜头额度，各 sequence 的 beats 数相加必须等于 ${targetShots}。
- 目标总片长约 ${targetSeconds} 秒。各镜头 durationHint 仍按内容推导，但全片 durationHint 总和应尽量接近该片长。
- beats 是【因果链】，不是并列画面：前一个 beat 导致后一个 beat。
- 每个 beat 只描述一个明确动作单元。
- 每镜只承担一个主动作弧：进入动作→加速/施力→明确触点或决定→0.25–0.6 秒可读结果。速度变化来自物理加速度和阻力，不得把整段动作默认写成匀速慢动作。
- 相邻镜头的动作、景别与能量要形成长短交替；关键信息落定后给短呼吸，但普通动作不能用无意义停顿拖时长。除非剧情明确要求时间主观化，否则禁止 slow motion、长时间悬停和空镜漂移。
- 每个镜尾必须留下一个可被下一镜接住的具体交棒：身体/道具运动方向、视线、前景遮挡、焦点变化、可见结果或由动作产生的声音。一个接缝只用一种交棒逻辑。
- 按叙事需要分配纯视觉镜与对白镜，不预设“大多数必须无台词”。有台词的 beat 每个人物只能有一段连续长台词；不同人物按顺序交接，不能同时说，也不能让同一人物在另一个人物之后再次开口。只允许当前 characters 中的已命名角色说话，禁止重复上一镜台词或添加临时说话者。
- 景别要多样（远景建场 → 中景 → 近景/特写），相邻镜头景别要有变化。
- 宁可按「动作链」合理分配，也不要一个镜头堆多个动作；同时不得超出或少于 ${targetShots} 镜。

📝 输出格式（只输出 JSON，不要其他任何内容）
{
  "intentSummary": "用1-3句话准确复述用户要做什么，不添加用户没说的核心设定",
  "requirements": [
    {
      "id": "req-1",
      "text": "一条可核验的用户要求（简洁改写，不曲解）",
      "category": "plot|character|setting|tone|format|pacing|dialogue|visual|avoid|other",
      "priority": "must|preference",
      "coveredBy": [1, 2]
    }
  ],
  "title": "片名",
  "theme": "一句话主题（谁 + 想得到什么 + 阻碍是什么）",
  "logline": "一句话梗概",
  "protagonist": "主角名",
  "externalWant": "主角表面想得到的具体目标",
  "internalNeed": "主角真正需要学会或承认的东西",
  "stakes": "失败会失去什么",
  "obstacle": "持续阻碍主角的核心力量",
  "finalChoice": "高潮处主角必须做出的选择",
  "consequence": "这个选择造成的可见结果",
  "change": "主角从开场到结尾的变化",
  "storyAnchor": "贯穿全片并在关键转折回响的故事锚点",
  "visualMotif": "视觉母题（一个反复出现的意象/道具，承载主题）",
  "emotionalArc": "全片情绪弧线（起点 → 转折 → 终点）",
  "characters": [
    { "name": "角色名", "want": "想要什么", "obstacle": "阻碍是什么", "arc": "情绪弧线", "subtext": "潜台词" }
  ],
  "sequences": [
    {
      "id": "seq-1",
      "locationId": "location_key",
      "sceneStyle": "场景环境与光影风格描述",
      "beats": [
        {
          "index": 1,
          "sequenceId": "seq-1",
          "locationId": "location_key",
          "shotSize": "景别（远景/全景/中景/近景/特写/大特写）",
          "cameraMove": "运镜（推/拉/摇/移/跟/静止/手持）",
          "angle": "机位（平视/仰拍/俯拍/过肩/FPV）",
          "action": "一个明确动作单元 + 情绪氛围（中文）",
          "characters": ["角色名"],
          "objects": ["物体名"],
          "clipType": "insert|reaction|establishing|action|dialogue|performance|montage|long_take",
          "dramaticPurpose": "本镜头必须改变什么信息、关系或决定",
          "cause": "导致本镜头发生的直接原因",
          "conflict": "本镜头中的阻力或两难",
          "choice": "角色做出的可见选择；没有则写空字符串",
          "consequence": "选择/动作产生的可见结果",
          "characterChange": "本镜头前后角色认知或情绪变化",
          "nextCause": "推动下一镜头的直接原因",
          "speech": [ { "character": "角色名；同一人物在本 beat 只能出现一次", "exactLine": "只填写该人物一次连续说完的完整台词，可适当写长，不含导演指令", "emotion": "克制的具体情绪", "delivery": "自然语速与重音，不安排句中长停顿", "volume": "whisper|soft|normal|raised", "lipSync": true, "source": "user_exact|story_required" } ],
          "audioPlan": { "backgroundHuman": "none|indistinct_nonverbal", "environment": ["明确环境声"], "foley": ["由可见动作触发的拟音"], "music": "none 或用户明确要求的音乐", "silenceBefore": 0.8, "silenceAfter": 0.8 },
          "stateBefore": { "characters": "人物位置/状态", "objects": "道具状态", "environment": "环境状态", "relationships": "仅写画面可见的人物距离、朝向、视线轴和银幕侧；不得写观众理解、接受、疑问或剧情评价", "emotion": "情绪状态" },
          "stateAfter": { "characters": "人物位置/状态", "objects": "道具状态", "environment": "环境状态", "relationships": "仅写画面可见的人物距离、朝向、视线轴和银幕侧；不得写观众理解、接受、疑问或剧情评价", "emotion": "情绪状态" },
          "durationHint": 4.5,
          "transition": "cut",
          "continuityFrom": 0,
          "sceneStyle": "本场环境与光影",
          "promptDraft": "图像 prompt 草稿：[角色名](外观关键词) 动作，环境，光影"
        }
      ]
    }
  ]
}

⚠️ 关键规则：
- requirements 必须覆盖用户输入中的所有显式要求；must 的 coveredBy 不得为空（纯全局格式要求可列出全部相关 beat）。
- beat.index 在全片范围内从 1 连续递增，不能在新 sequence 里重新从 1 开始。
- locationId：同一地点的所有镜头用相同 locationId（英文小写下划线，如 cafe、street、room）。
- sequenceId：同一场（连续时间/地点）的镜头用相同 sequenceId。
- continuityFrom：需要与前一个镜头动作连贯时，写前一个 beat 的 index；否则写 0。
- 除非发生明确时空跳转，前一 beat 的 stateAfter 必须与后一 beat 的 stateBefore 一致；不能让人物、道具、关系或情绪无原因复位。
- source="user_exact" 时 exactLine 必须能在用户原始输入中逐字找到；否则只能写 story_required。绝不输出 narrator、voice-over、路人或当前 characters 之外的 speaker。
- transition 固定写 "cut"。情绪切换和时空跳转也必须通过动作、视线、物体、构图、焦点或声音桥完成物理/语义匹配，不使用 dissolve、fade 或 wipe 特效代替导演调度。
- characters/objects 数组为空时写 []。
- sceneStyle：不要只写“cinematic lighting”或情绪形容词。用紧凑英文确定本 sequence 的拍摄基线：一种相机/镜头家族、主光来源与方向/软硬/色温、环境反射或负补光、有限曝光与高光滚降、阴影密度、色彩响应和主要材质。相邻 sequence 若时空连续必须继承同一成像系统。
- promptDraft：可用角色都用 [名称](2-3 个外观关键词) 格式；无名临时角色或物体直接描述。动作之后简要写出独特机位距离、前中后景、焦点平面和光线入射关系；不要堆 cinematic、8K、masterpiece、photorealistic 等空泛词。
- cameraMove 必须是单一、可执行的物理运镜，不要把多个方向堆在一起；sceneStyle、promptDraft、audioPlan.environment、audioPlan.foley 和非 none 的 audioPlan.music 必须使用英文，只有 action、剧情字段和台词按项目语言输出。
- 最终自检 sequences[].beats 的总数必须严格等于 ${targetShots}，beat.index 必须为 1–${targetShots}。

现在请开始，把这个梗概戏剧化成一个完整、有电影感的故事结构。`;
}
