import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { STORY_AUDIO_TAIL_FADE_SECONDS } from './audioTailCleanup';
import { clippedPacingSections, withFilmEndingPacing, type PacingSection } from './videoPacing';

export type CompanionExportClip = {
  clipId: string;
  name: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  segmentSha256: string;
  pacingSections?: PacingSection[];
  preserveEndingSeconds?: number;
};

export type CompanionExportJob = {
  version: 1;
  jobId: string;
  projectId: string;
  outputName: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  status: 'queued' | 'running' | 'retrying' | 'completed' | 'failed';
  progress: number;
  stage: string;
  attempts: number;
  error?: string;
  clips: CompanionExportClip[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

const activeJobs = new Map<string, Promise<void>>();
const MAX_JOB_ATTEMPTS = 3;
const COMMAND_ATTEMPTS = 3;
const COMMAND_TIMEOUT_MS = 20 * 60 * 1000;

function exportRoot(): string {
  return path.join(
    process.env.AID_COMPANION_DATA_DIR || path.join(os.tmpdir(), 'aid-companion'),
    'video-exports',
  );
}

export function safeStorageId(value: string): string {
  const raw = String(value || 'unknown');
  const readable = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
  return `${readable}-${createHash('sha256').update(raw).digest('hex').slice(0, 12)}`;
}

function projectDirectory(projectId: string): string {
  return path.join(exportRoot(), safeStorageId(projectId));
}

function segmentPath(projectId: string, clipId: string, sha256: string): string {
  return path.join(
    projectDirectory(projectId),
    'segments',
    `${safeStorageId(clipId)}-${sha256.slice(0, 24)}.mp4`,
  );
}

function jobsDirectory(projectId: string): string {
  return path.join(projectDirectory(projectId), 'jobs');
}

function jobDirectory(projectId: string, jobId: string): string {
  return path.join(jobsDirectory(projectId), safeStorageId(jobId));
}

function jobStatePath(projectId: string, jobId: string): string {
  return path.join(jobDirectory(projectId, jobId), 'job.json');
}

function jobOutputPath(job: CompanionExportJob): string {
  return path.join(jobDirectory(job.projectId, job.jobId), 'final.mp4');
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '未知错误');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 1200);
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
  await rename(temporary, filePath);
}

async function saveJob(job: CompanionExportJob): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await atomicWriteJson(jobStatePath(job.projectId, job.jobId), job);
}

export async function readExportJob(projectId: string, jobId: string): Promise<CompanionExportJob | null> {
  try {
    return JSON.parse(await readFile(jobStatePath(projectId, jobId), 'utf8')) as CompanionExportJob;
  } catch {
    return null;
  }
}

function validateSha256(value: string): string {
  const sha256 = String(value || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('片段校验值无效');
  return sha256;
}

export async function persistExportSegment(
  request: Request,
  projectId: string,
  clipId: string,
  expectedSha256: string,
): Promise<{ reused: boolean; size: number; sha256: string }> {
  if (!projectId || !clipId) throw new Error('缺少项目或片段标识');
  const sha256 = validateSha256(expectedSha256);
  const destination = segmentPath(projectId, clipId, sha256);
  await mkdir(path.dirname(destination), { recursive: true });

  try {
    const existing = await stat(destination);
    if (existing.size > 0) return { reused: true, size: existing.size, sha256 };
  } catch {}

  if (!request.body) throw new Error('片段内容为空');
  const temporary = `${destination}.${process.pid}.${Date.now()}.part`;
  const hash = createHash('sha256');
  let size = 0;
  const checksum = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body as never),
      checksum,
      createWriteStream(temporary, { flags: 'wx' }),
    );
    if (size <= 0) throw new Error('片段内容为空');
    const actual = hash.digest('hex');
    if (actual !== sha256) throw new Error('片段下载不完整，校验失败');
    await rename(temporary, destination);
    return { reused: false, size, sha256 };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeClip(input: CompanionExportClip): CompanionExportClip {
  const duration = Number(input.duration);
  const trimStart = Math.max(0, Number(input.trimStart) || 0);
  const trimEnd = Math.max(0, Number(input.trimEnd) || 0);
  if (!input.clipId || !Number.isFinite(duration) || duration <= 0 || duration > 6 * 60 * 60) {
    throw new Error('导出片段参数无效');
  }
  if (duration - trimStart - trimEnd < 0.05) throw new Error(`${input.name || input.clipId} 的有效时长过短`);
  const normalized: CompanionExportClip = {
    clipId: String(input.clipId),
    name: String(input.name || input.clipId).slice(0, 160),
    duration,
    trimStart,
    trimEnd,
    segmentSha256: validateSha256(input.segmentSha256),
    pacingSections: Array.isArray(input.pacingSections) ? input.pacingSections : undefined,
  };
  normalized.pacingSections = clippedPacingSections(normalized);
  return normalized;
}

