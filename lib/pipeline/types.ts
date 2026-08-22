import type { Character, NarrativeState, ObjectItem, StoryAudioPlan, Storyboard, StoryClipType, StorySpeechLine } from '@/types';

// 编剧阶段：把「一句话梗概」变成「有欲望/冲突/转折/潜台词/母题」的结构化故事。
// 这是「全自动」的关键契约——阶段之间传结构化 JSON，而非自由文本。

export interface PlannedCharacter {
  name: string; // 绑定到用户上传的 Character.name，不得创造新角色名
  want: string; // 欲望：这个角色真正想要什么
  obstacle: string; // 阻碍：什么挡着他
  arc: string; // 弧线：起点情绪 → 终点情绪
  subtext: string; // 潜台词：嘴上说的 vs 心里想的
}

export interface Beat {
  index: number; // 全片顺序号（从 1 开始）
  sequenceId: string; // 所属场/段落
  locationId: string; // 地点标识（英文小写下划线），同地点共享场景参考
  shotSize: string; // 景别：远景/全景/中景/近景/特写/大特写等
  cameraMove: string; // 运镜：推/拉/摇/移/跟/静止/手持
  angle: string; // 机位：平视/仰拍/俯拍/过肩/FPV
  action: string; // 动作描述（一个明确动作单元，含情绪氛围）
  characters: string[]; // 本镜头出现的角色（精确匹配上传角色名）
  objects: string[]; // 本镜头出现的道具（精确匹配上传物件名）
  dialogueLines: { character: string; text: string }[]; // 台词（≤1 句/镜，带潜台词）
  speech: StorySpeechLine[]; // 唯一权威台词源；每 beat 最多一个在 action 中明确点名的已出场角色说话
  audioPlan: StoryAudioPlan; // 人声/环境/拟音/音乐/留白分层，不允许模型自由补人声
  clipType: StoryClipType;
  dramaticPurpose: string;
  cause: string;
  conflict: string;
  choice: string;
  consequence: string;
  characterChange: string;
  nextCause: string;
  stateBefore?: NarrativeState;
  stateAfter?: NarrativeState;
  durationHint: number; // 建议时长（秒），由台词字数 + 动作权重 + 情绪停顿推导
  transition: 'cut' | 'dissolve' | 'fade' | 'wipe';
  continuityFrom?: number; // 接前一个 beat 的 index（通常 index-1，动作连贯时）
  sceneStyle: string; // 场景环境 + 光影风格（英文）
  promptDraft: string; // 图像 prompt 草稿（[角色](外观) 格式）
}

export interface Sequence {
  id: string;
  locationId: string;
  sceneStyle: string;
  beats: Beat[];
}

export interface StoryRequirement {
  id: string;
  text: string;
  category: 'plot' | 'character' | 'setting' | 'tone' | 'format' | 'pacing' | 'dialogue' | 'visual' | 'avoid' | 'other';
  priority: 'must' | 'preference';
  coveredBy: number[]; // global beat indexes that satisfy this requirement
}

export interface StoryPlan {
  id: string;
  targetShotCount?: number; // 用户在剧本第一步选择的目标镜头数（9 的倍数，最大 81）
  targetDurationSeconds?: number; // 按制作规格估算的目标片长
  estimatedDurationSeconds?: number; // beats.durationHint 累加得到的实际预估片长
  sourceBrief?: string; // original user input, retained as the source of truth across stages
  intentSummary?: string; // concise understanding of what the user is asking for
  requirements?: StoryRequirement[]; // auditable mapping from explicit asks to beats
  title: string;
  theme: string; // 主题（一句话说清「谁 + 想得到什么 + 阻碍是什么」）
  logline: string; // 一句话梗概
  protagonist: string;
  externalWant: string;
  internalNeed: string;
  stakes: string;
  obstacle: string;
  finalChoice: string;
  consequence: string;
  change: string;
  storyAnchor: string;
  visualMotif: string; // 视觉母题：一个反复出现的意象/道具承载主题
  emotionalArc: string; // 全片情绪弧线（起点 → 转折 → 终点）
  characters: PlannedCharacter[];
  sequences: Sequence[];
}

export type StageName =
  | 'screenplay' // ① 编剧
  | 'direction' // ② 导演
  | 'images' // ③ 图片
  | 'audio' // ④ 声音
  | 'video' // ⑤ 视频
  | 'assembly' // ⑥ 成片
  | 'done';

export interface ShotTaskState {
  id: string; // storyboard id
  imageStatus: Storyboard['status'];
  videoStatus: Storyboard['videoStatus'];
  taskId?: string;
  videoTaskId?: string;
}

export interface SequenceTaskState {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  shots: ShotTaskState[];
}

// 可序列化、可落盘的编排状态。刷新后据此恢复在途任务。
export interface PipelineState {
  stage: StageName;
  storyPlan?: StoryPlan;
  sequences: SequenceTaskState[];
  pausedAt?: StageName; // 逐阶段暂停开关命中时停在哪个阶段
  error?: string;
}

// 参与编剧阶段的角色/物件输入（从 UI 状态规约而来）
export type WriterCharacter = Pick<Character, 'name' | 'description' | 'voiceId'>;
export type WriterObject = Pick<ObjectItem, 'name' | 'description'>;
