import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/apimart';

export async function POST(request: NextRequest) {
  try {
    const { storyboard, apiKey } = await request.json();
    if (!storyboard || !apiKey) {
      return NextResponse.json({ error: 'storyboard and apiKey are required' }, { status: 400 });
    }

    const prompt = `You are an expert video director specializing in AI video generation prompts. Your task is to write a professional video motion prompt for a single shot.

## Shot Information
Scene ${storyboard.sceneNumber}: ${storyboard.description}
Image prompt: ${storyboard.prompt}

## Your Task
Write a concise, professional video prompt (3-5 sentences) following this structure:

**1. Shot Type & Framing**
Choose one: Extreme close-up (ECU) / Close-up (CU) / Medium close-up (MCU) / Medium shot (MS) / Medium wide shot (MWS) / Wide shot (WS) / Extreme wide shot (EWS) / Over-the-shoulder (OTS) / POV shot

**2. Camera Movement**
Choose one or combine:
- Static (locked-off, tripod)
- Pan (horizontal rotation: pan left / pan right)
- Tilt (vertical rotation: tilt up / tilt down)
- Dolly/Track (physical movement: dolly in / dolly out / tracking left / tracking right)
- Crane/Jib (vertical arc movement: crane up / crane down)
- Handheld (organic, slightly unstable)
- Steadicam (smooth, flowing movement)
- Zoom (lens zoom in / zoom out)
- Orbit/Arc (circular movement around subject)
- Drone (aerial movement)

**3. Subject Action & Blocking**
Describe exactly what the subject does: specific body movements, gestures, facial expressions, direction of movement, speed (slow / normal / fast)

**4. Timing & Pacing**
Shot duration feel: slow and deliberate / normal pace / fast and dynamic
Transition feel: how the shot begins and ends

**5. Atmosphere**
Lighting changes, environmental motion (wind, particles, etc.), depth of field behavior

## Rules
- Be specific and technical, not vague
- Focus on MOTION, not static description (the image already handles visuals)
- Do NOT describe character appearance (already in the reference image)
- Do NOT mention art style
- Output ONLY the prompt text, no labels or headers

## Example Output
"Medium close-up shot. Camera slowly dollies in toward the subject over 4 seconds, starting at chest level and ending at a tight face frame. Subject turns head slightly left, eyes narrowing with a determined expression, lips pressed together. Right hand rises to touch collar in a subtle nervous gesture. Pacing is deliberate and tense. Shallow depth of field gradually blurs the background further as camera advances. Soft natural light from the left window creates gentle shadow movement across the face."

Now write the video prompt for Scene ${storyboard.sceneNumber}:`;

    const videoPrompt = await chatCompletion(prompt, apiKey);
    return NextResponse.json({ videoPrompt: videoPrompt.trim() });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate video prompt' }, { status: 500 });
  }
}
