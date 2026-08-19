import type { Storyboard, VisualStyle } from '@/types';

const clean = (value?: string) => value?.trim() || 'not specified; infer only from the supplied reference image';

export const DEFAULT_VISUAL_STYLE: VisualStyle = 'cinematic-natural';

export interface ProductionStylePreset {
  value: VisualStyle;
  label: string;
  description: string;
  imageContract: string;
  look: string;
  camera: string;
  rhythm: string;
  performance: string;
  sound: string;
  h3Direction: string;
}

export const PRODUCTION_STYLE_PRESETS: ProductionStylePreset[] = [
  {
    value: 'follow-reference', label: '跟随参考', description: '保留上传图片原有媒介、色彩与镜头质感',
    imageContract: 'the exact visual medium, color response, lighting philosophy, texture and lens rendering established by the supplied reference images',
    look: 'Preserve the reference images as the complete rendering authority: identical medium, color temperature, contrast response, highlight roll-off, shadow density, texture, grain, depth of field and skin or surface treatment.',
    camera: 'Use one coherent physical camera and lens family inferred from the references. Movement is motivated by action, carries believable inertia and never changes the established rendering pipeline.',
    rhythm: 'Feature-film cause-and-effect cutting. Vary shot scale, enter on action and remove dead air while preserving the reference production’s narrative tone.',
    performance: 'Infer acting scale and motion cadence from the reference medium. Preserve its posture, silhouette, material behavior and degree of imperfection instead of imposing generic cinematic motion.',
    sound: 'Build restrained, perspective-correct ambience and visibly caused Foley from the location and materials. Human vocal sound exists only when the authoritative speech manifest schedules it.',
    h3Direction: 'Match the reference medium, lens behavior, performance scale and motion cadence exactly; motivated physical camera, causal cuts and no generic AI glide.',
  },
  {
    value: 'cinematic-natural', label: '自然电影', description: '克制、真实、演员驱动的院线叙事',
    imageContract: 'direct-captured natural live action from a real camera or modern phone, truthful skin pores and fabric, available and practical light, plausible exposure latitude, natural white balance, optical depth and motion blur, restrained color, no beauty filter, synthetic HDR or glossy AI rendering',
    look: 'Authentic direct-camera live action, as if photographed on location with a real mirrorless camera, cinema camera or recent phone appropriate to the scene. Truthful skin and fabric, available/practical light, plausible finite dynamic range, natural white balance, restrained color, real optical depth and motion blur; never airbrushed, hyper-sharp or synthetic HDR.',
    camera: 'Use one plausible physical capture device and lens family for the scene. Preserve human-operated inertia, slight handheld micro-jitter when appropriate, realistic autofocus or focus-pull recovery, exposure adaptation and rolling-shutter behavior; no frictionless AI glide, impossible orbit or perpetual shallow focus.',
    rhythm: 'Decisive feature-film cutting. Enter each beat late and leave early. Alternate wide geography, medium action and meaningful close detail; no empty waiting, decorative drift or uniformly slow movement.',
    performance: 'Subtext-first micro-performance: breath, eye-line and weight shift precede each gesture; anticipation leads to contact, then a visible reaction. People do not pose for the camera or move in slow motion by default.',
    sound: 'Natural location room tone and restrained tactile Foley. Keep ordinary acoustic imperfections; human voices exist only when the authoritative speech manifest schedules them, with no extra breaths, murmurs, laughter or dialogue.',
    h3Direction: 'Authentic direct-camera live action: real skin and fabric, finite exposure, natural white balance, optical motion blur, slight human-operated inertia and focus recovery. Subtext-first micro-performance; enter late, leave early.',
  },
  {
    value: 'warm-film', label: '温暖胶片', description: '金色、柔和、带记忆质感的叙事',
    imageContract: 'warm photochemical film photography, amber practical light, creamy skin tones, gentle halation, lifted shadow detail, visible fine grain, organic lens falloff, no digital HDR cleanliness',
    look: 'Warm photochemical film palette, amber practical light, creamy but textured skin, gentle halation, fine grain, soft contrast and organic lens falloff.',
    camera: 'Vintage spherical prime lens family. Human-operated dolly and restrained shoulder camera with gentle focus breathing and natural exposure response.',
    rhythm: 'Lyrical but active narrative cutting: short sensory inserts between held human moments. Preserve momentum; never turn every beat into slow motion.',
    performance: 'Intimate, memory-led micro-acting with tactile gestures and brief breathing holds, followed by active release. Motion stays organic and purposeful rather than uniformly dreamy.',
    sound: 'Warm close Foley, soft room tone and lightly softened high frequencies evoke an analog memory without adding vinyl noise or music unless scripted.',
    h3Direction: 'Warm photochemical memory: textured skin, amber practicals, halation and fine grain; intimate tactile acting, organic camera breath and active lyrical cuts rather than blanket slow motion.',
  },
  {
    value: 'neo-noir', label: '冷峻黑色', description: '高反差、压迫感、方向明确的悬疑影像',
    imageContract: 'neo-noir live-action cinema, cool cyan shadows, controlled warm practicals, deep blacks with retained texture, hard motivated edge light, wet reflective surfaces, subtle grain, no flat AI fill light',
    look: 'Neo-noir color separation: cool dense shadows, selective warm practicals, textured blacks, hard motivated edge light, wet reflections and restrained grain.',
    camera: 'Wider close-proximity lenses, low or obstructed angles, controlled lateral tracks and short snap reframes; stable screen direction and deliberate negative space.',
    rhythm: 'Tense compressed cutting with abrupt reveals, reaction inserts and short holds before impact. No floating camera and no evenly timed actions.',
    performance: 'Guarded posture and withheld eye-lines build pressure; delayed reactions break into one sudden decisive move. Reveal danger through behavior and obstruction, not theatrical posing.',
    sound: 'Sparse low ambience with close footsteps, cloth and metal detail. Let silence tighten immediately before a reveal; no unexplained whispers or voices.',
    h3Direction: 'Cool neo-noir pressure: textured blacks, hard motivated edges, obstruction and negative space; guarded acting, delayed reaction then decisive action, short hold before abrupt reveal.',
  },
  {
    value: 'documentary', label: '观察纪录', description: '手持、现场感、不过度表演',
    imageContract: 'observational documentary photography, available light, ordinary contrast, authentic skin, mild sensor noise, imperfect framing, real contact shadows, no staged commercial polish',
    look: 'Available-light documentary rendering, ordinary contrast, authentic skin and surfaces, mild sensor noise, practical exposure adaptation and no cosmetic polish.',
    camera: 'Present-tense footage from a phone, mirrorless camera or shoulder camera: small hand tremor, corrective reframing, believable autofocus hunting/recovery, auto-exposure adaptation, occasional rolling shutter and foreground obstruction; never mechanically floating.',
    rhythm: 'Event-driven documentary rhythm. Cut on action, discovery or reaction; keep incidental imperfections while removing dead time.',
    performance: 'Unscripted-looking behavior with partial eye-lines, imperfect starts and stops, and reactions to the environment rather than the camera. Never stage a hero pose.',
    sound: 'Location sound dominates: perspective-correct incidental noise, imperfect room tone and only Foley caused by visible action. No polished score, narration or invented dialogue.',
    h3Direction: 'Phone, mirrorless or shoulder-camera observation: available light, ordinary contrast, hand tremor, autofocus/exposure recovery and imperfect reframing. Unscripted behavior; cut only on discovered action or reaction.',
  },
  {
    value: 'commercial', label: '高级商业', description: '精确光线、材质与视觉高潮',
    imageContract: 'high-end live-action commercial photography, precise material response, controlled specular highlights, clean color separation, premium production lighting, crisp subject hierarchy, no generic CGI gloss',
    look: 'Premium commercial color pipeline, controlled specular highlights, precise material texture, clean separation, polished contrast and a consistent hero palette.',
    camera: 'Precisely repeatable dolly, macro slider and stabilized arc moves with coherent parallax. Each move reveals a feature or advances the story.',
    rhythm: 'Confident advertising rhythm: rapid evidence inserts, clear product or character hero moments and a decisive final visual payoff.',
    performance: 'Choreograph precise hand-to-object contact and readable material response. Reserve the composed hero pose for the payoff; every preceding gesture demonstrates value or changes state.',
    sound: 'Crisp material-specific product Foley, controlled rhythmic accents and clean acoustic negative space; every sonic hit coincides with visible contact or reveal.',
    h3Direction: 'Premium commercial precision: controlled highlights, exact material response and repeatable parallax; choreographed contact, rapid evidence inserts and one decisive hero payoff.',
  },
  {
    value: 'anime', label: '动漫电影', description: '统一线条、赛璐璐光影与动画节奏',
    imageContract: 'cinematic anime, consistent character model, clean controlled line art, intentional cel shading, stable color script, hand-authored background perspective, no photorealistic skin or 3D drift',
    look: 'Cinematic anime with stable line weight, intentional cel shading, controlled color script, painterly backgrounds and consistent character-model rendering.',
    camera: 'Animation-aware virtual camera with readable key poses, controlled parallax and purposeful smears only during fast action.',
    rhythm: 'Anime feature rhythm: strong key poses, quick impact cuts, reaction close-ups and deliberate held frames only at emotional punctuation.',
    performance: 'Animate clear anticipation → key pose → impact → recovery. Hold readable silhouettes, use limited secondary motion at punctuation and preserve the exact 2D character model across poses.',
    sound: 'Precise cloth, wind and impact cues accent pose changes and cuts. Keep stylized sounds causally tied to visible action; no extra speech.',
    h3Direction: 'Cinematic 2D anime with stable linework and character model: anticipation → key pose → impact → recovery, readable silhouettes, controlled parallax, impact cuts and purposeful held frames.',
  },
  {
    value: '3d-cg', label: '3D 电影', description: '统一材质、体积光与动画表演',
    imageContract: 'cinematic 3D CG, physically coherent materials, stable character topology, unified global illumination, controlled volumetric light, filmic color response, no 2D line art or live-action texture drift',
    look: 'Cinematic 3D rendering with coherent physically based materials, stable topology, volumetric depth, filmic highlights and unified global illumination.',
    camera: 'Virtual cinema camera with physical lens behavior, believable mass and acceleration; no frictionless floating or impossible pivots.',
    rhythm: 'Feature-animation cutting driven by silhouette, action and reaction. Vary scale and timing; avoid uniform easing and generic orbit shots.',
    performance: 'Use weighted arcs, acceleration and deceleration, contact compression and settling. Expressions may be clear but topology, body volume and material response remain stable and non-rubbery.',
    sound: 'Material-specific impacts, cloth and environmental reflections have spatial depth and scale; no generic whoosh unless a visible fast movement causes it.',
    h3Direction: 'Cinematic 3D with stable topology and physical materials: weighted arcs, acceleration, contact compression and settling; lens-real virtual camera, silhouette-driven cuts and no generic orbit.',
  },
  {
    value: 'stop-motion', label: '定格手作', description: '触感材质、逐帧节奏与真实布景',
    imageContract: 'handmade stop-motion cinema, tactile fabric clay paper and miniature materials, visible frame-to-frame texture, practical miniature lighting, physical contact shadows, no smooth CG surfaces',
    look: 'Tactile stop-motion rendering with handmade materials, miniature practical light, slight frame texture and real contact shadows.',
    camera: 'Physical tabletop camera, restrained slider moves and locked macro setups; movement retains handcrafted stepped timing.',
    rhythm: 'Playful stop-motion cutting with clear pose changes and tactile action beats; no smooth synthetic interpolation.',
    performance: 'Use deliberate pose-to-pose increments, tiny frame-to-frame texture variation, tangible contact and settling, and purposeful replacement animation rather than smooth CG interpolation.',
    sound: 'Dry close-scale clicks, scrapes, paper, clay and fabric sounds sell miniature physical scale; every sound follows a visible handmade contact.',
    h3Direction: 'Handmade stop-motion: tactile miniature materials, pose-to-pose steps, frame texture, physical contact and settling; locked or tabletop camera, clear tactile beats and no smooth CG interpolation.',
  },
];

