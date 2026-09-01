import type { ImageGenerationAspectRatio } from './imageModels';
import type { CapturePreset, VisualStyle } from '@/types';

export const MIDJOURNEY_IMAGE_MODEL = 'midjourney';
export const MIDJOURNEY_TASK_PREFIX = 'midjourney:';
export const DEFAULT_MIDJOURNEY_PERSONALIZATION_PROFILE = 'votj2t8';

export type MidjourneyReferenceMode = 'image' | 'character' | 'style';
export type MidjourneyTaskMode = 'single' | 'story-shot' | 'grid' | 'character-sheet';

export interface MidjourneyReferenceOptions {
  version?: '6.1' | '7' | '8.2';
  /** One identity, not an array of independently bound actors. */
  characterReferenceUrl?: string;
  characterWeight?: number;
  omniWeight?: number;
  styleReferenceUrl?: string;
  styleWeight?: number;
}

export type MidjourneyStyleReference = Pick<MidjourneyReferenceOptions, 'styleReferenceUrl' | 'styleWeight'>;

export function resolveMidjourneyStyleSetting(settings: {
  midjourneyStyleReferenceUrl?: string;
  midjourneyStyleWeight?: number;
}): MidjourneyStyleReference {
  return settings.midjourneyStyleReferenceUrl?.trim()
    ? { styleReferenceUrl: settings.midjourneyStyleReferenceUrl.trim(), styleWeight: settings.midjourneyStyleWeight ?? 100 }
    : {};
}

function referenceUrl(value: string | undefined, label: string): string {
  if (!value) return '';
  const url = value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`${label}需要可公开访问的 HTTP(S) 图片地址`);
  return url;
}

function referenceWeight(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const weight = value ?? fallback;
  if (!Number.isInteger(weight) || weight < min || weight > max) throw new Error(`${label}须为 ${min}–${max} 的整数`);
  return weight;
}

export interface MidjourneyPromptOptions {
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
  taskMode?: MidjourneyTaskMode;
  hasPeople?: boolean;
  hasStyleReference?: boolean;
}

const CAPTURE_DIRECTIONS: Record<CapturePreset, string> = {
  'cinematic-narrative': 'one physically possible instant inside a causal action, the subject occupied by the scene rather than presenting to camera, motivated feature-film framing and natural unposed performance',
  'broadcast-candid': 'authentic live-television candid long-lens observation of one unguarded instant, the subject already absorbed in an ordinary task and unaware of camera, loose asymmetric side-on posture, attention outside lens, slightly incomplete gesture, foreground pedestrian or street-object occlusion, off-center untidy framing, slight edge crop, plausible motion blur, restrained broadcast compression and subtle interlaced texture, no influencer pose or beauty retouching',
  'documentary-follow': 'one honest action phase already underway, occupied subject, observational documentary camera, available light, purposeful handheld proximity, naturally imperfect framing and unperformed reaction',
  'phone-bystander': 'one spontaneous action phase rather than completed pose, occupied subject not presenting to phone, casual bystander capture, imperfect handheld framing, automatic exposure and focus recovery and mild motion blur',
  'news-telephoto': 'distant news telephoto observation, compressed perspective, restricted sightline, foreground crowd occlusion and practical available light',
  'home-video': 'intimate casual home-video framing, consumer optics, automatic focus and exposure behavior and spontaneous interaction',
  surveillance: 'fixed high-angle surveillance viewpoint, wide spatial coverage, limited image quality and no camera-aware performance',
  'commercial-studio': 'controlled premium commercial camera, exact placement, shaped light and clean focal hierarchy',
  'follow-reference': 'inherit the reference camera distance, viewpoint, framing behavior and justified image texture',
};

