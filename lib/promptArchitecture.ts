import type { CapturePreset, Storyboard, VisualStyle } from '@/types';
import { buildImageCapturePresetContract } from './capturePresets';

const clean = (value?: string) => value?.trim() || 'not specified; infer only from the supplied reference image';

export const DEFAULT_VISUAL_STYLE: VisualStyle = 'cinematic-natural';

export interface ProductionStylePreset {
  value: VisualStyle;
  label: string;
  description: string;
  imageContract: string;
  gridImageDirection: string;
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
    gridImageDirection: 'MEDIUM/TEXTURE: inherit the reference medium and its exact surface detail, finish and degree of imperfection. LIGHT: preserve its source direction, softness, contrast and highlight roll-off. LENS/DEPTH: preserve its perspective, subject scale, focus plane and background falloff. COLOR: preserve its white balance, palette, saturation and shadow density.',
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
    gridImageDirection: 'MEDIUM/TEXTURE: direct-camera live action; unretouched pores, individual hair strands, woven fabric and ordinary wear, never waxy. LIGHT: motivated window, sky or practical sources with defined direction, softness, bounce and falloff. LENS/DEPTH: use only the single physical capture device declared by CAPTURE MODE, with its plausible perspective, focus behavior and restrained edge distortion. COLOR: natural white balance, finite dynamic range, gentle highlight roll-off and readable shadows.',
    look: 'Authentic direct-camera live action, as if photographed on location with a real mirrorless camera, cinema camera or recent phone appropriate to the scene. Truthful skin and fabric, available/practical light, plausible finite dynamic range, natural white balance, restrained color, real optical depth and motion blur; never airbrushed, hyper-sharp or synthetic HDR.',
    camera: 'Use one plausible physical capture device and lens family for the scene. Preserve human-operated inertia, slight handheld micro-jitter when appropriate, realistic autofocus or focus-pull recovery, exposure adaptation and rolling-shutter behavior; no frictionless AI glide, impossible orbit or perpetual shallow focus.',
    rhythm: 'Decisive feature-film cutting. Enter each beat late and leave early. Alternate wide geography, medium action and meaningful close detail; no empty waiting, decorative drift or uniformly slow movement.',
    performance: 'Subtext-first micro-performance: breath, eye-line and weight shift precede each gesture; anticipation leads to contact, then a visible reaction. People do not pose for the camera or move in slow motion by default.',
    sound: 'Natural location room tone and restrained tactile Foley. Keep ordinary acoustic imperfections; human voices exist only when the authoritative speech manifest schedules them, with no extra breaths, murmurs, laughter or dialogue.',
    h3Direction: 'Authentic direct-camera live action: real skin and fabric, finite exposure, natural white balance, optical motion blur, slight human-operated inertia and focus recovery. Subtext-first micro-performance at real-time physical speed; enter late, leave early; never default to slow motion.',
  },
  {
    value: 'warm-film', label: '温暖胶片', description: '金色、柔和、带记忆质感的叙事',
    imageContract: 'warm photochemical film photography, amber practical light, creamy skin tones, gentle halation, lifted shadow detail, visible fine grain, organic lens falloff, no digital HDR cleanliness',
    gridImageDirection: 'MEDIUM/TEXTURE: photochemical live-action still with fine irregular grain, natural skin and tactile cloth, not a digital vintage filter. LIGHT: warm amber practicals or low sun contour the subject, with soft environmental fill and restrained halation only around bright sources. LENS/DEPTH: vintage spherical-prime perspective, gentle focus roll-off, mild breathing and organic edge softness. COLOR: creamy skin, honey highlights, softened greens/blues, lifted but textured shadows and no synthetic HDR.',
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
    gridImageDirection: 'MEDIUM/TEXTURE: grounded neo-noir live action with real skin, cloth, metal, rain and concrete response. LIGHT: one hard motivated edge/key plus sparse warm practicals; strong negative fill, deliberate obstruction and deep shadows that retain local texture. LENS/DEPTH: close-proximity perspective, layered foreground occlusion, selective focus and purposeful negative space. COLOR: cool cyan-black separation against limited amber highlights, controlled reflections and restrained grain.',
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
    gridImageDirection: 'MEDIUM/TEXTURE: unstaged observational photograph with authentic skin, clothing wear, dust and mild sensor texture. LIGHT: use only believable available daylight and location practicals, including mixed color temperatures, finite exposure and real contact shadows. LENS/DEPTH: eye-level phone, mirrorless or shoulder-camera perspective, imperfect but meaningful framing, modest depth of field and occasional foreground blockage. COLOR: ordinary location color, natural contrast and no beauty, fashion or commercial polish.',
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
    gridImageDirection: 'MEDIUM/TEXTURE: premium live-action advertising still with precise skin, glass, metal, liquid and fabric response; polished but physically real. LIGHT: shaped key, controlled fill, clean rim and intentional specular placement reveal form and material. LENS/DEPTH: exact hero framing, crisp focal priority, coherent macro/telephoto compression and clean background separation. COLOR: deliberate limited hero palette, luminous exposure, clean separation and controlled contrast without plastic CGI gloss.',
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
    gridImageDirection: 'MEDIUM/TEXTURE: authored 2D anime frame with stable character model, deliberate line-weight hierarchy and painterly background detail. LIGHT: graphic key shapes, controlled cel-shadow groups and selective rim accents that obey one source direction. LENS/DEPTH: hand-authored perspective, readable silhouette, layered parallax planes and focus emphasis without photographic bokeh pasted onto line art. COLOR: locked color script, purposeful saturation contrast and no live-action skin or 3D material drift.',
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
    gridImageDirection: 'MEDIUM/TEXTURE: feature-quality 3D animation with stable topology, fine grooming and coherent physically based skin, cloth, metal and environment materials. LIGHT: unified global illumination plus motivated key/practical sources, contact shadows and restrained volumetric depth. LENS/DEPTH: physical virtual-camera perspective, one focal plane, coherent depth falloff and believable scale. COLOR: filmic highlight roll-off, stable palette and no 2D linework, plastic surfaces or live-action texture drift.',
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
    gridImageDirection: 'MEDIUM/TEXTURE: photographed handmade miniature with visible clay, fabric, paper, paint, seams, fingerprints and tiny construction variation. LIGHT: practical tabletop sources create scale-appropriate falloff, hard miniature contact shadows and subtle bounce. LENS/DEPTH: physical macro/tabletop lens perspective, shallow but purposeful focus plane and miniature-scale background falloff. COLOR: tactile pigment and material color, slight frame texture and no smooth CG interpolation or synthetic surfaces.',
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
  return `STYLE LOCK (authoritative): infer one visual medium from the supplied style reference images and apply it to the entire frame — every character, object, environment, light source, and surface response. Use each reference only for its declared role. If the style reference is anime/illustration, preserve its line art, shading, and color script; if it is 3D CG, preserve its topology, materials, and render language; if it is live action, preserve its photographic capture language. Never mix media or import an unrelated reference background, pose, layout, label, or text.`;
}

