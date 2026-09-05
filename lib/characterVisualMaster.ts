import type { Character, CharacterVisualMaster, VisualStyle, CapturePreset } from '@/types';
import { buildImageStyleControls, type ImageStyleControls } from './imageStyleControls';

/** Image-only contract: a selected master supplies the finish, not a generic
 * photographic preset. Product references never supply skin or costume style. */
export const INHERIT_CHARACTER_LOOK = `REFERENCE LOOK (authoritative):
Extend the approved character images. Preserve each face, hair, costume, jewelry, skin texture, material detail and the established visual medium, color treatment, light softness and tonal quality. Do not restyle, beautify, neutralize or convert the reference to another medium. Change only the authored framing, expression, physical action and location; adapt lighting to the location without changing the established look. Product images define the exact product, not the character's style. Ignore reference sheet layouts and typography.`;

/** User-selectable aesthetic recipe, never appended to a referenced storyboard.
 * Learned from the user's historical-cinema example, not a new cast/plot. */
export const HISTORICAL_CINEMA_AESTHETIC = `PHOTOGRAPHIC OUTPUT:
Live-action historical cinema still, photographed on a physically built film set, not illustration, concept art or CG.
COMPOSITION AND CAMERA:
An intimate, story-motivated portrait, with foreground depth and a precise focal subject. Keep the described pose and expression. Choose a plausible portrait lens and aperture for this framing; focus on the near eye, with natural optical falloff rather than computational blur. Do not crop out important costume or jewelry details just to simulate extreme shallow focus.
LIGHTING AND COLOR:
One soft warm motivated side source, gentle shadow transitions, small practical highlights, readable dark areas and a restrained antique palette. Natural white balance, no orange-and-teal grading, magical rim glow or HDR. Preserve the lighting direction explicitly requested in the brief.
SKIN AND MATERIALS:
Visible fine pores and facial hairs where the framing resolves them, natural under-eye and lip texture, subtle pigmentation. No smoothing, waxy translucency or invented scars. Gold has aged filigree, fine construction and small localized reflections rather than mirror-perfect polish. Silk has woven fibers, folds and raised embroidery threads; jewelry has physical weight; hair has fine readable strands. Apply only the materials actually specified for this character, without adding new ornaments or changing the design.
IMAGE CHARACTER:
Quiet historical-film atmosphere, fine subtle grain and slightly imperfect photographic sharpness. Preserve delicate features and the intended beauty without plastic skin, excessive symmetry, oversharpening, artificial bokeh, fantasy particles or game-cinematic rendering.`;

export function buildGptCharacterMasterPrompt(input: Parameters<typeof buildCharacterMasterPrompt>[0], hasReferences = false): string {
  return `CHARACTER AND VISIBLE DESIGN:
${[input.description.trim(), input.role, input.age, input.personality, input.costumeDesc].filter(Boolean).join('\n')}

${buildImageStyleControls({ ...input, hasCharacterReference: hasReferences })}
${input.aestheticDirection?.trim() ? `USER AESTHETIC DIRECTION (refine the selected medium without changing the described character):\n${input.aestheticDirection.trim()}\n\n` : ''}${hasReferences ? 'REFERENCE ROLE: supplied identity images guide the requested character and visible details. Keep identity and costume unless the brief explicitly requests a change.\n\n' : ''}OUTPUT:
One standalone character portrait, one person, no contact sheet or panels. Make composition, expression, lighting and material behavior concrete and coherent with the brief. Do not add costume, jewelry or surface defects just to advertise detail. No captions, subtitles, watermark or UI.`;
}

export function buildCharacterMasterPrompt(input: {
  name: string; role?: string; age?: string; personality?: string;
  description: string; costumeDesc?: string; aestheticDirection?: string;
  visualStyle?: VisualStyle; capturePreset?: CapturePreset; hasStyleReference?: boolean;
}): string {
  return [
    input.description.trim(),
    input.role?.trim(), input.age?.trim(), input.personality?.trim(),
    input.costumeDesc?.trim(), buildImageStyleControls(input), input.aestheticDirection?.trim(),
    'One standalone character portrait, one person, no contact sheet, no panels, no captions or watermark.',
  ].filter(Boolean).join('\n');
}

export function buildCharacterExtensionPrompt(name: string, controls?: ImageStyleControls): string {
  return `Create a 2x2 character continuity sheet for ${name} using image 1 as the sole approved visual master.
${controls ? buildImageStyleControls({ ...controls, hasCharacterReference: true }) : INHERIT_CHARACTER_LOOK}
Exactly two columns and two rows, equal cells, no borders. Top-left: medium frontal view. Top-right: three-quarter head close-up. Bottom-left: medium side view. Bottom-right: a medium view with one subtle expression change. One instance of the same character per cell. Keep the visible outfit and accessories unchanged; do not invent unseen costume or change the background treatment. Preserve the master image's detail and finish. No writing, labels, subtitles, color swatches or diagrams.`;
}

export function buildInheritedScenePrompt(scene: string, ratio: string, controls?: ImageStyleControls): string {
  return `Create one empty location reference, ${ratio}. Location: ${scene}.
Use image 1 only for the approved visual medium, palette, light softness, tonal quality and material detail, except the explicitly selected style or capture changes below. The reference person's pose and background do not define the new location. No people, character portraits, costumes on display, products, panels, captions, subtitles or watermark. Keep readable spatial geography for subsequent story shots.
${controls ? buildImageStyleControls(controls) : 'Extend that same look; do not impose a new photographic style.'}`;
}

export function makeCharacterVisualMaster(imageUrl: string, source: CharacterVisualMaster['source'], prompt?: string): CharacterVisualMaster {
  return { version: 1, imageUrl, source, prompt: prompt || undefined };
}

export function resolveCharacterStoryboardModel(model: string, characters: Pick<Character, 'visualMaster'>[]): string {
  return model === 'midjourney' && characters.some(character => character.visualMaster)
    ? 'gpt-image-2' : model;
}
