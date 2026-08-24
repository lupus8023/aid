import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import test from 'node:test';

import { smoothStoryVideoAudioTail, storyAudioTailFilter } from '../lib/audioTailCleanup.ts';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

test('uses a duration-independent reverse fade for H3 tail cleanup', () => {
  assert.equal(storyAudioTailFilter(), 'areverse,afade=t=in:st=0:d=0.050,areverse');
  assert.equal(storyAudioTailFilter(5), 'areverse,afade=t=in:st=0:d=0.500,areverse');
});

test('cleans an MP4 audio tail while stream-copying its video', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aid-tail-test-'));
  const ffmpeg = require('ffmpeg-static');
  process.env.FFMPEG_PATH = ffmpeg;
  const input = path.join(directory, 'input.mp4');
  try {
    await execFileAsync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x160:d=1:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=6000:duration=1',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input,
    ]);
    const original = await readFile(input);
    const cleaned = await smoothStoryVideoAudioTail(original);
    assert.ok(cleaned.length > 0);
    assert.notDeepEqual(cleaned, original);
    await writeFile(path.join(directory, 'cleaned.mp4'), cleaned);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
