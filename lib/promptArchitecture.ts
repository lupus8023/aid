import { Storyboard } from '@/types';

const clean = (value?: string) => value?.trim() || 'not specified; infer only from the supplied reference image';

/**
 * Builds a production reference board rather than a single "costume photo".
 * The wording is deliberately medium-agnostic: the uploaded identity reference
 * decides whether the result is live action, CG, illustration, anime, or another medium.
 */
export function buildCharacterBiblePrompt(input: {
  name?: string;
  description?: string;
  costumeDesc?: string;
  hasIdentityReference?: boolean;
}) {
  const identityRule = input.hasIdentityReference
    ? 'The supplied image is the identity and medium authority. Generate no new character. Preserve the exact face or head design, age, body proportions, skin or surface appearance, hair, distinguishing marks, wardrobe logic, and native visual medium. Do not beautify, stylize, de-age, or convert between live action, photography, CG, anime, or illustration.'
    : 'Create one distinctive identity and repeat it exactly in every view. Choose the visual medium implied by the description; do not default to anime or photorealism.';

  return `Create a high-precision 4:3 horizontal Character Sheet / production identity bible for "${clean(input.name)}".

IDENTITY SOURCE
${identityRule}
Character description: ${clean(input.description)}.
Locked wardrobe and grooming: ${clean(input.costumeDesc)}.

DESIGN METADATA STRIP
- Add a clean top information strip with readable English labels only: character name, role/identity, approximate age when known, 3–5 personality keywords, and one short core theme sentence.
- Keep the typography minimal and technical. No logos, watermarks, decorative branding, or unrelated text.

BOARD CONTENT
- Main identity display: largest area of the board. Show the same character in full-body front, three-quarter, side, and back views; standard standing pose; simple height/proportion guide lines; no handheld props in the primary turnaround unless they are physically attached to the costume/body.
- Silhouette lock: front and side black/flat silhouettes that preserve the exact head shape, hair outline, shoulder width, torso/limb proportions, costume outline, and footwear footprint.
- Expression system: 8 consistent head/face panels showing calm, curious, tense, surprised, afraid, sad, determined, and relaxed. Keep the same facial structure/head design in every expression.
- Micro-expression system: 5 close panels showing eye tension, slight smile, mouth pressure, subtle fear, and controlled breathing. These should be small acting variations, not redesigns.
- Head construction: multi-angle head studies from front/three-quarter/profile/low-angle/high-angle, preserving skull shape, jawline or muzzle/head topology, hairline, ears/horns/markings, and eye spacing.
- Pose variations: relaxed, tense, and confident full/half-body poses that keep the same anatomy, costume, and silhouette.
- Emotional close-up: one chest-up cinematic close-up with strong story emotion while preserving identity.
- Wardrobe and material details: 4 detail panels for hairstyle/head features, fabric or surface material, accessories/marks/fasteners, and shoes/feet. Include real material behavior appropriate to the medium: skin, cloth, metal, fur, plastic, armor, or stylized linework as applicable.
- Hand/action details: relaxed hand, tense hand, pointing, gripping, and hand-to-face gesture. For non-human characters, replace with species-appropriate paws/claws/appendages and contact poses.
- Continuity palette: 6–8 clean color/material chips sampled from the design; color blocks only, no text inside the chips.
- If the subject is non-human, replace human-specific views with species-appropriate head, paws/hands/feet, markings, silhouette, and scale details.

LAYOUT AND RENDERING
Clean technical editorial grid on pure white, off-white, or minimal warm neutral background. The main identity display must be visually dominant. Use generous spacing, unobstructed silhouettes, consistent scale and perspective, clear English section labels, and cinematic yet neutral studio lighting. High-end production design document suitable as a downstream image/video reference.
Keep the source medium intact: real people remain natural live action with truthful skin texture and believable photographic lighting; realistic 3D stays realistic 3D with accurate materials; stylized 3D keeps its sculpted/stylized surface language; anime/illustration/IP design retains its exact drawing, shape, line, shading, and rendering language.

HARD CONSTRAINTS
One identity only. Every module must be based on the same character structure. No duplicate people presented as different identities, no face drift, no wardrobe redesign, no hairstyle changes, no body-proportion changes, no style drift, no mixed media, no modern/fantasy/sci-fi additions unless specified, no extra limbs or anatomy errors, no cropped feet in turnaround views, no busy scenic background, no random props, no unreadable gibberish labels, no logos, no watermark.

CHARACTER DESCRIPTION RULES (Visual Specificity)
- FORBIDDEN abstract adjectives: "fashionable", "attractive", "beautiful", "stylish", "elegant", "charming"
- REQUIRED concrete visual details: specific clothing items with colors and textures, precise hairstyle description, makeup level, visible accessories
- Example WRONG: "a fashionable young woman"
- Example RIGHT: "woman in her early 20s, faded charcoal sleeveless crop top, high-waist light-wash denim jeans, black canvas sneakers, black woven cord necklace, black wavy long hair in messy side ponytail with wispy bangs, natural daily makeup"
- Every character description must end with: "Consistent identity, costume, hairstyle and appearance throughout the video."`;
}

export function buildSceneReferencePrompt(sceneStyle?: string) {
  return `Create a professional 16:9 environment continuity bible for: ${clean(sceneStyle)}.
Show one coherent location through a hero establishing view plus complementary wide, reverse-angle, and key-detail views. Lock architecture, geography, entrances, landmarks, practical props, time of day, weather, light direction, color temperature, and material palette. Preserve the visual medium implied by the project reference—live action, CG, anime, or illustration—without converting it. Empty location, no characters. Clean editorial board, high production detail, no captions, labels, logos, watermark, or readable text.`;
}

export function buildVideoContinuityRules(hasAudioReference: boolean) {
  const audioSync = hasAudioReference
    ? '\nSpeech, mouth shapes, breath timing, and body performance synchronize naturally to the supplied character audio.'
    : '';

  return `
PHYSICS:

Maintain continuous temporal causality from frame to frame.
Hair placement, clothing folds, jewelry, hand contact points, object edges, cast shadows, reflections, and body orientation must evolve naturally from the preceding state — not reset between frames.
Fabric, hair, and carried objects obey coherent physical inertia. No sudden pose teleportation, material freeze, or object regeneration.
Screen direction, spatial relationships, lighting direction, and environment geography remain stable throughout.
Preserve the source visual medium throughout — real people stay natural live action; CG stays CG; anime/illustration keeps its exact design language, line quality, and shading style. No medium drift between frames.${audioSync}

CONSTRAINTS:

Preserve exact identity, facial structure, age, body proportions, hair, wardrobe, accessories, and environment in every frame.
No face change, beauty filter, skin smoothing, limb duplication, duplicate characters, costume swap, pose teleport, morphing, or scene replacement.
No subtitles, text overlays, watermarks, logos, or background music. Natural production sound only.`;
}

export function getStoryboardDuration(storyboard: Pick<Storyboard, 'videoDuration'>) {
  return Math.min(15, Math.max(5, storyboard.videoDuration || 5));
}
