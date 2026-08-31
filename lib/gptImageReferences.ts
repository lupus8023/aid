import type { VisualStyle } from '@/types';
import { normalizeVisualStyle, buildCharacterBiblePrompt, buildCharacterConceptGridPrompt, buildSceneReferencePrompt } from './promptArchitecture';

export function usesPhotographicReferences(style?: VisualStyle): boolean {
  return !['anime', '3d-cg', 'stop-motion', 'follow-reference'].includes(normalizeVisualStyle(style));
}

export const PHOTOGRAPHIC_IDENTITY_RULE = 'References lock identity and design, not rendering style. Preserve face/head structure, age, species, anatomy, markings, hair and costume design; photograph them with natural surface texture. Do not inherit CG shading, illustration, plastic gloss or beauty retouching. Never humanize a nonhuman character. Mermaids and merfolk retain their fish tail below the waist, never human legs or shoes.';

const materialRule = 'Soft broad daylight from one side with gentle room bounce; natural color and restrained contrast. Skin has subtle color variation and texture at the actual viewing distance, hair separates into irregular strands, cloth folds under its own weight, and worn metal reflects light locally. Do not invent freckles, scars, dirt, age changes or costume damage absent from the identity. No cosmetic smoothing, glamour lighting or exaggerated pore sharpening.';

export function buildGptCharacterAnchorPrompt(input: Parameters<typeof buildCharacterBiblePrompt>[0]): string {
  return `Create one photorealistic live-action costume-test photograph of ${input.name || 'the specified character'}. Convert the reference character design into a photographed physical subject, rather than repainting or retouching the reference.
${input.hasIdentityReference ? 'Image 1 defines only the recognizable facial/head structure, age, hairstyle, markings and exact costume design. Keep the same character and species.' : 'Establish the character from the written brief, preserving the specified age and species.'}
${input.description || ''}
${PHOTOGRAPHIC_IDENTITY_RULE}
${input.costumeDesc || ''}
One medium close-up at eye level. A relaxed, quiet gesture appropriate to the specified anatomy; the face/head and costume are readable. Plain unobtrusive fitting-room background. Broad window daylight, gentle room bounce, restrained contrast and ordinary photographic color.
The surface should show subtle real skin or species-appropriate surface variation, irregular individual hair or fur where present, and the weight and weave of clothing. Preserve distinguishing features and clothing details. No drawn contours, uniform sculpted hair ribbons, glossy mannequin surfaces or beauty retouching. One photograph only, no character sheet or extra views. Anatomy outside the crop remains the specified species; never invent human limbs for a nonhuman character.`;
}

export function buildGptCharacterBiblePrompt(input: Parameters<typeof buildCharacterBiblePrompt>[0]): string {
  if (!usesPhotographicReferences(input.visualStyle)) return buildCharacterBiblePrompt(input);
  return `Create a photorealistic costume-continuity photo sheet for ${input.name || 'one story character'}, photographed during a live-action wardrobe fitting. One identity in every view.

CHARACTER: ${input.description || ''}
WARDROBE: ${input.costumeDesc || 'Preserve the wardrobe described above and in the identity reference.'}
${input.hasIdentityReference ? PHOTOGRAPHIC_IDENTITY_RULE : 'Establish one distinctive identity from the brief, with the specified age and species, and keep it identical in every view.'}
${input.role ? `ROLE: ${input.role}` : ''}
${input.age ? `AGE: ${input.age}` : ''}

LAYOUT: One 4:3 horizontal sheet. A large three-quarter chest-up photograph shows the face clearly. Four supporting full-body photographs show front, three-quarter, side and back views with the complete body and costume visible. All views show the same individual, grooming and clothing at a consistent scale. Relaxed weight-bearing posture and neutral expression. An unobtrusive plain gray fitting-room backdrop. No diagrams, silhouette cutouts, color swatches or tiny expression grids. No text, labels or borders.

PHOTOGRAPHIC TREATMENT: ${materialRule}
Fantasy beings remain the same species and anatomy, portrayed as physically present creatures with believable skin, scales, fur and costume contact, never redesigned into human actors or game characters. Every view is a photograph with coherent light, perspective and material response. Preserve identity and wardrobe; change only the requested viewing angle.`;
}

export function buildGptCharacterConceptPrompt(input: Parameters<typeof buildCharacterConceptGridPrompt>[0]): string {
  if (!usesPhotographicReferences(input.visualStyle)) return buildCharacterConceptGridPrompt(input);
  return `Create a photorealistic casting and wardrobe-test contact sheet with exactly ${input.candidateCount} distinct candidates in a ${input.candidateCount === 4 ? '2 by 2' : '3 by 3'} grid.
ROLE: ${input.name || ''}. ${input.role || ''}. ${input.description || ''}
WARDROBE: ${input.costumeDesc || ''}
AGE: ${input.age || 'As specified in the role brief; do not change age to improve appearance.'}
${input.hasReferences ? PHOTOGRAPHIC_IDENTITY_RULE : 'Use the written brief to establish the specified species and age.'}
Explore casting and wardrobe alternatives only within the brief. One character per cell, full body visible at consistent scale, naturally standing against a plain gray backdrop. No added people within a cell. These are real fitting photographs, not sculptures or concept illustrations.
${materialRule}
No titles, numbers, labels, watermark, expression sub-panels, cropped feet or overlapping cells. Keep anatomy, species and the selected photographic medium consistent.`;
}

export function buildGptSceneReferencePrompt(scene: string, style?: VisualStyle, aspectRatio = '16:9'): string {
  if (!usesPhotographicReferences(style)) return buildSceneReferencePrompt(scene, style, aspectRatio as '16:9' | '9:16' | '1:1');
  return `Create one photorealistic location-scouting photograph, ${aspectRatio} composition, of this story location: ${scene}.
Convert any supplied environment design into a photographed physical location, rather than repainting its rendering. The reference fixes the architecture, entrances, landmarks and scale, not the CG shading, gloss or illustration style.
One wide photograph from a human-height camera slightly to the side of the entrance, showing usable foreground space and the location beyond. Honor the stated time, weather, light sources and colors. Stone and shell have uneven natural grain; cloth hangs under its own weight; light fades across surfaces and only appropriate materials reflect it. Preserve the design without adding decorations or damage. Natural photographic exposure and restrained contrast, readable shadows, no synthetic HDR or uniform luminous edges. Fantasy architecture remains physically tangible and faithful to the brief. No people, contact sheet, alternate views, labels, titles or added text.`;
}
