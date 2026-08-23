import { NextRequest, NextResponse } from 'next/server';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

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

async function uploadBuffer(buffer: Buffer, mimeType = 'audio/mpeg'): Promise<{ url: string; duration: number }> {
  const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
  const result = await uploadToCloudinary(base64, {
    folder: 'aid-audio',
    resource_type: 'video',
  });
  return { url: result.secure_url, duration: result.duration ?? 0 };
}

async function composeTimedDialogueTrack(
  lines: Array<{ buffer: Buffer; startSeconds?: number }>,
  duration: number,
): Promise<Buffer | undefined> {
  if (!lines.length || !Number.isFinite(duration) || duration <= 0) return undefined;
  const directory = await mkdtemp(path.join(tmpdir(), 'aid-dialogue-track-'));
  try {
    const inputs: string[] = [];
    const delayed: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const filename = path.join(directory, `line-${index + 1}.mp3`);
      await writeFile(filename, lines[index].buffer);
      inputs.push('-i', filename);
      const delayMs = Math.max(0, Math.round(Number(lines[index].startSeconds || 0) * 1000));
      delayed.push(`[${index}:a]adelay=${delayMs}:all=1[a${index}]`);
    }
    const output = path.join(directory, 'dialogue-track.wav');
    const mixInputs = lines.map((_, index) => `[a${index}]`).join('');
    const safeDuration = Math.max(2, Math.min(15, duration));
    const filter = `${delayed.join(';')};${mixInputs}amix=inputs=${lines.length}:duration=longest:normalize=0,apad=whole_dur=${safeDuration.toFixed(3)},atrim=0:${safeDuration.toFixed(3)}[out]`;
    await execFileAsync(process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg', [
      '-y', ...inputs,
      '-filter_complex', filter,
      '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le',
      output,
    ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// lines: [{ text, voiceId, character }] in dialogue order
// Returns per-character audio files (one per unique character, lines concatenated)
export async function POST(request: NextRequest) {
  try {
    const { lines, fishAudioKey, duration } = await request.json();
    if (!lines?.length || !fishAudioKey) {
      return NextResponse.json({ error: 'lines and fishAudioKey are required' }, { status: 400 });
    }

    const normalizedLines = lines.filter(({ text }: { text?: string }) => text?.trim());

    // Generate once in dialogue order so ComfyUI can receive one exact segment track.
    const generatedLines: { character: string; buffer: Buffer; startSeconds?: number }[] = [];
    for (const { character, text, voiceId, startSeconds } of normalizedLines) {
      generatedLines.push({ character, buffer: await generateTTS(text, voiceId, fishAudioKey), startSeconds });
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

    const timedTrack = await composeTimedDialogueTrack(generatedLines, Number(duration));
    const segmentAudio = timedTrack
      ? await uploadBuffer(timedTrack, 'audio/wav')
      : characterAudios.length === 1
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
