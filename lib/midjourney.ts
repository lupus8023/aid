import type { ImageGenerationAspectRatio } from './imageModels';
import type { CapturePreset, VisualStyle } from '@/types';

export const MIDJOURNEY_IMAGE_MODEL = 'midjourney';
export const MIDJOURNEY_TASK_PREFIX = 'midjourney:';
export const DEFAULT_MIDJOURNEY_PERSONALIZATION_PROFILE = 'votj2t8';

export type MidjourneyReferenceMode = 'image' | 'character' | 'style';
export type MidjourneyTaskMode = 'single' | 'story-shot' | 'grid' | 'character-sheet';

export interface MidjourneyPromptOptions {
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
  taskMode?: MidjourneyTaskMode;
  hasPeople?: boolean;
}

const CAPTURE_DIRECTIONS: Record<CapturePreset, string> = {
  'cinematic-narrative': 'motivated feature-film framing and natural unposed performance',
  'broadcast-candid': 'authentic live-television candid long-lens observation, unstaged and apparently unnoticed, relaxed side-on posture, foreground pedestrian or street-object occlusion, off-center untidy framing, slight edge crop, plausible motion blur, restrained broadcast compression and subtle interlaced texture, no influencer pose or beauty retouching',
  'documentary-follow': 'observational documentary follow camera, available light, purposeful handheld proximity, naturally imperfect framing and unperformed reactions',
  'phone-bystander': 'casual bystander phone capture, imperfect handheld framing, automatic exposure and focus recovery, mild motion blur and spontaneous behavior',
  'news-telephoto': 'distant news telephoto observation, compressed perspective, restricted sightline, foreground crowd occlusion and practical available light',
  'home-video': 'intimate casual home-video framing, consumer optics, automatic focus and exposure behavior and spontaneous interaction',
  surveillance: 'fixed high-angle surveillance viewpoint, wide spatial coverage, limited image quality and no camera-aware performance',
  'commercial-studio': 'controlled premium commercial camera, exact placement, shaped light and clean focal hierarchy',
  'follow-reference': 'inherit the reference camera distance, viewpoint, framing behavior and justified image texture',
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
  'cinematic-natural': 'a frame photographed for a high-budget live-action feature on a physical location or built set, real human actor in practical makeup and a physically made costume, individual facial asymmetry, unretouched pores, baby hairs and tiny skin variation, truthful wet hair skin fabric and scales, physically believable water weight contact shadows and atmospheric depth, natural cinema exposure and white balance, restrained color, gentle highlight roll-off and real optical focus falloff',
  'warm-film': 'warm photochemical 35mm cinema, creamy but textured skin, amber practical light, fine irregular grain, organic spherical-prime focus falloff, restrained halation only around bright sources, honey highlights and textured lifted shadows',
  'neo-noir': 'grounded neo-noir live action, cool cyan-black separation, sparse warm practicals, one hard motivated edge light, strong negative fill, dense textured shadows, wet controlled reflections, deliberate foreground obstruction and restrained grain',
  documentary: 'unstaged observational documentary photography, available location light, authentic skin and clothing wear, ordinary contrast, finite exposure, mild sensor texture, real contact shadows and imperfect but purposeful framing',
  commercial: 'premium live-action commercial photography, shaped key and controlled fill, precise specular placement, crisp focal hierarchy, exact glass metal liquid fabric and skin response, clean color separation and polished but physically real contrast',
  anime: 'cinematic authored 2D anime, stable character-model linework, deliberate line-weight hierarchy, graphic key-light shapes, controlled cel-shadow groups, painterly background depth and a locked color script',
  '3d-cg': 'feature-quality cinematic 3D, stable topology and grooming, physically based skin cloth metal and environment materials, unified global illumination, motivated key light, contact shadows, restrained volumetric depth and a physical virtual-camera perspective',
  'stop-motion': 'photographed handmade stop-motion miniature, tactile clay fabric paper and paint, visible seams and tiny construction variation, practical tabletop lighting, hard miniature contact shadows, macro-lens depth and subtle frame texture',
};

