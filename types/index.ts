// 角色类型
export type VoiceGender = 'female' | 'male' | 'nonbinary' | 'unknown';
export type VoiceAgeGroup = 'child' | 'young_adult' | 'adult' | 'senior' | 'unknown';

export interface ProjectProductionTiming {
  startedAt: string;
  status: 'running' | 'paused' | 'completed';
  pausedAt?: string;
  pausedDurationMs: number;
  completedAt?: string;
  elapsedMs?: number;
}

export interface Character {
  id: string;
  name: string;
  description: string; // 角色外观描述
  imageUrl: string;
  imageBase64?: string; // base64 格式的图片，用于 API 调用
  imageFile?: File;
  voiceId?: string; // fish.audio reference_id
  voiceProfile?: string; // 角色音色画像；自动选角时用于复现同一声音
  voiceSource?: 'user' | 'auto';
  gender?: VoiceGender; // 声音选角使用；未知时不得擅自按女性处理
  ageGroup?: VoiceAgeGroup;
}

// 物体类型
export interface ObjectItem {
  id: string;
  name: string;
  description: string; // 物体详细描述,包括细节、文字等
  imageUrl: string;
  imageBase64?: string; // base64 格式的图片，用于 API 调用
  imageFile?: File;
}

export type StoryClipType = 'insert' | 'reaction' | 'establishing' | 'action' | 'dialogue' | 'performance' | 'montage' | 'long_take';

export interface StoryDialogueTurn {
  speaker: string;
  function: string;
  contentGoal: string; // 本轮必须让观众听懂的新事实、立场或选择
  respondsTo: string;
  exactLine?: string; // 全片台词稿锁定的逐字台词；详细剧本/分镜/H3 只能调度，不能缩写
  meaningEvidence?: string; // exactLine 中真正交付 contentGoal 的原文片段
  subtext?: string; // 角色表面说法背后的策略或隐含欲望，不得被朗读
  listenerResult?: string; // 台词落下后听者可见的认知、关系或决定变化
}

export interface StorySpeechLine {
  speakerId: string; // 全片稳定的说话者编号，不随视频片段重新编号
  character: string;
  voiceId?: string; // 与角色绑定的参考音色；没有则不得借用其他角色音色
  exactLine: string; // 唯一权威台词，视频提示词不得改写或补写
  emotion: string;
  delivery: string;
  volume: 'whisper' | 'soft' | 'normal' | 'raised';
  lipSync: boolean;
  listenerState?: string;
  storyFunction?: string; // question/reveal/refusal/decision/callback 等；保证台词承担叙事任务
  respondsTo?: string; // 与前一句或前一镜信息的关系，避免孤立短句
  contentGoal?: string; // 来自故事骨架的语义合同；逐字台词必须完整交付它
  source: 'user_exact' | 'story_required';
  sourceStoryboardId?: string; // 片段级台词的画面起点；逐字台词本身不再归属于该分镜
}

export interface StoryAudioPlan {
  backgroundHuman: 'none' | 'indistinct_nonverbal';
  environment: string[];
  foley: string[];
  music: string; // 默认 none；只有用户或剧本明确要求才填写
  silenceBefore: number;
  silenceAfter: number;
}

export interface NarrativeState {
  characters?: string;
  objects?: string;
  environment?: string;
  relationships?: string;
  emotion?: string;
}

// Actor-facing direction for one visible character in one shot. These cues
// stay separate from dialogue so video prompts never accidentally vocalize
// stage directions.
export interface StoryPerformanceCue {
  character: string;
  objective: string;
  blocking: string;
  gesture: string;
  expression: string;
  gaze: string;
  breath: string;
  reaction: string;
  subtext: string;
}

