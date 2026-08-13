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

async function uploadBuffer(buffer: Buffer): Promise<{ url: string; duration: number }> {
  const base64 = `data:audio/mpeg;base64,${buffer.toString('base64')}`;
  const result = await cloudinary.uploader.upload(base64, {
    folder: 'aid-audio',
    resource_type: 'video',
  });
  return { url: result.secure_url, duration: result.duration ?? 0 };
}

// lines: [{ text, voiceId, character }] in dialogue order
// Returns per-character audio files (one per unique character, lines concatenated)
export async function POST(request: NextRequest) {
  try {
    const { lines, fishAudioKey } = await request.json();
    if (!lines?.length || !fishAudioKey) {
      return NextResponse.json({ error: 'lines and fishAudioKey are required' }, { status: 400 });
    }

    const normalizedLines = lines.filter(({ text }: { text?: string }) => text?.trim());

    // Generate once in dialogue order so ComfyUI can receive one exact segment track.
    const generatedLines: { character: string; buffer: Buffer }[] = [];
    for (const { character, text, voiceId } of normalizedLines) {
      generatedLines.push({ character, buffer: await generateTTS(text, voiceId, fishAudioKey) });
    }

    // Group the same generated lines by character for providers that use voice references.
    const characterOrder: string[] = [];
    const characterBuffers: Record<string, Buffer[]> = {};
    for (const { character, buffer } of generatedLines) {
      if (!characterBuffers[character]) {
        characterOrder.push(character);
        characterBuffers[character] = [];
      }
      characterBuffers[character].push(buffer);
    }

    // Generate and upload audio per character
    const characterAudios: { character: string; audioUrl: string; audioDuration: number }[] = [];
    for (const character of characterOrder) {
      const combined = Buffer.concat(characterBuffers[character]);
      const { url: audioUrl, duration: audioDuration } = await uploadBuffer(combined);
      characterAudios.push({ character, audioUrl, audioDuration });
    }

    const segmentAudio = characterAudios.length === 1
      ? { url: characterAudios[0].audioUrl, duration: characterAudios[0].audioDuration }
      : await uploadBuffer(Buffer.concat(generatedLines.map(item => item.buffer)));

    return NextResponse.json({
      characterAudios,
      audioUrl: segmentAudio.url,
      audioDuration: segmentAudio.duration,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate audio' }, { status: 500 });
  }
}