function clipWords(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const candidate = value.slice(0, Math.max(1, maxLength - 3));
  const boundary = candidate.lastIndexOf(' ');
  return `${(boundary > maxLength * 0.65 ? candidate.slice(0, boundary) : candidate).trimEnd()}...`;
}

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

function compactGridPrompt(source: string): string {
  const panels = source
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^Panel\s+\d+\b/i.test(line))
    .map(line => clipWords(line.replace(/\s*CAST\[[^\]]*\][^.]*\.?/gi, '').trim(), 155))
    .slice(0, 9);
  const scene = section(source, 'Scene continuity').slice(0, 240);
  const identities = section(source, 'Character identities (match mapped references exactly wherever they appear)').slice(0, 260);
  return [
    'STRICT 3x3 STORYBOARD LAYOUT: exactly three equal horizontal rows, each row contains exactly three equal rectangular cinematic panels; 3 columns x 3 rows equals nine panels, read left-to-right then top-to-bottom; clean edge-to-edge frames without captions, labels or borders.',
    ...panels,
    scene ? `Continuous setting: ${scene}` : '',
    identities ? `Recurring character appearance: ${identities}` : '',
  ].filter(Boolean).join(' ');
}

function compactCharacterPrompt(source: string): string {
  const firstLine = source.split('\n').find(line => line.trim())?.trim() || 'Cinematic character portrait';
  const fields = source
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^(?:Character description|Locked wardrobe and grooming|Role \/ identity|Approximate age|Personality keywords|Core theme|Name|Role \/ identity|Appearance|Wardrobe and grooming direction):/i.test(line))
    .slice(0, 8);
  const isSheet = /character sheet|contact sheet|production identity bible/i.test(firstLine);
  return [
    isSheet
      ? firstLine.replace(/high-precision\s*/i, '').replace(/\/ production identity bible/i, '')
      : 'Cinematic character portrait',
    ...fields,
    isSheet
      ? 'clean neutral studio background, readable silhouette, consistent identity and wardrobe across every view'
      : 'natural expression, readable silhouette, clean neutral background',
  ].join(', ');
}

/**
 * Midjourney responds best to a concise description of the finished image.
 * This compiler deliberately discards GPT-Image style contracts, explanations,
 * reference bookkeeping and repeated negative instructions.
 */
