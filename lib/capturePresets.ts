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
    director: '按剧情因果选择景别与机位；构图有意图，表演自然克制，不摆拍。',
    image: 'Feature-film narrative capture: motivated camera position, intentional composition, natural restrained performance, coherent optical depth, and no posed publicity-photo staging.',
    grid: 'Motivated feature-film coverage; each panel changes camera position or shot size for a clear dramatic reason, with natural unposed performance.',
    video: 'Motivated natural framing.',
  },
  {
    value: 'broadcast-candid',
    label: '电视直播抓拍',
    description: '长焦直播观察、非摆拍、杂乱遮挡与真实成像',
    director: '电视直播长焦抓拍。人物没有为镜头摆姿势，体态松弛且可侧对镜头；允许前景行人或物体遮挡、人物偏离中心、轻微切边，并安排一个短暂自然反应。',
    image: 'Authentic live-television candid capture, unstaged and apparently unnoticed by the subject. Long-lens observational viewpoint; relaxed imperfect posture, often side-on; fleeting unperformed expression; foreground crowd or street-object occlusion; off-center untidy framing and an occasional slight edge crop. Preserve visible pores, uneven skin texture and minor redness. Use plausible motion blur, restrained broadcast compression noise, subtle interlaced broadcast texture, and long-lens softness. No influencer pose, beauty retouching, fashion-editorial polish, perfect symmetry, or clean studio staging.',
    grid: 'Live-TV candid coverage: unstaged long-lens observation, relaxed imperfect posture, foreground pedestrian/object occlusion, off-center untidy framing, occasional slight edge crop, plausible motion blur, restrained broadcast compression/interlaced texture, and truthful unretouched skin. No influencer or fashion pose.',
    video: 'Authentic live television candid footage. The subject is shopping naturally and does not pose for the camera. Use a long-lens observational viewpoint, relaxed imperfect posture, side-on moments, foreground pedestrians or street objects briefly occluding the frame, off-center untidy composition, and an occasional slight edge crop. Preserve truthful unretouched skin, plausible motion blur, restrained broadcast compression noise, subtle interlaced texture, and long-lens softness. No influencer performance, beauty-commercial polish, fashion posing, or direct presentation to camera.',
  },
  {
    value: 'documentary-follow',
    label: '观察纪录',
    description: '手持跟随、现场光和真实反应',
    director: '观察式纪录片跟拍。用现场光和可解释的手持修正观察真实行动，不要求人物看镜头。',
    image: 'Observational documentary capture with available light, purposeful handheld proximity, naturally imperfect framing, truthful skin and materials, and no staged hero pose.',
    grid: 'Observational documentary coverage with available light, purposeful handheld viewpoints, honest reactions, and naturally imperfect framing.',
    video: 'Observational documentary follow camera with available light and small human-operated corrections. Capture honest action and reactions without directing the subject to pose or address the lens.',
  },
  {
    value: 'phone-bystander',
    label: '路人手机',
    description: '手机随手拍、自动曝光与偶发遮挡',
    director: '路人手机随手拍。竖直或横向手持由项目画幅决定，允许轻微晃动、自动曝光和对焦恢复。',
    image: 'Plausible bystander phone capture with small-sensor depth, automatic exposure and white balance, casual imperfect framing, mild motion blur, and no professional lighting or staged pose.',
    grid: 'Casual bystander-phone coverage with imperfect framing, auto-exposure behavior, mild motion blur, and spontaneous action.',
    video: 'Bystander phone footage with natural hand movement, small autofocus and exposure recovery, casual imperfect framing, and spontaneous behavior. No professional camera choreography or posing.',
  },
  {
    value: 'news-telephoto',
    label: '新闻长焦',
    description: '远距离新闻机位、压缩空间与前景遮挡',
    director: '远距离新闻长焦观察。空间压缩明显，机位受限，允许人群与街道设施遮挡。',
    image: 'Distant news telephoto capture with compressed perspective, restricted camera access, foreground crowd occlusion, practical available light, and restrained broadcast texture.',
    grid: 'Distant news-telephoto coverage with compressed perspective, restricted sightlines, foreground occlusion, and practical available light.',
    video: 'Distant news telephoto footage with compressed perspective, restricted camera access, foreground crowd occlusion, restrained pan corrections, and practical available light.',
  },
  {
    value: 'home-video',
    label: '家庭录像',
    description: '亲近随拍、自动对焦与生活化构图',
    director: '家庭录像式近距离随拍。构图亲近但不精确，保留自动对焦和曝光的小幅修正。',
    image: 'Intimate home-video still with casual framing, consumer-camera optics, automatic focus/exposure behavior, and warm unperformed interaction.',
    grid: 'Casual home-video coverage with intimate distance, consumer optics, imperfect framing, and warm spontaneous interaction.',
    video: 'Intimate home-video capture with casual handheld framing, consumer autofocus/exposure recovery, and warm spontaneous interaction. No commercial staging.',
  },
  {
    value: 'surveillance',
    label: '监控机位',
    description: '固定高位广角、冷静远观和有限画质',
    director: '固定监控机位。高位广角远观，人物按真实路径进入和离开画面，不为镜头表演。',
    image: 'Fixed high-angle surveillance view with wide spatial coverage, restricted image quality, practical flat exposure, and subjects moving naturally through the frame without posing.',
    grid: 'Fixed surveillance viewpoints with high-angle wide coverage, readable routes, limited image quality, and no performed camera awareness.',
    video: 'Fixed high-angle surveillance camera with wide spatial coverage and limited image quality. Subjects enter, cross, and leave naturally without camera awareness; no cinematic camera move.',
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