export function exportJobId(clips: CompanionExportClip[], aspectRatio?: CompanionExportJob['aspectRatio']): string {
  const signature = clips.map(clip => ({
    id: clip.clipId,
    sha256: clip.segmentSha256,
    duration: Number(clip.duration.toFixed(3)),
    trimStart: Number(clip.trimStart.toFixed(3)),
    trimEnd: Number(clip.trimEnd.toFixed(3)),
    pacing: clippedPacingSections(clip).map(section => [
      Number(section.sourceStart.toFixed(3)),
      Number(section.sourceEnd.toFixed(3)),
      Number(section.rate.toFixed(2)),
      section.kind,
    ]),
  }));
  return `export-${createHash('sha256').update(JSON.stringify({ signature, aspectRatio })).digest('hex').slice(0, 24)}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).size > 0;
  } catch {
    return false;
  }
}

function ffmpegPath(): string {
  const configured = process.env.FFMPEG_PATH;
  if (!configured) throw new Error('Companion 未找到本机 FFmpeg');
  return configured;
}

function ffprobePath(): string {
  const configured = process.env.FFPROBE_PATH;
  if (!configured) throw new Error('Companion 未找到本机 FFprobe');
  return configured;
}

async function runCommand(executable: string, args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`命令运行超过 ${Math.round(timeoutMs / 60_000)} 分钟`));
    }, timeoutMs);
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_000);
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.trim().split('\n').slice(-8).join(' | ') || `命令退出码 ${code}`));
    });
  });
}

async function retryCommand(label: string, operation: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= COMMAND_ATTEMPTS; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < COMMAND_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, attempt * 900));
    }
  }
  throw new Error(`${label}连续重试 ${COMMAND_ATTEMPTS} 次仍失败：${cleanError(lastError)}`);
}

type MediaProbe = { width: number; height: number; hasAudio: boolean; duration: number };

function normalizeExportAspectRatio(value: unknown): CompanionExportJob['aspectRatio'] | undefined {
  return value === '16:9' || value === '9:16' || value === '1:1' ? value : undefined;
}

export function selectExportTarget(
  probes: Array<Pick<MediaProbe, 'width' | 'height'>>,
  aspectRatio?: CompanionExportJob['aspectRatio'],
): { width: number; height: number } {
  const first = probes[0];
  if (!first) throw new Error('没有可导出的片段');
  if (!aspectRatio) return { width: even(first.width), height: even(first.height) };

  const matches = (probe: Pick<MediaProbe, 'width' | 'height'>) => (
    aspectRatio === '9:16' ? probe.height > probe.width
      : aspectRatio === '16:9' ? probe.width > probe.height
        : Math.abs(probe.width - probe.height) <= Math.max(probe.width, probe.height) * 0.05
  );
  const matching = probes.find(matches);
  if (matching) return { width: even(matching.width), height: even(matching.height) };

  const ratio = aspectRatio === '9:16' ? 9 / 16 : aspectRatio === '16:9' ? 16 / 9 : 1;
  const pixels = Math.max(4, first.width * first.height);
  const height = Math.sqrt(pixels / ratio);
  return { width: even(height * ratio), height: even(height) };
}

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobePath(), [
      '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('媒体检查超时')); }, 30000);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(stderr || `FFprobe 退出码 ${code}`)); });
  });
  const streams = (JSON.parse(output).streams || []) as Array<Record<string, unknown>>;
  const video = streams.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('片段中没有视频轨道');
  const width = Number(video.width);
  const height = Number(video.height);
  if (!width || !height) throw new Error('无法读取片段分辨率');
  return { width, height, hasAudio: streams.some(stream => stream.codec_type === 'audio'), duration: Number(JSON.parse(output).format?.duration || video.duration || 0) };
}

async function isValidVideo(filePath: string): Promise<boolean> {
  try {
    if (!(await fileExists(filePath))) return false;
    await probeMedia(filePath);
    return true;
  } catch {
    return false;
  }
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

async function transcodeClip(
  input: string,
  output: string,
  clip: CompanionExportClip,
  target: { width: number; height: number },
): Promise<void> {
  const probe = await probeMedia(input);
  const pacingSections = clippedPacingSections(clip);
  const outputDuration = Math.max(0.05, pacingSections.reduce(
    (sum, section) => sum + (section.sourceEnd - section.sourceStart) / section.rate,
    0,
  ));
  const videoFilter = `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=24`;
  const args = ['-y', '-i', input];
  // Give the synthesized silent fallback an explicit duration; otherwise an
  // audio-less source is infinite and the filter graph cannot finish cleanly.
  if (!probe.hasAudio) args.push(
    '-f', 'lavfi', '-i',
    `anullsrc=channel_layout=stereo:sample_rate=48000:d=${clip.duration.toFixed(3)}`,
  );

  const videoInput = '0:v:0';
  const audioInput = probe.hasAudio ? '0:a:0' : '1:a:0';
  const filters: string[] = [];
  if (pacingSections.length > 1) {
    filters.push(`[${videoInput}]split=${pacingSections.length}${pacingSections.map((_section, index) => `[vsrc${index}]`).join('')}`);
    filters.push(`[${audioInput}]asplit=${pacingSections.length}${pacingSections.map((_section, index) => `[asrc${index}]`).join('')}`);
  }
  pacingSections.forEach((section, index) => {
    const videoSource = pacingSections.length > 1 ? `vsrc${index}` : videoInput;
    const audioSource = pacingSections.length > 1 ? `asrc${index}` : audioInput;
    const start = section.sourceStart.toFixed(3);
    const end = section.sourceEnd.toFixed(3);
    const rate = section.rate.toFixed(2);
    filters.push(`[${videoSource}]trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${rate}[v${index}]`);
    filters.push(`[${audioSource}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,atempo=${rate}[a${index}]`);
  });
  if (pacingSections.length > 1) {
    filters.push(`${pacingSections.map((_section, index) => `[v${index}][a${index}]`).join('')}concat=n=${pacingSections.length}:v=1:a=1[vpaced][apaced]`);
  } else {
    filters.push('[v0]null[vpaced]');
    filters.push('[a0]anull[apaced]');
  }
  filters.push(`[vpaced]${videoFilter}[vout]`);
  filters.push(`[apaced]apad=pad_dur=0.100,atrim=end=${outputDuration.toFixed(3)},afade=t=out:st=${Math.max(0, outputDuration - STORY_AUDIO_TAIL_FADE_SECONDS).toFixed(3)}:d=${STORY_AUDIO_TAIL_FADE_SECONDS.toFixed(3)}[aout]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-t', outputDuration.toFixed(3),
    '-shortest', '-movflags', '+faststart', output,
  );
  await runCommand(ffmpegPath(), args);
}