const ENVIRONMENT_CAPTURE_DIRECTIONS: Record<CapturePreset, string> = {
  'cinematic-narrative': 'readable foreground, middle ground and background, motivated light sources',
  'broadcast-candid': 'live-television long-lens observation, off-center framing, restrained broadcast compression',
  'documentary-follow': 'observational documentary camera, available light, naturally imperfect handheld framing',
  'phone-bystander': 'casual phone capture, imperfect handheld framing, automatic exposure and focus',
  'news-telephoto': 'distant news telephoto observation, compressed perspective, restricted sightline',
  'home-video': 'casual home-video framing, consumer optics, automatic focus and exposure',
  surveillance: 'fixed high-angle surveillance viewpoint, wide spatial coverage, limited image quality',
  'commercial-studio': CAPTURE_DIRECTIONS['commercial-studio'],
  'follow-reference': CAPTURE_DIRECTIONS['follow-reference'],
};

export function normalizeMidjourneyProfileCode(value: unknown): string {
  const code = String(value || '').trim().replace(/^--(?:profile|p)\s+/i, '').trim();
  return /^[a-z0-9_-]{1,64}$/i.test(code) ? code : '';
}

export function resolveMidjourneyProfileSetting(settings: {
  midjourneyProfileEnabled?: boolean;
  midjourneyProfile?: string;
}): string {
  if (settings.midjourneyProfileEnabled !== true) return '';
  return normalizeMidjourneyProfileCode(
    settings.midjourneyProfile || DEFAULT_MIDJOURNEY_PERSONALIZATION_PROFILE,
  );
}

const STYLE_DIRECTIONS: Partial<Record<VisualStyle, string>> = {
  'follow-reference': 'match the reference medium, palette, contrast, lighting and texture without mixing in a second visual style',
  'cinematic-natural': 'a frame photographed for a high-budget live-action feature on a physical location or built set, physically present subjects with practical makeup and physically made costumes where specified, preserve each described species and anatomy, individual facial asymmetry and natural skin or species-appropriate surface variation, truthful wet hair skin fabric and scales, physically believable water weight contact shadows and atmospheric depth, natural cinema exposure and white balance, restrained color, gentle highlight roll-off and real optical focus falloff',
  'warm-film': 'warm photochemical 35mm cinema, creamy but textured skin, amber practical light, fine irregular grain, organic spherical-prime focus falloff, restrained halation only around bright sources, honey highlights and textured lifted shadows',
  'neo-noir': 'grounded neo-noir live action, cool cyan-black separation, sparse warm practicals, one hard motivated edge light, strong negative fill, dense textured shadows, wet controlled reflections, deliberate foreground obstruction and restrained grain',
  documentary: 'unstaged observational documentary photography, available location light, authentic skin and clothing wear, ordinary contrast, finite exposure, mild sensor texture, real contact shadows and imperfect but purposeful framing',
  commercial: 'premium live-action commercial photography, shaped key and controlled fill, precise specular placement, crisp focal hierarchy, exact glass metal liquid fabric and skin response, clean color separation and polished but physically real contrast',
  anime: 'cinematic authored 2D anime, stable character-model linework, deliberate line-weight hierarchy, graphic key-light shapes, controlled cel-shadow groups, painterly background depth and a locked color script',
  '3d-cg': 'feature-quality cinematic 3D, stable topology and grooming, physically based skin cloth metal and environment materials, unified global illumination, motivated key light, contact shadows, restrained volumetric depth and a physical virtual-camera perspective',
  'stop-motion': 'photographed handmade stop-motion miniature, tactile clay fabric paper and paint, visible seams and tiny construction variation, practical tabletop lighting, hard miniature contact shadows, macro-lens depth and subtle frame texture',
};

function cleanText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)]/g, '$1')
    .trim();
}