export function normalizeVisualStyle(style?: VisualStyle): VisualStyle {
  if (style === 'live-action') return 'cinematic-natural';
  if (style === 'illustration') return 'anime';
  return PRODUCTION_STYLE_PRESETS.some(preset => preset.value === style) ? style! : DEFAULT_VISUAL_STYLE;
}

export function getProductionStylePreset(style?: VisualStyle): ProductionStylePreset {
  const normalized = normalizeVisualStyle(style);
  return PRODUCTION_STYLE_PRESETS.find(preset => preset.value === normalized)
    || PRODUCTION_STYLE_PRESETS.find(preset => preset.value === DEFAULT_VISUAL_STYLE)!;
}

// 风格锁：把「媒介」正向钉死到整个画面（角色+环境+光影），避免角色一种风格、背景另一种风格。
export function buildMediumLock(style?: VisualStyle): string {
  if (style && style !== 'follow-reference') {
    const preset = getProductionStylePreset(style);
    return `PRODUCTION STYLE BIBLE (authoritative): render the ENTIRE frame — every character, object, environment, light source and surface response — as ${preset.imageContract}. Apply this same camera family, color pipeline, contrast response and material language to every shot. This overrides generic style adjectives elsewhere in the prompt.`;
  }
  return `STYLE LOCK (authoritative): the entire frame — every character, object, environment, and the lighting — must be rendered in the exact same visual medium as the character reference image. If the reference is anime/illustration, render the whole scene as anime/illustration (line art + cel shading); if it is 3D CG, render as 3D CG; if it is live action, render as realistic photography. Never render the character in one medium and the background in another — one medium, one style, whole frame.`;
}

