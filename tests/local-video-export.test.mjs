import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

test('Companion persists, reuses, retries and natively merges local clips', { timeout: 120_000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'aid-local-export-test-'));
  const ffmpeg = require('ffmpeg-static');
  const ffprobe = require('ffprobe-static').path;
  process.env.AID_COMPANION_DATA_DIR = temporary;
  process.env.FFMPEG_PATH = ffmpeg;
  process.env.FFPROBE_PATH = ffprobe;

  try {
    const sourceFiles = [path.join(temporary, 'red.mp4'), path.join(temporary, 'blue.mp4')];
    await execFileAsync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=0.7:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.7',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourceFiles[0],
    ]);
    await execFileAsync(ffmpeg, [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=180x320:d=0.7:r=24',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourceFiles[1],
    ]);

    const server = await import('../lib/companionVideoExportServer.ts');
    const projectId = 'recoverable-project';
    const clips = [];
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const bytes = await readFile(sourceFiles[index]);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const makeRequest = () => new Request('http://127.0.0.1/segment', {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
        body: bytes,
      });
      const first = await server.persistExportSegment(makeRequest(), projectId, `clip-${index}`, sha256);
      const reused = await server.persistExportSegment(makeRequest(), projectId, `clip-${index}`, sha256);
      assert.equal(first.reused, false);
      assert.equal(reused.reused, true);
      clips.push({
        clipId: `clip-${index}`,
        name: `Clip ${index}`,
        duration: 0.7,
        trimStart: index === 1 ? 0.05 : 0,
        trimEnd: 0,
        segmentSha256: sha256,
      });
    }

    const created = await server.createOrResumeExportJob(projectId, clips, 'recovered-film.mp4', '9:16');
    let job = created;
    const deadline = Date.now() + 90_000;
    while (job.status !== 'completed' && job.status !== 'failed' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      job = await server.readExportJob(projectId, created.jobId);
    }
    assert.equal(job.status, 'completed', job.error);
    assert.equal(job.progress, 100);
    const download = await server.exportDownloadInfo(projectId, created.jobId);
    assert.ok((await stat(download.filePath)).size > 0);
    const { stdout: dimensions } = await execFileAsync(ffprobe, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', download.filePath,
    ]);
    const [width, height] = dimensions.trim().split(',').map(Number);
    assert.ok(height > width, `expected portrait export, received ${width}x${height}`);

    const resumed = await server.createOrResumeExportJob(projectId, clips, 'recovered-film.mp4', '9:16');
    assert.equal(resumed.status, 'completed');
    assert.equal(resumed.jobId, created.jobId);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
