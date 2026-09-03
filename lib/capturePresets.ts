import type { CapturePreset, Storyboard } from '@/types';

export const DEFAULT_CAPTURE_PRESET: CapturePreset = 'cinematic-narrative';

export interface CapturePresetDefinition {
  value: CapturePreset;
  label: string;
  description: string;
  director: string;
  image: string;
  grid: string;
  video: string;
}

export const CAPTURE_PRESETS: CapturePresetDefinition[] = [
  {
    value: 'cinematic-narrative',
    label: '电影叙事',
    description: '动机明确的电影机位与克制表演',
    director: '按剧情因果选择机位与人物调度。摄影机可以预先占位、与人物同步运动或延后揭示，不必像纪实抓拍一样慢半拍。一次运动或移焦改变观众看见的信息、人物距离或空间关系；固定镜头用画内调度完成变化。人物反应遵循剧情触发，不为镜头摆姿势。',
    image: 'Feature-film narrative capture of one physically possible instant inside a causal action. The subject is occupied by the scene rather than presenting to camera; posture, gaze, hand contact and weight reveal the current action phase. Use a motivated camera position, coherent optical depth and no publicity-photo pose.',
    grid: 'Motivated feature-film coverage; each panel selects one physical instant from a causal action, never a whole sequence; occupied subject, restrained unposed performance.',
    video: 'Planned narrative coverage: execute the authored camera path or focus transfer in coordination with the blocking. A locked-off shot stays locked. Keep screen direction and spatial continuity; reactions follow their scripted cause.',
  },
  {
    value: 'broadcast-candid',
    label: '电视直播抓拍',
    description: '长焦直播观察、非摆拍、杂乱遮挡与真实成像',
    director: '电视直播长焦抓拍式观察。人物在镜头介入前已经专注于自己的事情，不为镜头展示；动作按“原本在做事→触发→眼球先移动、头部晚半拍→短暂局促或调整→视线移开→回到原任务”组织，只选与剧情相符的节点。摄影机不能预知动作，人物动后才小幅修正构图或恢复焦点；允许停顿、动作未完成、前景行人或物体遮挡、偏构图和轻微切边。',
    image: 'Authentic live-television candid capture: long-lens observation of one unguarded instant. The subject is already absorbed in an ordinary task, unaware of the camera, with loose asymmetrical posture, attention outside the lens and a gesture caught slightly incomplete. Use real foreground occlusion, off-center framing, occasional edge crop, truthful skin, plausible motion blur, restrained broadcast compression and long-lens softness. No influencer pose, presentation, beauty retouching or publicity staging.',
    grid: 'Live-TV candid coverage: one unguarded phase per panel—task underway, small interruption, delayed glance or incomplete return. The subject never presents. Remote long-lens view, foreground occlusion, off-center framing, slight edge crop, plausible motion blur, occasional focus recovery and restrained broadcast compression/texture. No influencer pose.',
    video: 'Authentic live television candid footage. The subject is already occupied, unaware and never performs for the lens. Use a sparse chain: task, authored trigger, eyes before head, delayed response, incomplete adjustment, attention returns; include brief low-activity intervals. Use a long-lens observational viewpoint. The remote camera never anticipates action and reacts a beat late with one small reframe or focus recovery. Keep foreground pedestrians or street objects briefly occluding the frame. Keep off-center framing, occasional edge crop, truthful skin and restrained broadcast texture. No influencer or publicity performance.',
  },
  {
    value: 'documentary-follow',
    label: '观察纪录',
    description: '手持跟随、现场光和真实反应',
    director: '观察式纪录跟拍。人物先行动，摄影机后跟随；用现场光和可解释的手持修正记录触发、反应与恢复。允许动作停顿或做到一半，不要求人物看镜头，不把真实行动整理成完整表演。',
    image: 'Observational documentary capture of one honest action phase already underway. Available light, purposeful handheld proximity, an occupied subject, naturally imperfect posture and framing, truthful skin and materials, and no staged hero pose.',
    grid: 'Observational documentary: one causal action phase per panel, occupied subject, delayed reaction, available light, human handheld position and imperfect framing; no posed coverage.',
    video: 'The subject begins engaged in the task. A trigger produces a delayed response, one incomplete adjustment and a return of attention, with brief low-activity intervals. The operator follows after movement begins with small human corrections, available light and occasional focus recovery; no posing or lens address.',
  },
  {
    value: 'phone-bystander',
    label: '路人手机',
    description: '手机随手拍、自动曝光与偶发遮挡',
    director: '路人手机随手记录。人物原本就在做事，手机只在动作发生后被动跟上；允许构图慢半拍、轻微晃动、自动曝光和对焦恢复，以及短暂无事发生的时刻，不进行专业调度或摆拍。',
    image: 'Plausible bystander phone capture of one spontaneous instant while the subject remains occupied by real activity. Use small-sensor depth, automatic exposure and white balance, casual imperfect framing, mild motion blur and no professional light or staged pose.',
    grid: 'Bystander phone: one spontaneous action phase per panel, never a completed pose; occupied subject, imperfect framing, auto-exposure response and mild motion blur.',
    video: 'The subject is already engaged and does not present to the phone. Use a sparse trigger-response-return chain with pauses and an unfinished gesture. The phone reacts after movement starts with a late reframe, autofocus or exposure recovery and imperfect composition. No professional choreography or posing.',
  },
  {
    value: 'news-telephoto',
    label: '新闻长焦',
    description: '远距离新闻机位、压缩空间与前景遮挡',
    director: '远距离新闻长焦观察。人物按自己的行动线活动，受限机位只能在动作发生后做克制的摇摄修正；空间压缩明显，允许人群和街道设施遮挡、短暂跟丢与重新找到主体。',
    image: 'Distant news telephoto capture with compressed perspective, restricted camera access, foreground crowd occlusion, practical available light, and restrained broadcast texture.',
    grid: 'Distant news-telephoto coverage with compressed perspective, restricted sightlines, foreground occlusion, and practical available light.',
    video: 'The distant camera observes an already unfolding event from restricted access. It does not anticipate the subject: movement begins first, then one restrained late pan or focus correction follows. Preserve compressed perspective, foreground crowd occlusion, practical available light and brief imperfect tracking rather than hero coverage.',
  },
  {
    value: 'home-video',
    label: '家庭录像',
    description: '亲近随拍、自动对焦与生活化构图',
    director: '家庭录像式近距离随拍。人物继续自己的日常互动，不向镜头完成标准动作；构图亲近但不精确，拍摄者在动作发生后才跟随，保留停顿、笑意消退、动作未完成以及自动对焦和曝光修正。',
    image: 'Intimate home-video still with casual framing, consumer-camera optics, automatic focus/exposure behavior, and warm unperformed interaction.',
    grid: 'Casual home-video coverage with intimate distance, consumer optics, imperfect framing, and warm spontaneous interaction.',
    video: 'The subject is already inside an ordinary domestic interaction. Preserve pauses, incomplete gestures and reactions that fade rather than resolve into a pose. The familiar camera holder follows a beat late with casual handheld framing and consumer autofocus/exposure recovery. No commercial staging or presentation.',
  },
  {
    value: 'surveillance',
    label: '监控机位',
    description: '固定高位广角、冷静远观和有限画质',
    director: '固定监控机位。高位广角不跟随、不纠正、不预判；人物按真实路径进入、停顿、改变方向和离开画面，不为镜头表演。',
    image: 'Fixed high-angle surveillance view with wide spatial coverage, restricted image quality, practical flat exposure, and subjects moving naturally through the frame without posing.',
    grid: 'Fixed surveillance viewpoints with high-angle wide coverage, readable routes, limited image quality, and no performed camera awareness.',
    video: 'The fixed high-angle surveillance camera never follows, reframes, focuses or anticipates. Subjects enter, pause, change direction, cross and leave according to the authored physical route without camera awareness. Keep wide spatial coverage, practical flat exposure and limited image quality; no cinematic move or performed pose.',
  },
  {
    value: 'commercial-studio',
    label: '棚拍广告',
    description: '精准灯光、受控构图和产品清晰度',
    director: '受控广告拍摄。人物与产品位置明确，灯光和构图精准，动作简洁可读。',
    image: 'Controlled premium commercial capture with precise subject and product placement, shaped studio light, clean focal hierarchy, exact material response, and polished but believable skin.',
    grid: 'Controlled commercial coverage with exact product visibility, clean focal hierarchy, precise light, and readable gestures.',
    video: 'Controlled premium commercial camera with precise subject and product placement, shaped light, clean focal hierarchy, and concise readable gestures.',
  },
  {
    value: 'follow-reference',
    label: '跟随参考',
    description: '从参考图继承拍摄方式与画面缺陷',
    director: '从参考图继承机位、构图、镜头距离和成像特征，不额外套用另一套拍摄方式。',
    image: 'Infer one coherent capture method from the supplied visual reference, including camera distance, viewpoint, framing, focus behavior and medium-justified imperfections. Do not add a second capture style.',
    grid: 'Inherit the reference capture method consistently while varying only the shot coverage required by each panel.',
    video: 'Continue the supplied reference capture method: preserve its camera distance, viewpoint, framing behavior, focus response, and justified image texture without adding a second camera style.',
  },
];