// 静帧摄影契约：风格锁只解决「画成什么媒介」，这里补足真实摄影最容易
// 丢失的因果关系。它故意要求选择一套成像系统，而不是把所有镜头缺陷堆在一起。
export function buildImageCaptureContract(style?: VisualStyle): string {
  const normalized = normalizeVisualStyle(style);
  const profile = normalized === 'cinematic-natural'
    ? 'Direct-captured natural live action. Choose one plausible cinema, mirrorless, or modern-phone capture profile implied by the scene and references; keep it coherent and never average them into generic glossy imagery.'
    : normalized === 'documentary'
      ? 'Available-light observational photography. Use imperfect but purposeful framing, finite exposure, mild sensor texture, real contact shadows, and optically caused focus falloff; exclude commercial polish and staged hero posing.'
      : normalized === 'warm-film'
        ? 'Photochemical warm-film photography. Use one vintage spherical-prime response with organic focus falloff, irregular fine grain, and restrained halation only around bright motivated sources; exclude digital vintage filters and synthetic HDR.'
        : normalized === 'neo-noir'
          ? 'Grounded neo-noir live action. Use one close-proximity lens family with a motivated hard key or edge source, strong negative fill, dense but textured shadows, controlled practical highlights, wet material response, and deliberate foreground obstruction; exclude flat fill light.'
          : normalized === 'commercial'
            ? 'Premium live-action commercial photography. Use one precise camera and lens family with shaped key and fill, deliberate specular placement, exact skin/glass/metal/liquid/fabric response, crisp focal hierarchy, and clean subject separation; exclude plastic CGI gloss.'
            : normalized === 'anime'
              ? 'Authored cinematic 2D anime frame. Preserve stable character-model linework, intentional line-weight hierarchy, graphic key-light shapes, controlled cel-shadow groups, hand-authored perspective, readable silhouettes, and layered parallax planes; exclude photographic skin, pasted bokeh, and 3D material drift.'
              : normalized === '3d-cg'
                ? 'Feature-quality cinematic 3D frame. Preserve stable topology and grooming, physically based skin/cloth/metal/environment materials, unified global illumination, motivated key sources, contact shadows, restrained volumetric depth, and a physical virtual-camera perspective; exclude plastic surfaces, 2D linework, and impossible lens behavior.'
                : normalized === 'stop-motion'
                  ? 'Photographed handmade stop-motion miniature. Preserve visible clay, fabric, paper, paint, seams, fingerprints, and tiny construction variation under scale-appropriate practical tabletop light, macro-lens perspective, hard miniature contact shadows, and purposeful miniature depth falloff; exclude smooth CG interpolation and synthetic surfaces.'
            : normalized === 'follow-reference'
              ? 'Infer exactly one coherent capture or rendering system from the supplied style reference. Preserve its palette, surface language, contrast, depth, light, and medium-specific imperfections; do not blend it with a second medium.'
              : 'Use one coherent camera or rendering system appropriate to the selected medium and preserve its depth, light, and material logic.';

  return `STILL IMAGE SPECIFICATION (authoritative):
VISUAL MEDIUM: ${profile}
COMPOSITION: State one camera height, camera-to-subject distance and viewpoint; place the subject intentionally with explicit negative space and foreground/midground/background separation. Show the complete required action geometry and object contact; do not add unrelated elements.
FOCUS AND PERSPECTIVE: Use one explicit focus plane with plausible near/far falloff and medium-appropriate perspective. Do not blur the whole frame.
LIGHT AND MATERIAL: Use motivated key or practical light with a clear direction, source size, bounce or negative fill, shadow density, and distance falloff. Preserve finite exposure, controlled highlight roll-off, and material-specific diffuse/specular or stylized surface response.
QUALITY GUARD: Use only imperfections justified by the selected capture/rendering medium. Do not stack random lens defects, use synthetic HDR, beauty retouching, uniform fill light, mixed media, or generic "cinematic" gloss.`;
}

