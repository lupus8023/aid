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
  return `REFERENCE AND CONTINUITY — highest priority:
- Treat the input frame/reference board as ground truth. Preserve the same identity, facial geometry or head design, age, body proportions, hair, wardrobe, accessories, markings, materials, and companion/object design in every frame.
- Preserve the source medium. A real person stays natural live action; CG stays CG; anime/illustration keeps its line, shape, shading, and motion language. Never drift into another medium.
- For live action: retain natural skin texture, stable facial anatomy and believable biomechanics; no beauty-filter skin, face replacement, waxiness, or uncanny eye/teeth changes.
- For stylized/CG subjects: retain the exact silhouette, topology/design language, palette, render style, and intended stylized motion; do not force photographic skin detail.
- Hair, cloth, fur, skin/surfaces, water, smoke, and carried objects obey coherent physics and inertia. Contact points do not slide or detach.
- Maintain screen direction, scale, spatial relationships, lighting direction, and environment geography. No morphing, flicker, teleporting, costume swaps, duplicate limbs, disappearing accessories, or unrequested characters.
- Use one readable action arc with a motivated beginning, development, and resolved final pose. If the prompt requests a continuous take, use natural occlusion and camera travel for transitions—no hidden cuts.
- No subtitles, text overlays, watermark, or background music. Natural production sound only.${hasAudioReference ? '\n- Speech, mouth shapes, breath, and body performance synchronize naturally to the supplied character audio.' : ''}

REALISTIC CAMERA DEFECTS (for documentary/natural feel):
- Moderate handheld shake and breathing motion (not excessive)
- Autofocus hunting when subject moves or lighting changes
- Lens breathing (subtle focal length shift during focus adjustments)
- Exposure fluctuation when moving between bright and shadowed areas
- Slight motion blur during quick movements
- Minor rolling shutter distortion
- Natural sensor noise in low light

NEGATIVE CONSTRAINTS (anti-AI defaults):
- NO cinematic camera movements or perfect stabilization
- NO modern color grading or commercial polish
- NO perfect composition or beauty-filter smoothing
- NO music, narration, or designed sound effects

AUDIO GUIDANCE:
Natural ambient sound only — environmental acoustics appropriate to the scene (birds, wind, footsteps, fabric rustle, distant traffic, breathing, natural vocal timbre). NO music. NO sound design. NO narration.`;
}

export function getStoryboardDuration(storyboard: Pick<Storyboard, 'videoDuration'>) {
  return Math.min(15, Math.max(5, storyboard.videoDuration || 5));
}