// 分镜类型
export interface Storyboard {
  id: string;
  sceneNumber: number;
  action?: string; // 编剧阶段锁定的权威可见动作；H3 必须逐镜按时间表执行
  performance?: StoryPerformanceCue[]; // 每个出场角色的动作、微表情、视线、呼吸和反应调度
  description: string;
  prompt: string;
  characters: string[]; // 角色名称列表
  objects?: string[]; // 物体名称列表
  imageUrl?: string;
  gridSourceUrl?: string; // 高分辨率九宫格母图；用于恢复或重新拆分
  status: 'pending' | 'generating' | 'completed' | 'failed';
  taskId?: string; // APIMart 任务 ID
  imageTaskMode?: 'grid' | 'single'; // 断点恢复时区分九宫格母图与单张补图任务
  imagePromptOverride?: string; // 内容安全自动修订后的生图专用提示词，不改写原始分镜
  imageFailureReason?: string; // 最近一次生图失败或自动修订原因
  imageRetryCount?: number; // 内容安全自动重试次数
  videoUrl?: string; // 视频 URL
  videoSourceUrl?: string; // 云端原始 URL；本地缓存丢失时用于恢复
  videoCacheKey?: string; // IndexedDB 中的持久化视频键
  videoCacheStatus?: 'caching' | 'completed' | 'failed';
  videoCachedAt?: string;
  videoSegmentId?: string; // 多个连续分镜共用一个生成片段
  videoSegmentStoryboardIds?: string[]; // 仅片段首分镜保存完整成员列表
  videoGenerationSignature?: string; // 生成时的分镜/图片/台词指纹；防止内容修改后误用旧缓存
  videoStatus?: 'pending' | 'generating' | 'completed' | 'failed'; // 视频生成状态
  videoTaskId?: string; // 视频任务 ID
  videoProviderUsed?: 'apimart' | 'comfyui' | 'fal';
  videoSeed?: number; // fal 项目固定 seed；只用于复现，不代表声纹锁
  aspectRatio?: '16:9' | '9:16' | '1:1'; // 宽高比
  audioUrl?: string; // 生成的音频 URL (legacy single)
  audioDuration?: number; // exact full-segment dialogue track duration
  audioTrackVersion?: string; // full-duration exact-dialogue timeline contract
  characterAudios?: { character: string; audioUrl: string; audioDuration?: number }[]; // per-character exact-dialogue references
  audioSpeechSignature?: string; // exact dialogue revision represented by characterAudios
  audioStatus?: 'generating' | 'completed' | 'failed';
  dialogue?: Record<string, string>; // { 角色名: 台词 } - legacy
  dialogueLines?: { character: string; text: string }[]; // ordered dialogue lines
  speech?: StorySpeechLine[]; // 新版唯一台词契约；dialogueLines 仅作旧项目/UI 兼容
  audioPlan?: StoryAudioPlan;
  clipType?: StoryClipType;
  shotSize?: string; // 编剧阶段锁定的景别；供 H3 官方时间线提示词使用
  cameraMove?: string; // 编剧阶段锁定的运镜；供 H3 写成“类型 + 幅度 + 速度”
  angle?: string; // 编剧阶段锁定的机位
  dramaticPurpose?: string;
  cause?: string;
  conflict?: string;
  choice?: string;
  consequence?: string;
  characterChange?: string;
  nextCause?: string;
  informationGain?: string; // 本镜结束后观众新理解了什么
  dialoguePurpose?: string; // 本镜对白在全片中的功能；无对白时为 visual_only
  dialogueUnitId?: string; // 跨镜问题/回答/承诺/回收所属的连续对白单元
  dialogueObligation?: 'required' | 'optional' | 'visual';
  dialogueContext?: string; // 台词前提与说后必须改变的关系/认知
  dialogueTurns?: StoryDialogueTurn[]; // 骨架阶段锁定的逐轮语义任务，不能在导演/视频阶段丢失
  montageRole?: string; // setup/development/contrast/decision/payoff/bridge 等剪辑语义
  editBridge?: string; // 本镜可见/可听结果如何被下一镜接住，以及并置后观众应推断出的新意义
  audienceQuestion?: string; // 此刻维持或回答的观众问题
  stateBefore?: NarrativeState;
  stateAfter?: NarrativeState;
  videoPrompt?: string; // 视频生成提示词
  videoPromptOverride?: boolean; // 用户或模块化引擎明确生成/编辑的最终提示词
  videoDuration?: number; // 视频时长（秒）；ComfyUI H3 为 2-15，其他模型按各自限制
  continuousFromPrev?: boolean; // 是否与上一个镜头连贯（使用上一镜头尾帧=本镜头首帧）
  videoStartMode?: 'storyboard' | 'previous-segment-tail'; // 默认当前分镜；尾帧接续必须在片段面板明确选择
  sequenceId?: string; // 所属场/段落（导演阶段产出，用于共享场景参考与连续性）
  durationHint?: number; // 内容推导的建议时长（秒），作为 videoDuration 的默认取值来源
  transition?: 'cut' | 'dissolve' | 'fade' | 'wipe'; // 转场
  continuityFrom?: string; // 显式记录接哪个镜头的尾帧（storyboard.id），替代 continuousFromPrev 布尔
  // 定妆/场景参考图
  characterCostume?: Record<string, string>; // { 角色名: 造型描述 }
  sceneStyle?: string;                       // 场景风格描述
  locationId?: string;                       // 地点标识，同一地点的镜头共享场景参考图
  sceneImageOverride?: string;               // per-shot scene reference (dragged from global)
  visualStyle?: VisualStyle;                 // 项目级制作风格快照
  capturePreset?: CapturePreset;             // 项目级拍摄方式快照（构图/机位/成像瑕疵/表演观察方式）
  costumeStatus?: 'pending' | 'generating' | 'completed'; // 定妆图生成状态
  // costumeImages and sceneImage are now global, stored in page state
}