function inferTaskMode(source: string): MidjourneyTaskMode {
  if (/UNIQUE STORYBOARD BATCH:|3x3 storyboard contact sheet/i.test(source)) return 'grid';
  if (/Character Sheet|character concept contact sheet|production identity bible/i.test(source)) return 'character-sheet';
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
  const source = cleanText(input).replace(/--[a-z]+(?:\s+[^\s]+)?/gi, '');
  const objectLock = referencedObjectDirection(source);
  const taskMode = options.taskMode || inferTaskMode(source);
  let visual = '';

  if (/UNIQUE STORYBOARD BATCH:/i.test(source)) {
    visual = compactGridPrompt(source);
  } else if (/Character Sheet|character concept contact sheet|production identity bible/i.test(source)) {
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
  const styleDirection = STYLE_DIRECTIONS[normalizedStyle] || STYLE_DIRECTIONS['cinematic-natural']!;
  const captureDirection = CAPTURE_DIRECTIONS[options.capturePreset || 'cinematic-narrative'];
  const hasPeople = options.hasPeople ?? inferPeople(visual);
  const subjectFinish = hasPeople && !/anime|3D|stop-motion/i.test(styleDirection)
    ? 'natural anatomy, restrained expression and believable body weight'
    : 'coherent geometry, physical material response and intentional depth';
  const taskFinish = taskMode === 'grid'
    ? 'exactly nine complete cinematic frames in a uniform orthogonal grid of three equal columns and three equal rows, never two rows or six panels'
    : taskMode === 'character-sheet'
      ? 'one identity repeated consistently across the requested production views on a plain neutral studio background'
      : taskMode === 'story-shot'
        ? 'one complete narrative film frame staged inside the described location, the environment and action geometry remain clearly readable, use reference cards for identity only and ignore their layout, name and typography, never an isolated studio portrait or character turnaround'
      : 'one clean standalone frame with a clear subject hierarchy';
  const prompt = `${visual.replace(/[.;]+$/, '')}, ${objectLock ? `${objectLock}, ` : ''}${captureDirection}, ${styleDirection}, ${subjectFinish}, ${taskFinish}`;
  const maxLength = taskMode === 'grid' ? 2400 : taskMode === 'character-sheet' ? 1400 : 1100;
  return clipWords(prompt, maxLength);
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
}): Record<string, unknown> {
  const taskMode = input.taskMode || inferTaskMode(input.prompt);
  const hasPeople = input.hasPeople ?? inferPeople(input.prompt);
  const hasObjectReference = /OBJECT IDENTITY(?: ONLY)?\s*[:—-]|Object requirement\s*:/i.test(input.prompt);
  const imageUrls = [...new Set((input.imageUrls || []).filter(url => typeof url === 'string' && url.trim()))].slice(0, 4);
  const liveActionStyle = !['anime', '3d-cg', 'stop-motion', 'follow-reference'].includes(input.visualStyle || 'cinematic-natural');
  const negatives = taskMode === 'grid'
    ? [
        'captions, panel labels, watermark, user interface, overlapping panels, irregular grid, missing panels, repeated panel, two rows, six panels, 2x3 layout, triptych, freeform collage',
        liveActionStyle && hasPeople ? 'CGI, 3D render, doll, figurine, illustration, anime, digital character art, beauty render, airbrushed face, plastic skin, wax skin' : '',
      ].filter(Boolean).join(', ')
    : taskMode === 'character-sheet'
      ? 'scenic background, watermark, logo, unrelated props, inconsistent face, inconsistent wardrobe, extra limbs, deformed anatomy'
      : [
          'subtitles, captions, speech bubbles, watermark, user interface, split screen, reference-card typography, character name, readable signage, letterbox title',
          hasPeople ? 'duplicate people, extra limbs, deformed anatomy, plastic skin' : 'unrequested people, broken geometry',
          taskMode === 'story-shot' ? 'studio portrait, neutral studio backdrop, character sheet, fashion catalog, isolated turnaround, passport photo' : '',
          'oversaturated colors',
        ].filter(Boolean).join(', ');
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
    }),
    size: input.aspectRatio,
    // Keep every AID Midjourney path on V8.2. V8.2 does not support Omni
    // Reference, so character cards are intentionally supplied as a stronger
    // ordinary image prompt. This favors image quality over strict identity.
    version: '8.2',
    speed: 'relax',
    quality: '1',
    raw: true,
    stylize: liveActionStyle ? 40 : 75,
    chaos: liveActionStyle ? 1 : 2,
    negative_prompt: negatives,
    metadata: {
      source: 'aid',
      prompt_profile: 'cinematic-v2',
      task_mode: taskMode,
      visual_style: input.visualStyle || 'cinematic-natural',
      capture_preset: input.capturePreset || 'cinematic-narrative',
    },
    hd: true,
  };

  if (personalizationProfile) {
    // APIMart's `extra` escape hatch appends native Midjourney parameters
    // after the structured body has been normalized. Keep personalization out
    // of editable prose so prompt cleanup cannot remove it.
    body.extra = `--profile ${personalizationProfile}`;
    (body.metadata as Record<string, unknown>).personalization_profile = personalizationProfile;
  }

  if (!imageUrls.length) return body;
  if (input.referenceMode === 'character') {
    body.image_urls = imageUrls;
    body.iw = liveActionStyle ? 0.65 : 0.85;
  } else if (input.referenceMode === 'style') {
    body.sref = imageUrls[0];
    body.sw = 100;
  } else {
    body.image_urls = imageUrls;
    body.iw = hasObjectReference
      ? taskMode === 'grid' ? 0.75 : taskMode === 'story-shot' ? 0.7 : 0.9
      : taskMode === 'story-shot' ? 0.55 : taskMode === 'grid' ? 0.65 : 0.9;
  }
  return body;
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
