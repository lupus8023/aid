import type { CapturePreset, VisualStyle } from '@/types';
import { getCapturePreset } from './capturePresets';
import { getProductionStylePreset, normalizeVisualStyle } from './promptArchitecture';
import { buildGptPhotographicDetail, type PhotographicDetailContext } from './gptPhotographicDetail';

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
      return '超强真实感，像真实电影现场拍到的一瞬间。 An unretouched frame from a live-action feature film, caught during the action rather than posed for a poster. Every named human or humanlike cast member is an adult over 21; retain the specified age and identity. Photograph fantasy designs as practical makeup, sewn costumes, built scenery and creature effects that preserve the approved species and anatomy. Merfolk keep their fish tails, never human legs or shoes. No crew or filming equipment appears in the frame.';
  }
}

function photographicLook(visualStyle?: VisualStyle, capturePreset?: CapturePreset): string {
  const style = normalizeVisualStyle(visualStyle);
  const device = getCapturePreset(capturePreset).value;
  if (style === 'warm-film' && device === 'cinematic-narrative') {
    return 'Warm film color and gentle grain, using the authored light.';
  }
  if (style === 'neo-noir') {
    return 'Low-key practical light; let unlit parts of the location remain dark.';
  }
  if (style === 'documentary') {
    return 'Ordinary location color and available light, without cosmetic polish.';
  }
  if (style === 'commercial') {
    return 'Clean commercial photography, with real clothes and props under the requested light.';
  }
  if (style === 'follow-reference') {
    return 'Keep the reference color and photographic mood without copying its pose or layout.';
  }
  return 'Favor a believable observed moment over visual polish.';
}

export function buildGptImage2PhotographicContract(
  visualStyle?: VisualStyle,
  capturePreset?: CapturePreset,
  context: PhotographicDetailContext = {},
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
${buildGptPhotographicDetail({ ...context, capturePreset })}`;
}

export interface GptImage2StoryPromptInput {
  goal: string;
  action?: string;
  sceneStyle?: string;
  shotSize?: string;
  angle?: string;
  cameraMove?: string;
  exactCast: string;
  characterCount?: number;
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
  const hasObjects = references.some(reference => /OBJECT IDENTITY|Object requirement|product reference/i.test(reference));
  const outputContract = buildGptImage2PhotographicContract(input.visualStyle, input.capturePreset, {
    shotSize: input.shotSize, characterCount: input.characterCount,
  });

  return `SHOT:
${goal}${actionLine ? `\n${actionLine}` : ''}

CAMERA AND COMPOSITION:
${shot || 'One story-motivated eye-level composition with readable foreground, middle ground and background.'}

${scene && scene !== goal ? `LOCATION CONTEXT (the shot above controls the current action and lighting):\n${scene}\n\n` : ''}${outputContract}

CAST:
${collapse(input.exactCast)}

${references.length ? `REFERENCE INPUT ROLES:\n${references.join('\n')}\n\n` : ''}CONSTRAINTS:
One complete standalone frame, capturing one instant of the action. References supply only their named roles, not their pose, sheet layout or rendering method. No captions, subtitles, dialogue text, watermark, UI, panels or extra views.${hasObjects ? '\nEach object reference is an immutable design source: keep its silhouette, proportions, component layout, material, surface finish and scale; never redesign, simplify, stretch, melt, substitute or add/remove parts. A label, logo or marking on a locked reference object stays unchanged.' : ''}\nNo unrelated person, object, scenery or decoration.`;
}
