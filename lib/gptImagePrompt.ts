import type { CapturePreset, VisualStyle } from '@/types';
import { getCapturePreset } from './capturePresets';
import { getProductionStylePreset, normalizeVisualStyle } from './promptArchitecture';

const collapse = (value?: string) => String(value || '').replace(/\s+/g, ' ').trim();

function captureSystem(capturePreset?: CapturePreset): string {
  switch (getCapturePreset(capturePreset).value) {
    case 'phone-bystander':
      return 'A photorealistic ordinary photograph taken on the main camera of a modern phone, catching one spontaneous action phase rather than a completed pose. The subject remains occupied by real activity and does not present to the phone. Use natural small-sensor depth, automatic exposure and white balance, modest computational sharpening, slight shadow noise and casually imperfect framing. No portrait-mode blur, professional lighting or cinema-camera treatment.';
    case 'broadcast-candid':
      return 'A photorealistic frame captured by a real live-television long-lens camera at one unguarded instant. The subject is already absorbed in an ordinary task, unaware of the camera, with loose asymmetrical posture, attention outside the lens and a gesture caught slightly incomplete. The operator observes from outside the action through compressed distance, restricted sightline and occasional foreground obstruction. Use restrained broadcast texture; no fashion or publicity staging.';
    case 'news-telephoto':
      return 'A photorealistic frame captured by a real distant news telephoto camera. Use compressed perspective, practical available light, a restricted camera position and foreground crowd or street obstruction. No studio relighting, hero pose or feature-film staging.';
    case 'documentary-follow':
      return 'A photorealistic observational documentary photograph taken on one real handheld mirrorless or shoulder camera, isolating one honest action phase already underway. Use available location light, a human camera height, a small corrective reframe and an occupied subject with unstaged posture. No commercial polish or publicity pose.';
    case 'home-video':
      return 'A photorealistic still from one real consumer home-video camera. Use intimate distance, automatic focus and exposure, ordinary household light and casually imperfect framing. No studio light, fashion pose or professional cinema treatment.';
    case 'surveillance':
      return 'A photorealistic frame from one real fixed security camera. Use a high wide viewpoint, flat practical exposure, limited sensor detail and natural movement through the space. No shallow depth of field, camera move, dramatic lighting or performed pose.';
    case 'commercial-studio':
      return 'A photorealistic photograph made with one real professional studio camera. Use a single controlled camera position, shaped physical light, exact product and skin material response, clean contact shadows and a clear focal hierarchy. Polished but never CGI, plastic or illustrated.';
    case 'follow-reference':
      return 'A photorealistic image captured with the single real photographic system already established by the supplied scene reference. Preserve its camera distance, perspective, exposure, white balance, focus behavior and justified imperfections. Do not add a second capture style.';
    case 'cinematic-narrative':
    default:
      return 'A photorealistic frame from a live-action feature film, photographed on location or on a physically built set with one real cinema camera. Use a motivated camera position, real adult actors, practical wardrobe and props, restrained performance and physically present light. It must read as a photographed moment, not key art, a movie poster or concept art.';
  }
}

function photographicLook(visualStyle?: VisualStyle, capturePreset?: CapturePreset): string {
  const style = normalizeVisualStyle(visualStyle);
  const device = getCapturePreset(capturePreset).value;
  if (style === 'warm-film' && device === 'cinematic-narrative') {
    return 'Use a coherent photochemical 35mm response: warm practical sources, fine irregular grain, restrained halation only around bright sources, organic focus falloff and textured shadows.';
  }
  if (style === 'neo-noir') {
    return 'Use motivated low-key practical light, strong negative fill, dense shadows that retain local texture, controlled reflections and restrained color. Keep skin and materials physically real.';
  }
  if (style === 'documentary') {
    return 'Use ordinary location color, available light, finite exposure, real contact shadows, mild device-appropriate sensor texture and no cosmetic polish.';
  }
  if (style === 'commercial') {
    return 'Use precise but physical light and truthful skin, cloth, glass, metal and liquid response. Keep highlight roll-off finite and avoid synthetic HDR or plastic gloss.';
  }
  if (style === 'follow-reference') {
    return 'Keep the reference image’s photographic color response, contrast, surface texture and degree of imperfection without importing its pose or layout.';
  }
  return 'Use natural white balance, finite exposure latitude, believable highlight clipping and shadow density, real contact shadows and restrained color. Do not use synthetic HDR, beauty retouching or glossy AI rendering.';
}

export function buildGptImage2PhotographicContract(
  visualStyle?: VisualStyle,
  capturePreset?: CapturePreset,
): string {
  const style = normalizeVisualStyle(visualStyle);
  if (style === 'anime' || style === '3d-cg' || style === 'stop-motion') {
    const preset = getProductionStylePreset(style);
    return `OUTPUT MEDIUM (authoritative):
Render the entire frame as ${preset.imageContract}. Keep this one medium coherent across every character, object, environment, light source and surface. Do not convert it into live-action photography or mix it with another medium.`;
  }

  return `PHOTOGRAPHIC OUTPUT (authoritative):
${captureSystem(capturePreset)}
${photographicLook(visualStyle, capturePreset)}
Preserve visible pores, mild facial asymmetry, fine hair, fabric weave, ordinary wear, physically plausible object contact, scale, occlusion and shadows. Use only imperfections caused by the declared camera. Do not render illustration, animation, CGI, concept art, a doll, waxy skin or an airbrushed face.`;
}

export interface GptImage2StoryPromptInput {
  goal: string;
  action?: string;
  sceneStyle?: string;
  shotSize?: string;
  angle?: string;
  cameraMove?: string;
  exactCast: string;
  referenceDescriptions?: string[];
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
}

export function buildGptImage2StoryPrompt(input: GptImage2StoryPromptInput): string {
  const goal = collapse(input.goal);
  const action = collapse(input.action);
  const scene = collapse(input.sceneStyle);
  const shot = [input.shotSize, input.angle, input.cameraMove].map(collapse).filter(Boolean).join(', ');
  const actionLine = action && !goal.toLowerCase().includes(action.toLowerCase()) ? action : '';
  const references = (input.referenceDescriptions || []).filter(Boolean);
  const outputContract = buildGptImage2PhotographicContract(input.visualStyle, input.capturePreset);

  return `${outputContract}

SCENE:
${scene || goal}

SUBJECT AND VISIBLE ACTION:
${goal}${actionLine ? `\n${actionLine}` : ''}

CAMERA AND COMPOSITION:
${shot || 'One story-motivated eye-level composition with readable foreground, middle ground and background.'}

CAST:
${collapse(input.exactCast)}

${references.length ? `REFERENCE INPUT ROLES:\n${references.join('\n')}\n\n` : ''}CONSTRAINTS:
One complete standalone frame. Preserve each referenced identity, object and environment only for its declared role. A reference declared as an object or product is an immutable design source: preserve its silhouette, dimensions and proportions, component layout, construction, material, surface finish, color, texture, seams, closures, interfaces, intentional markings, wear and small identifying details. Keep the same object at the same apparent physical scale wherever it recurs. Change only viewpoint, placement, lighting and physically possible articulation required by the scene; never redesign, simplify, stretch, melt, substitute or add/remove parts.
Do not copy a reference sheet layout, duplicate view, pose, border or unrelated text. No captions, subtitles, dialogue text, title, speech bubble, watermark, UI or added readable text. A label, logo or marking that physically belongs to a locked reference object may remain only as part of that unchanged design; do not invent, rewrite, relocate or restyle it. No unrelated person, object, scenery or decoration.`;
}
