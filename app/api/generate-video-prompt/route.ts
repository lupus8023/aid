import { NextRequest, NextResponse } from 'next/server';
import { chatCompletion } from '@/lib/apimart';

export async function POST(request: NextRequest) {
  try {
    const { storyboard, apiKey } = await request.json();
    if (!storyboard || !apiKey) {
      return NextResponse.json({ error: 'storyboard and apiKey are required' }, { status: 400 });
    }

    const prompt = `You are a professional cinematographer and film director writing AI video generation prompts. Your prompts must produce CINEMATIC shots — not just "images that move", but real film language with intentional camera work, blocking, and staging.

## Shot Information
Scene ${storyboard.sceneNumber}: ${storyboard.description}
Image prompt context: ${storyboard.prompt}

## Your Task
Write a professional cinematic video prompt following this EXACT structure (3-5 sentences):

**1. Shot Size + Lens**
Start with: [ECU / CU / MCU / MS / MLS / WS / EWS / OTS], [lens: 24mm / 35mm / 50mm / 85mm / telephoto]

**2. Camera Movement** (choose one, be specific)
- Static: "locked-off tripod shot"
- Dolly: "slow dolly in" / "camera pushes in over 4 seconds"
- Track: "lateral tracking shot following subject left to right"
- Crane: "camera cranes up revealing the environment below"
- Steadicam: "smooth Steadicam follow shot"
- Handheld: "handheld, slight natural shake, documentary intimacy"
- Arc: "camera slowly orbits 90 degrees around subject"
- Pull back reveal: "camera pulls back slowly to reveal wider context"

**3. Subject Blocking & Action**
Describe EXACTLY what the subject does with specific body language:
- Entry/exit: "enters frame from screen left", "walks toward camera"
- Timing: "slowly", "abruptly", "hesitates then", "in one fluid motion"
- Body: "shoulders tense", "hands trembling", "leans into the light"
- Eye line: "looks directly into camera", "gazes off-screen right at 30 degrees"
- Complete arc: action must have a clear beginning, middle, and natural resolution

**4. Lighting & Environment**
- Motivated lighting: where does light come from?
- Quality: "golden hour", "overcast diffused", "neon-lit", "candlelit", "chiaroscuro"
- Depth of field: "shallow DOF, background bokeh" / "deep focus, everything sharp"

**5. Technical & Mood**
End with: mood tone + "24fps, film grain" or "cinematic 4K" + aspect ratio if relevant

## Critical Rules
- Lead with shot type and camera movement — these are the most important
- Every camera movement must be MOTIVATED by the scene's emotion and narrative
- Blocking must feel like a real actor's performance, not random movement
- Do NOT describe character appearance (reference image handles that)
- Do NOT mention art style, animation, or rendering style
- The shot must feel COMPLETE — action resolves naturally, no abrupt cuts
- No background music, no sound effects, no subtitles
- Output ONLY the prompt text, no labels or section headers

## Examples of CINEMATIC vs NON-CINEMATIC

❌ Non-cinematic: "The character walks forward and looks around."
✅ Cinematic: "Medium shot, 50mm. Slow push in. Subject enters frame from screen left, pauses at center, weight shifting to one foot — a moment of hesitation. Eyes scan the space, then settle on something off-screen right. Motivated window light from left creates soft shadow across face. Shallow depth of field. Quiet dread. 24fps, film grain."

❌ Non-cinematic: "Camera shows the scene with the character doing the action."
✅ Cinematic: "Low angle medium wide shot, 35mm. Locked-off static. Subject crosses frame right to left in foreground, sharp. Background figure (soft, out of focus) watches without moving. Practical overhead fluorescent light, cold and institutional. Neither figure acknowledges the other. Tension held in stillness. 24fps."

Now write the cinematic video prompt for Scene ${storyboard.sceneNumber}:`;

    const videoPrompt = await chatCompletion(prompt, apiKey);
    return NextResponse.json({ videoPrompt: videoPrompt.trim() });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate video prompt' }, { status: 500 });
  }
}