export function normalizeCapturePreset(value?: CapturePreset | string): CapturePreset {
  return CAPTURE_PRESETS.some((preset) => preset.value === value)
    ? value as CapturePreset
    : DEFAULT_CAPTURE_PRESET;
}

export function getCapturePreset(value?: CapturePreset | string): CapturePresetDefinition {
  const normalized = normalizeCapturePreset(value);
  return CAPTURE_PRESETS.find((preset) => preset.value === normalized) || CAPTURE_PRESETS[0];
}

export function isObservationalCapturePreset(value?: CapturePreset | string): boolean {
  return ['broadcast-candid', 'documentary-follow', 'phone-bystander', 'news-telephoto', 'home-video', 'surveillance']
    .includes(normalizeCapturePreset(value));
}

export function buildDirectorCaptureContract(value?: CapturePreset | string): string {
  return `拍摄方式（全片强制继承）：${getCapturePreset(value).director}`;
}

export function buildImageCapturePresetContract(value?: CapturePreset | string): string {
  return `CAPTURE MODE (authoritative): ${getCapturePreset(value).image}`;
}

export function buildGridCapturePresetContract(value?: CapturePreset | string): string {
  return `CAPTURE MODE FOR EVERY PANEL (authoritative): ${getCapturePreset(value).grid}`;
}

export function buildVideoCapturePresetContract(value?: CapturePreset | string): string {
  return `CAPTURE MODE: ${getCapturePreset(value).video}`;
}

export function applyCapturePreset(storyboard: Storyboard, value?: CapturePreset | string): Storyboard {
  const capturePreset = normalizeCapturePreset(value);
  return {
    ...storyboard,
    capturePreset,
    imageUrl: undefined,
    gridSourceUrl: undefined,
    imageTaskMode: undefined,
    imageGridSize: undefined,
    imagePromptOverride: undefined,
    imageFailureReason: undefined,
    imageRetryCount: undefined,
    taskId: undefined,
    status: 'pending',
    videoUrl: undefined,
    videoSourceUrl: undefined,
    videoCacheKey: undefined,
    videoCacheStatus: undefined,
    videoCachedAt: undefined,
    videoGenerationSignature: undefined,
    videoStatus: 'pending',
    videoTaskId: undefined,
    videoPrompt: undefined,
    videoPromptOverride: undefined,
  };
}
