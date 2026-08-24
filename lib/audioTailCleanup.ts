import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

export const STORY_AUDIO_TAIL_FADE_SECONDS = 0.35;

/** Reverse-fade-reverse avoids probing duration and guarantees a zero-amplitude cut. */
export function storyAudioTailFilter(seconds = STORY_AUDIO_TAIL_FADE_SECONDS): string {
  const duration = Math.max(0.05, Math.min(0.5, Number(seconds) || STORY_AUDIO_TAIL_FADE_SECONDS));
  return `areverse,afade=t=in:st=0:d=${duration.toFixed(3)},areverse`;
}

/**
 * Clean the final H3 audio block without touching the encoded video frames.
 * Story reserves at least 0.55 seconds after speech, so the 0.35-second tail
 * fade removes VAE/static residue without clipping an authored line.
 */
export async function smoothStoryVideoAudioTail(buffer: Buffer): Promise<Buffer> {
  if (!buffer.length) return buffer;
  const directory = await mkdtemp(path.join(tmpdir(), 'aid-audio-tail-'));
  const input = path.join(directory, 'input.mp4');
  const output = path.join(directory, 'output.mp4');
  try {
    await writeFile(input, buffer);
    await execFileAsync(process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-map', '0:v:0', '-map', '0:a:0',
      '-c:v', 'copy',
      '-af', storyAudioTailFilter(),
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      output,
    ], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    const cleaned = await readFile(output);
    return cleaned.length ? cleaned : buffer;
  } catch (error) {
    // Audio cleanup must never make an otherwise completed H3 result
    // impossible to download. Export performs the same cleanup as fallback.
    console.warn('[audio-tail] cleanup failed; returning original video:', error instanceof Error ? error.message : error);
    return buffer;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