function section(source: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)${escaped}:\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Z /—_-]{2,}:|$)`, 'i'));
  return match?.[1]?.trim() || '';
}

function compactCharacterPrompt(source: string): string {
  const firstLine = source.split('\n').find(line => line.trim())?.trim() || 'Cinematic character portrait';
  const fields = source
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^(?:Character description|Locked wardrobe and grooming|Role \/ identity|Approximate age|Personality keywords|Core theme|Name|Role \/ identity|Appearance|Wardrobe and grooming direction):/i.test(line))
    .filter(line => !/:\s*(?:not specified\b|\.?$)/i.test(line));
  const isConcept = /character concept contact sheet/i.test(firstLine);
  return [
    firstLine.replace(/high-precision\s*/i, '').replace(/\/ production identity bible/i, ''),
    ...fields,
    isConcept
      ? 'each candidate fully visible in its own cell, explore distinct designs within the supplied brief'
      : 'same identity in full-body front, three-quarter, side and back views, plus a face detail; preserve described anatomy, hairstyle and wardrobe in every view',
  ].join(', ');
}

function isCharacterBrief(source: string): boolean {
  const firstLine = source.split('\n').find(line => line.trim())?.trim() || '';
  // Match a requested output, never "not a character sheet" in scene prose.
  return /^(?:(?:create|generate|render)\s+)?(?:(?:a|an|one|square|horizontal|vertical|high-precision|\d+:\d+)\s+)*(?:character sheet|character concept contact sheet|production identity bible)\b/i.test(firstLine);
}

/**
 * Midjourney responds best to a concise description of the finished image.
 * This compiler deliberately discards GPT-Image style contracts, explanations,
 * reference bookkeeping and repeated negative instructions.
 */
function inferTaskMode(source: string): MidjourneyTaskMode {
  if (/^UNIQUE STORYBOARD BATCH:|^(?:create\s+)?(?:a\s+|one\s+)?3x3 storyboard contact sheet/im.test(source)) return 'grid';
  if (isCharacterBrief(source)) return 'character-sheet';
  return 'single';
}

function inferPeople(source: string): boolean {
  return /\b(?:person|people|man|woman|boy|girl|doctor|researcher|character|actor|model|portrait|face|skin|subject\s+\d+)\b|人物|男人|女人|男孩|女孩|医生|博士|角色|肖像|面部|皮肤/i.test(source);
}

function referencedObjectDirection(source: string): string {
  const hasObjectReference = /OBJECT IDENTITY(?: ONLY)?\s*[:—-]|Object requirement\s*:/i.test(source);
  if (!hasObjectReference) return '';
  const names = [...source.matchAll(/(?:OBJECT IDENTITY(?: ONLY)?\s*[:—-]\s*|Object requirement:\s*["“]?)([^\n;"”—-]{1,60})/gi)]
    .map(match => match[1].trim())
    .filter(Boolean)
    .slice(0, 4);
  const subject = names.length ? `referenced ${[...new Set(names)].join(', ')}` : 'every referenced product or prop';
  return `${subject} keeps the exact silhouette, proportions, component layout, construction, material, finish, color, markings and physical scale of its image reference, no redesign, deformation, substitution or added/removed parts`;
}

export function buildMidjourneyPrompt(input: string, options: MidjourneyPromptOptions = {}): string {
  const source = cleanText(input)
    .replace(/--(?:raw|hd|draft|tile)(?=\s|$)/gi, '')
    .replace(/--(?:profile|p|ar|aspect|v|version|q|quality|stylize|s|chaos|c|weird|w|seed|iw|cref|cw|sref|sw|oref|ow|dref|dw|stop|repeat|r|niji|style)\s+[^\s]+/gi, '');
  const objectLock = referencedObjectDirection(source);
  const taskMode = options.taskMode || inferTaskMode(source);
  if (taskMode === 'grid' || /^UNIQUE STORYBOARD BATCH:/im.test(source)) throw new Error('MJ 不再生成分镜九宫格，请逐镜生成');
  let visual = '';

  if (taskMode === 'character-sheet' && isCharacterBrief(source)) {
    visual = compactCharacterPrompt(source);
  } else {
    visual = section(source, 'IMAGE GOAL')
      || section(source, 'SCENE / CREATIVE DIRECTION FROM USER')
      || section(source, 'USER CREATIVE DIRECTION')
      || section(source, 'GOAL')
      || source.split(/\n\s*\n/)[0]
      || source;
  }

  visual = visual
    .replace(/^(?:create|generate|render)\s+(?:one\s+)?/i, '')
    .replace(/\b(?:exact|strict|authoritative)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();

  const normalizedStyle = options.visualStyle || 'cinematic-natural';
  // sref supplies the finish. Do not stack a competing generic style manifesto
  // over the user's approved look, or describe its actor as part of this cast.
  const styleDirection = options.hasStyleReference
    ? 'lighting, color and surface texture consistent with the style reference'
    : STYLE_DIRECTIONS[normalizedStyle] || STYLE_DIRECTIONS['cinematic-natural']!;
  const hasPeople = options.hasPeople ?? inferPeople(visual);
  const captureDirection = taskMode === 'character-sheet'
    ? 'neutral studio lighting, unobstructed silhouette and clear material detail'
    : !hasPeople
      ? `${ENVIRONMENT_CAPTURE_DIRECTIONS[options.capturePreset || 'cinematic-narrative']}, no people`
      : CAPTURE_DIRECTIONS[options.capturePreset || 'cinematic-narrative'];
  const subjectFinish = hasPeople && !/anime|3D|stop-motion/i.test(styleDirection)
    ? 'natural anatomy, restrained expression and believable body weight'
    : 'coherent geometry, physical material response and intentional depth';
  const taskFinish = taskMode === 'character-sheet'
      ? /character concept contact sheet/i.test(source.split('\n')[0])
        ? 'distinct candidate designs on a plain neutral background, no text or labels'
        : 'one identity on a plain neutral background, no text or labels'
      : taskMode === 'story-shot'
        ? `one complete narrative film frame staged inside the described location, the environment and action geometry remain clearly readable${hasPeople ? ', use reference cards for identity only and ignore their layout, name and typography, never an isolated studio portrait or character turnaround' : ''}`
      : 'one clean standalone frame with a clear subject hierarchy';
  const prompt = `${visual.replace(/[.;]+$/, '')}, ${objectLock ? `${objectLock}, ` : ''}${captureDirection}, ${styleDirection}, ${subjectFinish}, ${taskFinish}`;
  if (taskMode === 'story-shot') {
    // These template paragraphs precede generic style contracts with headings
    // that are not always plain "HEADING:". Do not re-import that boilerplate.
    const framing = ['COMPOSITION', 'OUTPUT'].map(heading => section(source, heading).split(/\n\s*\n/)[0]).filter(Boolean);
    const locks = ['LOCKED IDENTITIES', 'REFERENCE ROLES', 'CAST LOCK'].map(heading => section(source, heading)).filter(Boolean);
    // Preserve this shot's framing and identity instructions in full.
    return [visual, ...framing, ...locks, objectLock, captureDirection, styleDirection, subjectFinish, taskFinish].filter(Boolean).join('\n');
  }
  // Compact boilerplate above, not user descriptions or continuity constraints.
  return prompt;
}

export function buildMidjourneyImaginePayload(input: {
  prompt: string;
  aspectRatio: ImageGenerationAspectRatio;
  imageUrls?: string[];
  referenceMode?: MidjourneyReferenceMode;
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
  taskMode?: MidjourneyTaskMode;
  hasPeople?: boolean;
  personalizationProfile?: string;
  references?: MidjourneyReferenceOptions;
}): Record<string, unknown> {
  const taskMode = input.taskMode || inferTaskMode(input.prompt);
  const hasPeople = input.hasPeople ?? inferPeople(input.prompt);
  const imageUrls = [...new Set((input.imageUrls || []).filter(url => typeof url === 'string' && url.trim()).map(url => url.trim()))];
  const references = input.references || {};
  const version = references.version || '8.2';
  if (!['6.1', '7', '8.2'].includes(version)) throw new Error('不支持的 MJ 参考模型版本');
  const characterUrl = referenceUrl(references.characterReferenceUrl, '角色参考');
  if (references.characterWeight !== undefined && (version !== '6.1' || !characterUrl)) {
    throw new Error('cw 仅适用于已指定 cref 的 V6.1 请求');
  }
  if (references.omniWeight !== undefined && (version !== '7' || !characterUrl)) {
    throw new Error('ow 仅适用于已指定 oref 的 V7 请求');
  }
  const styleUrl = referenceUrl(references.styleReferenceUrl, '风格参考')
    || (input.referenceMode === 'style' ? imageUrls[0] || '' : '');
  if (input.referenceMode === 'style') imageUrls.length = 0;
  if (version !== '8.2' && input.referenceMode === 'character' && imageUrls.length && !characterUrl) {
    throw new Error('V6.1/V7 必须单独指定角色参考，不会把多个人物合并为同一身份');
  }
  if (imageUrls.length > 4) throw new Error('MJ 最多4张内容参考，不能静默丢弃参考图');
  const requestedProfile = String(input.personalizationProfile || '').trim();
  const personalizationProfile = normalizeMidjourneyProfileCode(requestedProfile);
  if (requestedProfile && !personalizationProfile) {
    throw new Error('Midjourney Profile 代码只能包含字母、数字、下划线或连字符');
  }
  const body: Record<string, unknown> = {
    prompt: buildMidjourneyPrompt(input.prompt, {
      visualStyle: input.visualStyle,
      capturePreset: input.capturePreset,
      taskMode,
      hasPeople,
      hasStyleReference: Boolean(styleUrl),
    }),
    size: input.aspectRatio,
    // Character story shots with references use the V8.2 edit endpoint below.
    // Ordinary image guidance remains available for unrelated single images.
    version,
    // Keep the chosen photographic treatment; leave unrelated optional controls
    // at APIMart defaults instead of appending a synthetic parameter recipe.
    raw: true,
  };

  if (personalizationProfile) {
    // APIMart's `extra` escape hatch appends native Midjourney parameters
    // after the structured body has been normalized. Keep personalization out
    // of editable prose so prompt cleanup cannot remove it.
    body.extra = `--profile ${personalizationProfile}`;
  }

  if (styleUrl) {
    body.sref = styleUrl;
    body.sw = referenceWeight(references.styleWeight, 100, 0, 1000, '风格权重');
  }
  if (characterUrl && version === '6.1') {
    body.cref = characterUrl;
    body.cw = referenceWeight(references.characterWeight, 100, 0, 100, '角色权重');
  } else if (characterUrl && version === '7') {
    const ow = referenceWeight(references.omniWeight, 100, 1, 1000, 'Omni 权重');
    body.extra = [body.extra, `--oref ${characterUrl} --ow ${ow}`].filter(Boolean).join(' ');
  } else if (characterUrl) {
    if (!imageUrls.includes(characterUrl)) imageUrls.unshift(characterUrl);
    if (imageUrls.length > 4) throw new Error('V8.2 编辑模型最多4张内容参考');
  }
  // Legacy style-only callers must not accidentally submit an empty edit job.
  if (input.referenceMode === 'style' && !characterUrl) return body;
  if (!imageUrls.length) return body;
  body.image_urls = imageUrls;
  return body;
}

export function midjourneyGenerationPath(taskMode: MidjourneyTaskMode | undefined, hasReferences: boolean, version = '8.2', referenceMode?: MidjourneyReferenceMode): string {
  return version === '8.2' && hasReferences && (taskMode === 'story-shot' || referenceMode === 'character')
    ? '/midjourney/generations/edits' : '/midjourney/generations';
}

/** APIMart Edits supports the same optional controls; keep our minimal contract. */
export function midjourneyEditPayload(imagine: Record<string, unknown>): Record<string, unknown> {
  return {
    prompt: imagine.prompt, image_urls: imagine.image_urls, version: imagine.version,
    size: imagine.size,
    ...(imagine.extra ? { extra: imagine.extra } : {}),
    // Verified against APIMart EDITS: these survive into prompt_en as native
    // --sref/--sw/--raw. Keep style separate from the four content references.
    ...(imagine.sref ? { sref: imagine.sref, sw: imagine.sw } : {}),
    ...(imagine.raw !== undefined ? { raw: imagine.raw } : {}),
  };
}

export function isMidjourneyModel(model: string): boolean {
  return model.trim().toLowerCase() === MIDJOURNEY_IMAGE_MODEL;
}

export function isMidjourneyTask(taskId: string): boolean {
  return taskId.startsWith(MIDJOURNEY_TASK_PREFIX);
}

export function unwrapMidjourneyTaskId(taskId: string): string {
  return isMidjourneyTask(taskId) ? taskId.slice(MIDJOURNEY_TASK_PREFIX.length) : taskId;
}