// 故事类型
export interface Story {
  title: string;
  content: string;
  storyboards: Storyboard[];
}

// APIMart API 响应类型
export interface ApiMartChatResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  data?: {
    choices?: Array<{
      message?: { content?: string };
    }>;
  };
}

export interface ApiMartImageTaskResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface ApiMartImageStatusResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  message?: string;
  result?: {
    images: Array<{
      url: string;
    }>;
  };
}

// 视频生成响应类型
export interface ApiMartVideoTaskResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface ApiMartVideoStatusResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: {
    videos: Array<{
      url: string;
    }>;
  };
}

// 全局视觉风格锁：把「角色参考图的媒介」钉死到所有生成环节
export type VisualStyle =
  | 'follow-reference'
  | 'cinematic-natural'
  | 'warm-film'
  | 'neo-noir'
  | 'documentary'
  | 'commercial'
  | 'live-action' // legacy value, migrated to cinematic-natural at project load
  | '3d-cg'
  | 'anime'
  | 'illustration'
  | 'stop-motion';

// 项目级拍摄方式。它不改变角色或美术媒介，只约束镜头如何观察、构图与成像。
export type CapturePreset =
  | 'cinematic-narrative'
  | 'broadcast-candid'
  | 'documentary-follow'
  | 'phone-bystander'
  | 'news-telephoto'
  | 'home-video'
  | 'surveillance'
  | 'commercial-studio'
  | 'follow-reference';

// 应用设置类型
export interface AppSettings {
  apiProvider: 'apimart' | 'openai' | 'anthropic'; // API 提供商
  apiKey: string; // API Key
  scriptProvider?: 'auto' | 'dmx' | 'apimart'; // 剧本生成通道
  scriptModel: string; // 脚本生成模型
  imageModel: string; // 图片生成模型
  midjourneyProfileEnabled?: boolean; // 是否启用 Midjourney 个性化 Profile
  midjourneyProfile?: string; // Midjourney 个性化 Profile 代码
  videoModel: string; // 视频生成模型
  videoProvider?: 'apimart' | 'comfyui' | 'fal'; // 视频生成通道
  fal?: {
    apiKey?: string;
    resolution?: '480P' | '768P';
    promptExpansionMode?: 'disabled' | 'balanced' | 'quality';
    seed?: number;
  };
  comfyui?: {
    sshHost: string;
    sshPort: number;
    sshUser: string;
    sshKeyPath: string;
    useLocalCompanion?: boolean;
    localCompanionUrl?: string;
    comfyPort: number;
    workflowRoot: string;
    imageWorkflowPath: string;
    multiImageWorkflowPath: string;
    firstLastWorkflowPath: string;
    h3Fl2vaProfile?: 'balanced8' | 'dasiwa4' | 'legacy';
    characterReplaceWorkflowPath?: string;
    timeoutSeconds: number;
  };
  aspectRatio: '16:9' | '9:16' | '1:1'; // 横屏或竖屏
  fishAudioKey?: string; // fish.audio API key
  dmxApiKey?: string; // dmxapi.cn API key for script generation
  language?: 'zh' | 'en'; // output language for dialogue and descriptions
  visualStyle?: VisualStyle; // 全局视觉风格锁（默认跟随角色参考图）
}