// 四宫格有更严格的提示词长度限制：保留成像因果的骨架，把逐镜差异留给 panel prompt。
export function buildCompactImageCaptureContract(style?: VisualStyle): string {
  const preset = getProductionStylePreset(style);
  return `GRID STYLE BIBLE (authoritative — apply to every panel): ${preset.gridImageDirection}
CAPTURE COHERENCE: Vary camera height/distance, perspective, composition and occlusion by panel. Keep one style-specific imaging system with clear near/mid/far separation, motivated light falloff and material response. Use only medium-justified imperfections; no generic AI gloss.`;
}

export function buildFixedObjectReferencePrompt(input: {
  name?: string;
  description?: string;
  visualStyle?: VisualStyle;
}): string {
  const preset = getProductionStylePreset(input.visualStyle);
  return `Create one production continuity reference image for the fixed story prop "${clean(input.name)}".
DESIGN: ${clean(input.description)}.
VISUAL MEDIUM: ${preset.imageContract}.
Show exactly one complete object in a clear three-quarter front view on a simple neutral seamless background. Keep the entire silhouette, scale cues, proportions, component layout, construction, material, finish, color, seams, closures, interfaces, intentional markings and wear readable. Use restrained studio lighting that reveals form without redesigning it. This image becomes the immutable design source for later shots.
No people, hands, scenery, packaging variants, alternate views, contact sheet, diagram, title, caption, watermark or unrelated text. Preserve text or markings only when the design brief explicitly requires them; never invent lettering.`;
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
  role?: string;
  age?: string;
  personality?: string;
  coreTheme?: string;
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
Role / identity: ${clean(input.role)}.
Approximate age: ${clean(input.age)}.
Personality keywords: ${clean(input.personality)}.
Core theme: ${clean(input.coreTheme)}.

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

${buildMediumLock(input.visualStyle)}

${buildImageCaptureContract(input.visualStyle)}`;
}

export function buildCharacterConceptGridPrompt(input: {
  name?: string;
  description?: string;
  costumeDesc?: string;
  role?: string;
  age?: string;
  personality?: string;
  coreTheme?: string;
  candidateCount: 4 | 9;
  hasReferences?: boolean;
  visualStyle?: VisualStyle;
}) {
  const grid = input.candidateCount === 4 ? '2 by 2' : '3 by 3';
  const referenceRule = input.hasReferences
    ? 'Use the supplied images as authoritative visual references for identity traits, medium, material language and design intent. Do not copy their background or layout.'
    : 'Develop the identity entirely from the written brief while keeping one coherent visual medium across all candidates.';

  return `Create one square character concept contact sheet containing exactly ${input.candidateCount} distinct candidates in a clean ${grid} grid.

CHARACTER BRIEF
Name: ${clean(input.name)}.
Role / identity: ${clean(input.role)}.
Approximate age: ${clean(input.age)}.
Personality: ${clean(input.personality)}.
Core theme: ${clean(input.coreTheme)}.
Appearance: ${clean(input.description)}.
Wardrobe and grooming direction: ${clean(input.costumeDesc)}.
${referenceRule}

CONCEPT EXPLORATION
Every cell shows one full-body concept of the same story role, facing mostly forward in a neutral readable pose. Explore meaningful alternatives in silhouette, proportion, hairstyle or head shape, costume cut, material balance and one signature detail. Keep the requested age, identity cues, personality, role and visual medium stable. Candidates must feel intentionally different, not recolors or tiny variations.

GRID RULES
Exactly ${input.candidateCount} equal cells, ${grid}, read left-to-right and top-to-bottom. One character per cell, centered, fully visible from head to feet, consistent scale, simple warm-white studio background, thin neutral gutters, no overlap between cells. No titles, numbers, captions, logos, watermark, scenery, props that hide the silhouette, duplicate character inside a cell, extra people, extra limbs, cropped feet, mixed media or unreadable text.

The sheet is a selection board, not the final turnaround. Prioritize clear identity, silhouette and production-ready design differences.

${buildMediumLock(input.visualStyle)}

${buildCompactImageCaptureContract(input.visualStyle)}`;
}

export function buildSceneReferencePrompt(sceneStyle?: string, style?: VisualStyle, aspectRatio: '16:9' | '9:16' | '1:1' = '16:9', capturePreset?: CapturePreset) {
  const composition = aspectRatio === '9:16' ? 'vertical portrait composition' : aspectRatio === '1:1' ? 'square composition' : 'horizontal landscape composition';
  return `Create a professional ${aspectRatio} environment continuity bible with ${composition} for: ${clean(sceneStyle)}.
Show one coherent location through a hero establishing view plus complementary wide, reverse-angle, and key-detail views. Lock architecture, geography, entrances, landmarks, practical props, time of day, weather, light direction, color temperature, and material palette. Empty location, no characters. Clean editorial board, high production detail, no captions, labels, logos, watermark, or readable text.

${buildMediumLock(style)}

${buildImageCapturePresetContract(capturePreset)}

${buildImageCaptureContract(style)}`;
}

export function buildStoryWorldAnchorPrompt(input: {
  sceneStyle?: string;
  representativeShot?: string;
  characterNames?: string[];
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
  aspectRatio?: '16:9' | '9:16' | '1:1';
}) {
  const cast = (input.characterNames || []).filter(Boolean).join(', ');
  return `IMAGE GOAL:
Create one finished cinematic story frame, not a portrait, character sheet, contact sheet, or design board. ${input.representativeShot?.trim() ? `${clean(input.representativeShot)}. ` : ''}Stage this story world: ${clean(input.sceneStyle)}. ${cast ? `The visible story identity is ${cast}; preserve the supplied role-card identity while changing its pose and camera angle to serve this scene.` : 'Keep the location visually dominant.'}

CAPTURE METHOD:
${buildImageCapturePresetContract(input.capturePreset)}

COMPOSITION:
Use a wide environmental master shot with readable foreground, middle ground, and background geography. ${cast ? 'Keep the principal character at roughly 20–35% of frame height so the production world remains dominant; no close-up, studio portrait, or full-frame fashion pose. The character participates in the location instead of posing against a blank backdrop.' : 'Keep the location empty, with no characters. Preserve the described architecture, landmarks and entrances.'} Use one motivated feature-film camera position, physical lighting, real material response, and enough environmental context for later storyboard frames to inherit the same production world.

OUTPUT:
One clean ${input.aspectRatio || '16:9'} film frame with no grid, alternate poses, captions, subtitles, labels, logos, watermark, UI, or readable text.

${buildMediumLock(input.visualStyle)}

${buildImageCaptureContract(input.visualStyle)}`;
}

export function buildVideoContinuityRules(hasAudioReference: boolean) {
  const audioSync = hasAudioReference
    ? '\nFor scripted dialogue, mouth shapes and performance synchronize naturally to the matching character timbre reference.'
    : '';

  return `
PHYSICS: Continuous causality and believable body, cloth and prop weight. Preserve geography, light, screen direction and the dialogue eyeline axis/screen sides; cross it only through visible neutral movement.${audioSync}
CONSTRAINTS: Each identity appears once with stable face/body/hair/wardrobe. Timed fields are authoritative. Performance changes through breath, gaze, facial tension and weight shift; no stage acting or continuous shouting.`;
}

export function getStoryboardDuration(storyboard: Pick<Storyboard, 'videoDuration'>) {
  return Math.min(15, Math.max(5, storyboard.videoDuration || 5));
}