export function buildVideoStyleContract(style?: VisualStyle): string {
  const preset = getProductionStylePreset(style);
  return `LOOK:\n${preset.look}\n\nCAMERA SYSTEM:\n${preset.camera}\n\nPERFORMANCE & MOTION:\n${preset.performance}\n\nEDITING & RHYTHM:\n${preset.rhythm}\n\nSOUND TEXTURE:\n${preset.sound}`;
}

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
  visualStyle?: VisualStyle;
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
- Every character description must end with: "Consistent identity, costume, hairstyle and appearance throughout the video."

${buildMediumLock(input.visualStyle)}`;
}

export function buildSceneReferencePrompt(sceneStyle?: string, style?: VisualStyle, aspectRatio: '16:9' | '9:16' | '1:1' = '16:9') {
  const composition = aspectRatio === '9:16' ? 'vertical portrait composition' : aspectRatio === '1:1' ? 'square composition' : 'horizontal landscape composition';
  return `Create a professional ${aspectRatio} environment continuity bible with ${composition} for: ${clean(sceneStyle)}.
Show one coherent location through a hero establishing view plus complementary wide, reverse-angle, and key-detail views. Lock architecture, geography, entrances, landmarks, practical props, time of day, weather, light direction, color temperature, and material palette. Empty location, no characters. Clean editorial board, high production detail, no captions, labels, logos, watermark, or readable text.

${buildMediumLock(style)}`;
}

export function buildVideoContinuityRules(hasAudioReference: boolean) {
  const audioSync = hasAudioReference
    ? '\nFor scripted dialogue, mouth shapes and performance synchronize naturally to the matching character timbre reference. The written dialogue in the timed shot is the sole spoken content.'
    : '';

  return `
PHYSICS:

Maintain continuous temporal causality from frame to frame.
Hair, fabric, carried objects, contact points, shadows, reflections and body orientation evolve from the preceding state with believable weight and inertia.
Screen direction, spatial relationships, lighting direction, and environment geography remain stable throughout.
The established visual medium and rendering language remain stable.${audioSync}

CONSTRAINTS:

Each listed identity appears once with stable face, proportions, hair, wardrobe and accessories. Every shot preserves the established environment and causal state; the timed dialogue and sound fields are authoritative.`;
}

export function getStoryboardDuration(storyboard: Pick<Storyboard, 'videoDuration'>) {
  return Math.min(15, Math.max(5, storyboard.videoDuration || 5));
}
