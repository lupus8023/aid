import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/apimart';
import { getStoryboardDuration } from '@/lib/promptArchitecture';

export async function POST(request: NextRequest) {
  try {
    const { storyboard, apiKey } = await request.json();
    if (!storyboard || !apiKey) {
      return NextResponse.json({ error: 'storyboard and apiKey are required' }, { status: 400 });
    }

    const duration = getStoryboardDuration(storyboard);
    const durationStr = duration < 10 ? `0${duration}` : `${duration}`;

    const prompt = `You are a professional cinematographer and animation director writing a structured ${duration}-second video director's brief. The input image is the visual authority — preserve its exact medium (live action, CG, anime, illustration) without conversion.

## Shot Input
Scene ${storyboard.sceneNumber}: ${storyboard.description}
Context: ${storyboard.prompt}

## Required Output Structure
Write exactly these sections in order. Be specific and concrete. Never use abstract adjectives (beautiful, elegant, stunning, cinematic). Describe only what a camera can capture or a body can perform.

---

GOAL:
One sentence: the shot type, emotional purpose, and how it should feel to watch.

CHARACTER:
Use the uploaded reference image as the exact character authority. Preserve the same facial identity, age, skin tone, eye shape, hairstyle, makeup, body proportions, clothing, and accessories throughout the entire video.
[One concrete identifying line with specific clothing colors and textures, hairstyle detail, visible accessories — no abstract praise.]

LOCATION:
[Specific place. Time of day. Direction of the light source. Key architectural or natural elements. Background details. Spatial density and atmosphere. Write only environment — no action, no camera.]

LOOK:
[Visual material quality only — separate from camera movement. Include: color palette, contrast level, film or tape format feel, grain or texture, highlight rendering, depth-of-field character, skin quality, any format-specific artifacts. Describe what the image is made of, not what happens in it.]

CAMERA:
[Camera type and its physical defects. Specify: lens focal length, handheld behavior, autofocus behavior, exposure behavior, stabilization level. Give the camera a personality — how it makes imperfect but motivated choices. One movement per shot: name speed + easing curve + amplitude + path direction.]

STYLE:
[FAST / MEDIUM / SLOW. Editing rhythm. Emotional arc from opening to close. Narrative point of view. Keep this separate from Look — Style is about pacing and story logic, not visual texture.]

AUDIO:
Natural ambient sound only. List the specific sounds that are present. Then explicitly list what is absent. No internal conflicts.

STORYBOARD — ${duration}s:

[00:00–00:Xs] | [Location] | [Shot size, lens] | [Light quality]
[Subject does one specific action: name the body part, movement direction, weight shift, or contact point.]
[Camera does one specific movement: speed + easing + amplitude + path.]
[Sound note for this shot.]

[Continue, covering 00:00 to 00:${durationStr} with no gaps.]

---

## Shot Count Guide
${duration <= 6 ? `- ${duration}s total → 2 shots` : duration <= 10 ? `- ${duration}s total → 3 shots` : `- ${duration}s total → 4–5 shots`}
Each shot: 1.5–3 seconds. No shot should try to contain more than one primary action.

## Performance: Convert States to Actions
Visible actions only — no internal states:
- NOT: "she looks confident" → YES: "raises her chin slightly, shoulders square back, one slow exhale visible"
- NOT: "he's nervous" → YES: "fidgets with sleeve hem, gaze drops briefly then returns, jaw tightens"
- NOT: "she smiles" → YES: "corners of her mouth lift as her eyes narrow slightly"
One body action per shot. Name the body part and direction.

## Camera Move Specification
Every camera movement must state all four properties:
- Speed: instant (0–0.2s) | quick (0.2–0.5s) | moderate (0.5–1.5s) | slow (1.5–3s) | glacial (3s+)
- Easing: linear | ease-in | ease-out | ease-in-out | snap-hold
- Amplitude: micro (1–3 cm/°) | small (5–10 cm/5–10°) | medium (20–50 cm/15–30°) | large (1–2 m/45°+)
- Path: straight push/pull | curved arc | spiral | pendulum | floating drift

## Examples

GOAL:
A forgotten MiniDV home video from 2004 — warm, imperfect, and completely authentic.

CHARACTER:
Use the uploaded reference image as the exact character authority. Preserve facial identity, age, skin tone, hairstyle, and appearance throughout.
Young woman, faded charcoal sleeveless crop top, high-waist light-wash denim jeans, loose black hair with wispy bangs, natural daily makeup.

LOCATION:
A quiet beach on Jeju Island, early summer morning. Soft golden sunlight from screen left. Black volcanic rocks, clear turquoise water, wet sand. A few distant fishermen. Uncrowded.

LOOK:
Soft analog tape texture, slight blur, faint tape grain, blooming highlights, auto-exposure flicker, muted contrast, lifelike skin tones, subtle MiniDV compression artifacts.

CAMERA:
Early-2000s Sony MiniDV camcorder. Heavy handheld shake, imperfect framing, autofocus hunting between the waves and her face, exposure pumping toward the bright ocean, no stabilization. The camcorder itself is never visible.

STYLE:
SLOW. Unedited single take. Mood: warm nostalgia building to quiet joy. Observational — the operator is a family member, not a professional.

AUDIO:
Present: gentle waves, seabirds, light wind, distant fishermen talking, footsteps on wet sand, water splashing, rustling fabric.
Absent: music, narration, sound effects.

STORYBOARD — 8s:

[00:00–00:03] | Beach shoreline | Medium handheld, 35mm equivalent | Warm golden backlight
She walks barefoot along the wet sand, sandals held loosely in one hand at her side. Small waves wash over her feet — she pauses, toes curling into the sand.
Camera drifts slightly left (moderate ease-in-out, small amplitude, floating drift), autofocus briefly hunts to the water surface before snapping back to her face.
Waves, wind, fabric rustle.

[00:03–00:08] | Same beach | Close handheld, 50mm | Soft diffused light from screen left
She crouches, picks up a seashell, brushes sand from it with her thumb — a single deliberate gesture, weight shifting onto her left foot.
Camera creeps closer (glacial, ease-in-out, micro amplitude, straight push), slight autofocus breathing as she moves. Exposure pumps briefly as her face moves into backlight.
Water, her quiet exhale, distant voices.

---

## Output Rules
- Output ONLY the sections above — no labels, no commentary, no preamble, no preamble sentence before GOAL
- Do NOT write PHYSICS or CONSTRAINTS sections — those are added separately
- Live action: believable biomechanics and micro-expression; no smoothing, no beauty-filter descriptions
- Stylized/CG: motion consistent with the design and animation language — no forced photorealism

Write the director's brief for Scene ${storyboard.sceneNumber}:`;

    const videoPrompt = await chatCompletion(prompt, apiKey);
    return NextResponse.json({ videoPrompt: videoPrompt.trim() });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate video prompt' }, { status: 500 });
  }
}
