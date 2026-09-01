import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSeriesRequest } from '@/lib/series/store';
import { probeMedia } from '@/lib/companionVideoExportServer';
import { evaluateFilmEnding, type FilmEndingAudit } from '@/lib/filmEndingAudit';

export const runtime = 'nodejs';
export const maxDuration = 300;
const exec = promisify(execFile);

export async function POST(request: NextRequest) {
  let temporary = '';
  try {
    assertSeriesRequest(request);
    if (process.env.AID_LOCAL_COMPANION !== '1') throw new Error('末镜音频核验需要本机 Companion');
    const form = await request.formData();
    const video = form.get('video'), taskId = String(form.get('taskId') || '');
    const expected = String(form.get('expected') || '').slice(0, 10000);
    const key = String(form.get('fishAudioKey') || '');
    if (!(video instanceof Blob) || !video.size || video.size > 256 * 1024 * 1024 || !taskId) throw new Error('末镜核验缺少有效的视频或任务编号');
    if (!key) throw new Error('末镜核验需要已有 Fish Audio 设置；原视频已保留');
    const bytes = Buffer.from(await video.arrayBuffer());
    const mediaSha256 = createHash('sha256').update(bytes).digest('hex');
    const cacheId = createHash('sha256').update(JSON.stringify({ mediaSha256, expected, version: 1 })).digest('hex');
    const root = path.join(process.env.AID_COMPANION_DATA_DIR || os.tmpdir(), 'ending-audits');
    await mkdir(root, { recursive: true });
    const record = path.join(root, `${cacheId}.json`);
    const previous: FilmEndingAudit | undefined = await readFile(record, 'utf8').then(JSON.parse).catch(() => undefined);
    if (previous) return NextResponse.json({ audit: { ...previous, taskId } });
    temporary = await mkdtemp(path.join(root, 'work-'));
    const input = path.join(temporary, 'source.mp4'), audio = path.join(temporary, 'audio.mp3');
    await writeFile(input, bytes);
    const probe = await probeMedia(input);
    if (!probe.hasAudio || probe.duration > 30) throw new Error('末镜缺少声音轨道或长度不适合核验；原视频已保留');
    await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-xerror', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '24000', audio], { timeout: 55000, maxBuffer: 1024 * 1024 });
    const data = new FormData();
    data.append('audio', new Blob([new Uint8Array(await readFile(audio))], { type: 'audio/mpeg' }), 'audio.mp3');
    data.append('ignore_timestamps', 'false');
    let response: Response;
    try { response = await fetch('https://api.fish.audio/v1/asr', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: data, signal: AbortSignal.timeout(55000) }); }
    catch { throw new Error('末镜转写连接暂时失败；保留原视频，只重试核验'); }
    if (!response.ok) throw new Error(`末镜转写服务暂不可用（${response.status}）；保留原视频，只重试核验`);
    const asr = await response.json();
    const audit: FilmEndingAudit = { version: 1, taskId, mediaSha256, duration: probe.duration,
      ...evaluateFilmEnding(probe.duration, expected, asr), checkedAt: new Date().toISOString() };
    const pending = `${record}.${randomUUID()}.tmp`;
    await writeFile(pending, JSON.stringify(audit), { mode: 0o600 });
    await rename(pending, record);
    return NextResponse.json({ audit });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '末镜核验失败；原视频已保留' }, { status: 400 });
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined); }
}
