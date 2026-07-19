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
    const firstBreak = Math.max(1, Math.floor(duration / 3));
    const secondBreak = Math.max(firstBreak + 1, Math.floor(duration * 2 / 3));

    const prompt = `You are a professional cinematographer and animation director writing a ${duration}-second AI image-to-video prompt. The input image is the visual authority and may be live action, CG, anime, illustration, stop motion, or mixed technique. Preserve its medium; never force a different one. Every prompt must produce KINETIC, PRECISELY TIMED motion — specific camera mechanics, not vague intentions.

## Shot Information
Scene ${storyboard.sceneNumber}: ${storyboard.description}
Context: ${storyboard.prompt}

## CAMERA AESTHETIC — Equipment defects for realism
Choose the appropriate equipment feel, then apply its physical defects:
- **2000s DV camcorder**: moderate handheld shake, autofocus hunting, lens breathing, exposure fluctuation in sun/shadow transitions, slight motion blur, minor rolling shutter, medium compression artifacts, faded colors, soft contrast, light sensor noise. NO stabilization. NO cinematic camera movements. NO modern color grading.
- **Professional documentary**: subtle handheld breathing, smooth focus pulls, natural color temperature shifts, real-world lighting imperfections
- **Modern commercial**: polished but not perfect — minimal shake, occasional exposure adjustment, natural physics

NEGATIVE CONSTRAINTS (critical — prevents AI defaults):
- NO cinematic camera movements or perfect stabilization
- NO modern color grading or commercial polish
- NO perfect composition or beauty-filter smoothing
- NO exaggerated emotions or theatrical performance

## PACING — Choose before writing
- **FAST** (action/shock/chase): explosive weight shifts, zero hesitation, sharp muscle tension; camera: whip pan, snap dolly push, urgent handheld shake, fast arc
- **MEDIUM** (conversation/discovery): natural gait, controlled gestures, eye contact; camera: smooth tracking, gentle arc, breathing Steadicam
- **SLOW** (grief/awe/intimacy/dread): micro-tremors only — finger curl, slow blink, chest rise; camera: imperceptible creep, glacial pull-back, locked-off hold

## CAMERA MOVEMENT — Always specify ALL of these:
**Speed**: instant / snap (0–0.2s) | quick (0.2–0.5s) | moderate (0.5–1.5s) | slow (1.5–3s) | glacial (3s+)
**Easing**: linear | ease-in (starts slow, accelerates) | ease-out (decelerates into hold) | ease-in-out (smooth S-curve) | snap-hold (instant move, hard stop)
**Amplitude**: micro (1–3cm / 1–3°) | small (5–10cm / 5–10°) | medium (20–50cm / 15–30°) | large (1–2m / 45°+)
**Path**: straight axis push/pull | curved arc (concave/convex) | spiral | pendulum swing | floating drift

## REQUIRED OUTPUT STRUCTURE

Line 1: PACE: [FAST/MEDIUM/SLOW] — [one-line scene energy statement]

[00-${firstBreak}s] [Shot size and perspective/lens behavior appropriate to the source medium]. [Camera move: speed + easing + amplitude + path]. [Subject action with weight, pose, or deformation specifics].

[${firstBreak}-${secondBreak}s] [Camera continues or transitions: exact mechanics]. [Subject action develops — body tension, eye line, contact point].

[${secondBreak}-${duration}s] [Final camera state: speed + easing + hold]. [Subject resolves into a deliberate final state; never end mid-action].

Lighting: [source direction + quality]. DOF: [aperture feel]. Grain/format: [24fps film grain / clean 4K].

Audio: Natural ambient sound only — [specific environmental sounds appropriate to scene: birds, wind, footsteps, fabric rustle, distant traffic, breathing]. NO music. NO sound design. NO narration.

## EXAMPLES

PACE: FAST — explosive confrontation, no room to breathe
[00-01s] MCU, 35mm. Snap dolly push-in (instant ease-in, 40cm straight axis). Subject's torso lurches forward — weight slams onto front foot, jaw tightens, fists clench at sides.
[01-03s] Camera holds locked-off with micro handheld flutter (±2mm, random). Subject's arm snaps up in a single hard movement — elbow fully extended, finger pointing off-screen right. Shoulder muscles visibly strain.
[03-04s] Slow ease-out pull-back (1.5s, 30cm, straight axis). Subject holds rigid pose, then chest deflates in one sharp exhale. Eyes stay locked forward. Hard hold.
Lighting: harsh overhead practical, hard shadows under brow. DOF: f/2.8 shallow. 24fps, film grain.

---

PACE: SLOW — suffocating grief, time has stopped
[00-03s] CU, 85mm. Glacial creep inward (3s, ease-in-out, 8cm straight axis, barely perceptible). Subject's eyes downcast — a single slow blink, lashes wet. No other movement.
[03-05s] Camera locks off completely. Subject's hand, resting on a surface, curls one finger inward — micro-movement, 2cm arc. Breath is held, then releases as near-silent exhale that barely moves the chest.
[05-06s] Micro pull-back (1s, ease-out, 5cm). Eyes lift fractionally — not to look at anything, just upward. Hold.
Lighting: soft diffused window light from screen left, cool tone. DOF: f/1.8 extreme shallow, background dissolved. 24fps, heavy grain.

## RULES
- Every camera move must name: speed + easing curve + amplitude + path direction
- Never write "the camera moves" — write exactly HOW it moves
- Subject actions: name the specific muscles, weight shifts, contact points
- Do NOT redesign appearance, costume, or art style. Describe only continuity-critical movement.
- Live action uses believable biomechanics and subtle micro-expression; stylized/CG subjects use motion consistent with their design and animation language. Do not add pores or photographic realism to stylized work.
- Cover exactly 00-${duration}s with no gaps, overlaps, extra shots, or timestamps beyond the duration.
- Do NOT add music, subtitles, or sound effects
- Apply equipment defects consistently throughout the shot (shake, focus hunting, exposure shifts)
- Character descriptions must be concrete and visual: NO abstract adjectives like "fashionable" or "attractive". Use specific clothing, hairstyle, accessories instead.
- Output ONLY the prompt — no labels, no section headers

Write the prompt for Scene ${storyboard.sceneNumber}:`;

    const videoPrompt = await chatCompletion(prompt, apiKey);
    return NextResponse.json({ videoPrompt: videoPrompt.trim() });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate video prompt' }, { status: 500 });
  }
}