async function runExportOnce(job: CompanionExportJob): Promise<void> {
  const directory = jobDirectory(job.projectId, job.jobId);
  const normalizedDirectory = path.join(directory, 'normalized');
  await mkdir(normalizedDirectory, { recursive: true });

  const inputs = job.clips.map(clip => segmentPath(job.projectId, clip.clipId, clip.segmentSha256));
  for (const input of inputs) {
    if (!(await isValidVideo(input))) throw new Error('本地片段缺失或损坏，请重新下载该片段');
  }
  const probes = await Promise.all(inputs.map(probeMedia));
  const target = selectExportTarget(probes, job.aspectRatio);
  const normalized: string[] = [];

  for (let index = 0; index < job.clips.length; index += 1) {
    const output = path.join(normalizedDirectory, `${String(index).padStart(3, '0')}.mp4`);
    normalized.push(output);
    job.progress = 12 + Math.round((index / job.clips.length) * 68);
    job.stage = `本机处理片段 ${index + 1}/${job.clips.length}`;
    await saveJob(job);
    if (await isValidVideo(output)) continue;
    await rm(output, { force: true }).catch(() => undefined);
    await retryCommand(`片段 ${index + 1} 转码`, async () => {
      await rm(output, { force: true }).catch(() => undefined);
      await transcodeClip(inputs[index], output, job.clips[index], target);
      if (!(await isValidVideo(output))) throw new Error('转码结果校验失败');
    });
  }

  const concatList = path.join(directory, 'concat.txt');
  // Keep concat entries relative to the list file. Absolute Windows paths use
  // drive-letter colons and backslashes that FFmpeg's concat parser can treat
  // as a protocol or escape sequence.
  await writeFile(
    concatList,
    normalized.map((_file, index) => `file 'normalized/${String(index).padStart(3, '0')}.mp4'`).join('\n') + '\n',
    'utf8',
  );
  const output = jobOutputPath(job);
  const temporaryOutput = `${output}.part.mp4`;
  job.progress = 86;
  job.stage = '本机 FFmpeg 合并片段';
  await saveJob(job);
  await retryCommand('成片合并', async () => {
    await rm(temporaryOutput, { force: true }).catch(() => undefined);
    await runCommand(ffmpegPath(), [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
      '-c', 'copy', '-movflags', '+faststart', temporaryOutput,
    ]);
    if (!(await isValidVideo(temporaryOutput))) throw new Error('合并结果校验失败');
  });
  await rm(output, { force: true }).catch(() => undefined);
  await rename(temporaryOutput, output);
}

