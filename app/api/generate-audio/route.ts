import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Generate TTS for one line and return raw buffer
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

// lines: [{ text, voiceId }] in dialogue order
export async function POST(request: NextRequest) {
  try {
    const { lines, fishAudioKey } = await request.json();
    if (!lines?.length || !fishAudioKey) {
      return NextResponse.json({ error: 'lines and fishAudioKey are required' }, { status: 400 });
    }

    // Generate each line sequentially, then concat buffers
    const buffers: Buffer[] = [];
    for (const { text, voiceId } of lines) {
      if (text?.trim()) {
        buffers.push(await generateTTS(text, voiceId, fishAudioKey));
      }
    }

    const combined = Buffer.concat(buffers);
    const base64 = `data:audio/mpeg;base64,${combined.toString('base64')}`;

    const result = await cloudinary.uploader.upload(base64, {
      folder: 'aid-audio',
      resource_type: 'video',
    });

    return NextResponse.json({ audioUrl: result.secure_url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate audio' }, { status: 500 });
  }
}
