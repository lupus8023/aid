import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function generateTTS(text: string, voiceId: string | undefined, fishAudioKey: string): Promise<Buffer> {
  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${fishAudioKey}`,
      'Content-Type': 'application/json',
      'model': 's2-pro',
    },
    body: JSON.stringify({
      text,
      format: 'mp3',
      ...(voiceId ? { reference_id: voiceId } : {}),
    }),
  });
  if (!res.ok) throw new Error(`fish.audio error: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadBuffer(buffer: Buffer): Promise<string> {
  const base64 = `data:audio/mpeg;base64,${buffer.toString('base64')}`;
  const result = await cloudinary.uploader.upload(base64, {
    folder: 'aid-audio',
    resource_type: 'video',
  });
  return result.secure_url;
}

// lines: [{ text, voiceId, character }] in dialogue order
// Returns per-character audio files (one per unique character, lines concatenated)
export async function POST(request: NextRequest) {
  try {
    const { lines, fishAudioKey } = await request.json();
    if (!lines?.length || !fishAudioKey) {
      return NextResponse.json({ error: 'lines and fishAudioKey are required' }, { status: 400 });
    }

    // Group lines by character (preserving first-seen order)
    const characterOrder: string[] = [];
    const characterLines: Record<string, { text: string; voiceId?: string }[]> = {};
    for (const { character, text, voiceId } of lines) {
      if (!text?.trim()) continue;
      if (!characterLines[character]) {
        characterOrder.push(character);
        characterLines[character] = [];
      }
      characterLines[character].push({ text, voiceId });
    }

    // Generate and upload audio per character
    const characterAudios: { character: string; audioUrl: string }[] = [];
    for (const character of characterOrder) {
      const charLines = characterLines[character];
      const buffers: Buffer[] = [];
      for (const { text, voiceId } of charLines) {
        buffers.push(await generateTTS(text, voiceId, fishAudioKey));
      }
      const combined = Buffer.concat(buffers);
      const audioUrl = await uploadBuffer(combined);
      characterAudios.push({ character, audioUrl });
    }

    return NextResponse.json({ characterAudios });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate audio' }, { status: 500 });
  }
}