async function runExportJob(job: CompanionExportJob): Promise<void> {
  let lastError: unknown;
  for (let attempt = Math.max(1, job.attempts + 1); attempt <= MAX_JOB_ATTEMPTS; attempt += 1) {
    job.attempts = attempt;
    job.status = attempt === 1 ? 'running' : 'retrying';
    job.error = undefined;
    job.stage = attempt === 1 ? '校验本地片段' : `自动恢复导出（第 ${attempt}/${MAX_JOB_ATTEMPTS} 次）`;
    await saveJob(job);
    try {
      await runExportOnce(job);
      job.status = 'completed';
      job.progress = 100;
      job.stage = '导出完成，片段已保存在本机';
      job.completedAt = new Date().toISOString();
      await saveJob(job);
      return;
    } catch (error) {
      lastError = error;
      job.error = cleanError(error);
      if (attempt < MAX_JOB_ATTEMPTS) {
        job.status = 'retrying';
        job.stage = `导出失败，正在自动重试（${attempt}/${MAX_JOB_ATTEMPTS}）`;
        await saveJob(job);
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
  }
  job.status = 'failed';
  job.progress = Math.min(job.progress, 99);
  job.stage = '自动重试后仍未完成';
  job.error = cleanError(lastError);
  await saveJob(job);
}

export function ensureExportJobRunning(job: CompanionExportJob): void {
  const key = `${job.projectId}:${job.jobId}`;
  if (activeJobs.has(key) || job.status === 'completed' || job.status === 'failed') return;
  const task = runExportJob(job)
    .catch(async error => {
      job.status = 'failed';
      job.error = cleanError(error);
      job.stage = '导出任务异常停止';
      await saveJob(job).catch(() => undefined);
    })
    .finally(() => activeJobs.delete(key));
  activeJobs.set(key, task);
}

export async function createOrResumeExportJob(
  projectId: string,
  clipsInput: CompanionExportClip[],
  outputName?: string,
  requestedAspectRatio?: unknown,
): Promise<CompanionExportJob> {
  if (!projectId || !Array.isArray(clipsInput) || clipsInput.length === 0 || clipsInput.length > 200) {
    throw new Error('导出项目或片段列表无效');
  }
  const clips = withFilmEndingPacing(clipsInput.map(normalizeClip));
  const aspectRatio = normalizeExportAspectRatio(requestedAspectRatio);
  for (const clip of clips) {
    await access(segmentPath(projectId, clip.clipId, clip.segmentSha256));
  }
  const jobId = exportJobId(clips, aspectRatio);
  const existing = await readExportJob(projectId, jobId);
  if (existing?.status === 'completed' && await isValidVideo(jobOutputPath(existing))) return existing;

  const now = new Date().toISOString();
  const job: CompanionExportJob = existing ? {
    ...existing,
    clips,
    outputName: String(outputName || existing.outputName || 'AID-Story.mp4').slice(0, 180),
    aspectRatio,
    status: 'queued',
    attempts: existing.status === 'failed' ? 0 : existing.attempts,
    error: undefined,
    stage: existing.status === 'failed' ? '重新尝试未完成的导出' : '恢复未完成的导出',
  } : {
    version: 1,
    jobId,
    projectId,
    outputName: String(outputName || 'AID-Story.mp4').slice(0, 180),
    aspectRatio,
    status: 'queued',
    progress: 8,
    stage: '片段已保存，准备本机合并',
    attempts: 0,
    clips,
    createdAt: now,
    updatedAt: now,
  };
  await saveJob(job);
  ensureExportJobRunning(job);
  return job;
}

export async function recoverExportJob(projectId: string, jobId: string): Promise<CompanionExportJob | null> {
  const job = await readExportJob(projectId, jobId);
  if (job && ['queued', 'running', 'retrying'].includes(job.status)) ensureExportJobRunning(job);
  return job;
}

export async function exportDownloadInfo(projectId: string, jobId: string): Promise<{
  job: CompanionExportJob;
  filePath: string;
  size: number;
}> {
  const job = await readExportJob(projectId, jobId);
  if (!job || job.status !== 'completed') throw new Error('成片尚未完成');
  const filePath = jobOutputPath(job);
  const file = await stat(filePath);
  if (!file.size) throw new Error('成片文件为空');
  return { job, filePath, size: file.size };
}

export function exportFileStream(filePath: string): ReadableStream {
  return Readable.toWeb(createReadStream(filePath)) as ReadableStream;
}
