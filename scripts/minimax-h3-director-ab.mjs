import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import sharp from 'sharp';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';
const DEFAULT_FRAME = 'outputs/nana-broadcast-candid/nana-shanghai-clean-first-frame.png';
const DEFAULT_PROMPT = 'outputs/nana-broadcast-candid/h3-submitted-prompt.txt';
const DEFAULT_OUTPUT = 'outputs/minimax-h3-director-ab';
const DEFAULT_SEED = 8829421;
const FPS = 24;

export function h3FrameCount(seconds, fps = FPS) {
  const requested = Math.max(5, Math.round(Number(seconds) * fps));
  return requested + ((5 - (requested % 17)) + 17) % 17;
}

function node(classType, inputs, title = classType) {
  return { class_type: classType, inputs, _meta: { title } };
}

function timelineData({ groups, width, height, continuity }) {
  const totalFrames = groups.reduce((sum, group) => sum + h3FrameCount(group.duration), 0);
  return JSON.stringify({
    version: 5,
    editMode: 'segment',
    timelineMode: 'fl2v',
    totalFrames,
    frameRate: FPS,
    width,
    height,
    refMaxSize: Math.max(width, height),
    output: {
      mode: 'fixed',
      aspectRatio: '16:9 (宽屏)',
      width,
      height,
      longEdge: Math.max(width, height),
      maxExportFrames: 0,
      exportMode: 'all',
      audioMode: 'generate',
      continuityEnabled: continuity,
      continuityOverlapFrames: 22,
    },
    global: {
      taskType: 'fl2v — 首尾帧生视频(First-Last Frame)',
      prompt: '',
      refs: [],
      refAudios: [],
    },
    segments: groups.map((group, index) => ({
      id: `ab-${index + 1}`,
      start: groups.slice(0, index).reduce((sum, item) => sum + h3FrameCount(item.duration), 0),
      length: h3FrameCount(group.duration),
      frameCount: h3FrameCount(group.duration),
      durationSec: group.duration,
      prompt: group.prompt,
      continuityFromPrev: continuity && index > 0,
    })),
    runSelectEnabled: false,
    runSelection: [],
    liveTaePreview: false,
  });
}

function continuationPrompts(basePrompt) {
  const shared = basePrompt
    .replace(/<Picture 1> is the composition reference for \[Shot 1\]\.\n?/g, '')
    .replace(/<Picture 1> \(\[Shot 1\] composition\):[^\n]*\n?/g, '')
    .replace(/REFERENCE PRIORITY[^\n]*\n/g, '')
    .replace(/The shot follows <Picture 1> as its composition reference\.\s*/g, '')
    .replace(/From 00:00\.000 to 00:01\.760[^.]*\.[^\n]*/g, '')
    .replace(/From 00:00\.000 to 00:08\.000:/g, '')
    .trim();
  return [
    basePrompt.replace(/00:08\.000/g, '00:05.000'),
    `${shared}\n\nCONTINUATION: Begin from the previous generated segment's moving audiovisual tail. Nana continues past the window without looking at the camera. A foreground cyclist briefly crosses the long-lens frame; she adjusts the paper bag and keeps walking at natural speed. Preserve the same face, wardrobe, street geography, broadcast texture, ambience, and screen direction. No reset, repeated opening pose, morph, crossfade, subtitle, logo, or added dialogue.`,
    `${shared}\n\nCONTINUATION: Begin from the previous generated segment's moving audiovisual tail. Nana slows at the next display, gives one fleeting private glance, then exits the right edge while the observational camera lags slightly and settles on the living street. Preserve identity, wardrobe, lighting, street ambience, motion phase, and screen direction. Finish with natural room for the cut. No reset, repeated action, morph, crossfade, subtitle, logo, or added dialogue.`,
  ];
}

export function buildDirectorPrompt({
  caseName,
  remoteImage,
  promptText,
  outputPrefix,
  definitions,
  seed = DEFAULT_SEED,
  width = 864,
  height = 480,
}) {
  const isContinuity = caseName === 'continuity';
  const isRefine = caseName === 'refine';
  const groups = isContinuity
    ? continuationPrompts(promptText).map(prompt => ({ duration: 5, prompt }))
    : [{ duration: 8, prompt: promptText }];
  const totalFrames = groups.reduce((sum, group) => sum + h3FrameCount(group.duration), 0);
  const prompt = {};
  const hasSage = Boolean(definitions.MiniMaxH3MemoryEfficientSageAttentionPatch);
  const loraClass = definitions.LoraLoaderModelOnly
    ? 'LoraLoaderModelOnly'
    : definitions.LoraLoaderBypassModelOnly
      ? 'LoraLoaderBypassModelOnly'
      : '';
  if (!loraClass) throw new Error('Remote ComfyUI has no compatible model-only LoRA loader');

  prompt['1'] = node('UNETLoader', {
    unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    weight_dtype: 'default',
  }, 'Director clean FL2VA');
  prompt['2'] = hasSage
    ? node('MiniMaxH3MemoryEfficientSageAttentionPatch', { model: ['1', 0] }, 'Director Sage patch')
    : prompt['1'];
  const cleanModelId = hasSage ? '2' : '1';
  prompt['3'] = node(loraClass, {
    model: [cleanModelId, 0],
    lora_name: 'minimax_h3_turbo_4step_dasiwa_ref2va_hybrid_v1_T8.safetensors',
    strength_model: 1,
  }, 'Director DaSiWa 4-step LoRA');
  prompt['4'] = node('CLIPLoader', {
    clip_name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
    type: 'minimax',
    device: 'default',
  });
  prompt['5'] = node('VAELoader', { vae_name: 'minimax_h3_video_vae_fp16.safetensors' }, 'Video VAE');
  prompt['6'] = node('VAELoader', { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' }, 'Audio VAE');
  prompt['10'] = node('LoadImage', { image: remoteImage }, 'A/B first frame');

  groups.forEach((group, index) => {
    const id = String(20 + index);
    prompt[id] = node('MiniMaxH3DirectorGroupImageToVideo', {
      prompt: group.prompt,
      duration_sec: group.duration,
      ...(index === 0 ? { first_frame: ['10', 0] } : {}),
    }, `Director segment ${index + 1}`);
  });
  prompt['25'] = node('MiniMaxH3DirectorGroupsCombine', Object.fromEntries(
    groups.map((_, index) => [`groups.group_${index}`, [String(20 + index), 0]]),
  ));

  let refineLink;
  if (isRefine) {
    if (!definitions.MiniMaxH3DirectorRefine || !definitions.BasicScheduler) {
      throw new Error('Remote ComfyUI is missing Director Refine or BasicScheduler');
    }
    prompt['40'] = node('BasicScheduler', {
      model: [cleanModelId, 0], scheduler: 'beta', steps: 3, denoise: 0.2,
    }, 'Director refine sigmas');
    const latentOptions = definitions.MiniMaxH3DirectorRefine?.input?.required?.latent_upscale_model?.[0];
    const latentPlaceholder = Array.isArray(latentOptions) && latentOptions.length ? latentOptions[0] : 'put_latent_upscale_models_here';
    prompt['41'] = node('MiniMaxH3DirectorRefine', {
      mode: 'upscale',
      upscale_method: 'lanczos',
      latent_upscale_model: latentPlaceholder,
      sampler: 'euler',
      passes: 1,
      refine_model: [cleanModelId, 0],
      sigmas: ['40', 0],
      seed_mode: 'inherit',
      aspect_ratio: '自定义',
      megapixels: 1,
      width: 1344,
      height: 768,
      skip_fl2v: false,
      confirm_first_pass: false,
    });
    refineLink = ['41', 0];
  }

  prompt['30'] = node('MiniMaxH3Director', {
    model: ['3', 0],
    video_vae: ['5', 0],
    audio_vae: ['6', 0],
    clip: ['4', 0],
    i2v_groups: ['25', 0],
    ...(refineLink ? { refine: refineLink } : {}),
    task_type: 'fl2v — 首尾帧生视频(First-Last Frame)',
    global_prompt: '',
    bd_grp_sample: '采样设置',
    cfg: 1,
    seed,
    frame_rate: FPS,
    width,
    height,
    ref_max_size: Math.max(width, height),
    total_frames: totalFrames,
    timeline_data: timelineData({ groups, width, height, continuity: isContinuity }),
    steps: 4,
    sampler: 'res_multistep',
    scheduler: 'simple',
    shift_video: 12,
    shift_audio: 3,
    clear_vram_between_segments: true,
    export_source_images: false,
  });
  prompt['31'] = node('CreateVideo', {
    images: ['30', 0], audio: ['30', 1], fps: ['30', 2], bit_depth: 8,
  });
  prompt['32'] = node('SaveVideo', {
    video: ['31', 0], filename_prefix: outputPrefix, format: 'auto', codec: 'auto',
  });
  if (definitions.PreviewAny) prompt['33'] = node('PreviewAny', { source: ['30', 5] }, 'Director run report');
  return { prompt, groups, totalFrames };
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text.slice(0, 2000)}`);
  return data;
}

async function uploadImage(baseUrl, imagePath, subfolder) {
  const body = new FormData();
  body.append('image', new Blob([fs.readFileSync(imagePath)], { type: 'image/png' }), path.basename(imagePath));
  body.append('type', 'input');
  body.append('subfolder', subfolder);
  body.append('overwrite', 'true');
  const uploaded = await fetchJson(`${baseUrl}/upload/image`, { method: 'POST', body });
  return [uploaded.subfolder, uploaded.name].filter(Boolean).join('/');
}

function mediaOutputs(historyItem) {
  const files = [];
  for (const output of Object.values(historyItem?.outputs || {})) {
    for (const kind of ['videos', 'gifs', 'images']) {
      for (const item of output?.[kind] || []) files.push(item);
    }
  }
  return files;
}

function directorReport(historyItem) {
  const output = historyItem?.outputs?.['33'];
  const candidates = [output?.text, output?.string, output?.ui?.text].flat(Infinity).filter(value => typeof value === 'string');
  return candidates.join('\n').trim();
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function probeVideo(videoPath) {
  return JSON.parse(run(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', videoPath]));
}

async function compareImages(leftPath, rightPath) {
  const rightMeta = await sharp(rightPath).metadata();
  const width = rightMeta.width || 1;
  const height = rightMeta.height || 1;
  const left = await sharp(leftPath).resize(width, height, { fit: 'cover' }).removeAlpha().raw().toBuffer();
  const right = await sharp(rightPath).removeAlpha().raw().toBuffer();
  const length = Math.min(left.length, right.length);
  let squared = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = left[index] - right[index];
    squared += delta * delta;
  }
  return Math.sqrt(squared / Math.max(1, length));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function evaluateVideo(videoPath, firstFramePath, outputDir, seamTimes = []) {
  const probe = probeVideo(videoPath);
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  const audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration || video?.duration || 0);
  const framesDir = path.join(outputDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const firstOutput = path.join(framesDir, 'first.png');
  run(ffmpegPath, ['-y', '-i', videoPath, '-frames:v', '1', firstOutput]);
  const firstFrameRmse = await compareImages(firstFramePath, firstOutput);
  const firstStats = await sharp(firstOutput).stats();
  const seams = [];
  for (const seam of seamTimes) {
    const before = path.join(framesDir, `seam-${seam}-before.png`);
    const after = path.join(framesDir, `seam-${seam}-after.png`);
    run(ffmpegPath, ['-y', '-ss', String(Math.max(0, seam - 0.05)), '-i', videoPath, '-frames:v', '1', before]);
    run(ffmpegPath, ['-y', '-ss', String(seam + 0.05), '-i', videoPath, '-frames:v', '1', after]);
    seams.push({ time: seam, adjacentRmse: await compareImages(before, after) });
  }
  const ordinaryJumps = [];
  for (let second = 1; second < Math.floor(duration); second += 1) {
    if (seamTimes.some(seam => Math.abs(seam - second) < 0.35)) continue;
    const before = path.join(framesDir, `motion-${second}-before.png`);
    const after = path.join(framesDir, `motion-${second}-after.png`);
    run(ffmpegPath, ['-y', '-ss', String(second - 0.05), '-i', videoPath, '-frames:v', '1', before]);
    run(ffmpegPath, ['-y', '-ss', String(second + 0.05), '-i', videoPath, '-frames:v', '1', after]);
    ordinaryJumps.push(await compareImages(before, after));
  }
  const motionBaselineRmse = median(ordinaryJumps);
  for (const seam of seams) seam.relativeToMotion = seam.adjacentRmse / Math.max(0.001, motionBaselineRmse);
  const contact = path.join(outputDir, 'contact-sheet.jpg');
  const columns = duration > 10 ? 5 : 4;
  const rows = Math.max(1, Math.ceil(Math.max(1, Math.floor(duration)) / columns));
  run(ffmpegPath, ['-y', '-i', videoPath, '-vf', `fps=1,scale=320:-1,tile=${columns}x${rows}`, '-frames:v', '1', contact]);
  const freeze = spawnSync(ffmpegPath, ['-i', videoPath, '-vf', 'freezedetect=n=0.003:d=0.5', '-f', 'null', '-'], { encoding: 'utf8' });
  const freezes = [...String(freeze.stderr || '').matchAll(/freeze_duration: ([0-9.]+)/g)].map(match => Number(match[1]));
  return {
    durationSeconds: duration,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    fps: video?.avg_frame_rate || '',
    bitrate: Number(probe.format.bit_rate || 0),
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name || '',
    firstFrameRmse,
    firstFrameSharpness: Number(firstStats.sharpness || 0),
    seamJumps: seams,
    motionBaselineRmse,
    freezeEvents: freezes,
    contactSheet: contact,
  };
}

async function runCase({ baseUrl, caseName, imagePath, promptText, outputRoot, definitions, seed }) {
  const caseDir = path.join(outputRoot, caseName);
  fs.mkdirSync(caseDir, { recursive: true });
  const remoteImage = await uploadImage(baseUrl, imagePath, `aid/director-ab/${caseName}`);
  const runId = `director-ab-${caseName}-${Date.now()}`;
  const built = buildDirectorPrompt({
    caseName,
    remoteImage,
    promptText,
    outputPrefix: `aid/director-ab/${runId}`,
    definitions,
    seed,
    width: caseName === 'single' ? 1280 : 864,
    height: caseName === 'single' ? 736 : 480,
  });
  fs.writeFileSync(path.join(caseDir, 'api-prompt.json'), JSON.stringify(built.prompt, null, 2));
  const started = Date.now();
  let peakVramBytes = 0;
  let peakRamBytes = 0;
  const submitted = await fetchJson(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: built.prompt, client_id: runId }),
  });
  if (!submitted.prompt_id) throw new Error(`Director submission omitted prompt_id: ${JSON.stringify(submitted)}`);
  const promptId = String(submitted.prompt_id);
  let completed;
  for (let attempt = 1; attempt <= 360; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const [history, stats, queue] = await Promise.all([
      fetchJson(`${baseUrl}/history/${encodeURIComponent(promptId)}`),
      fetchJson(`${baseUrl}/system_stats`),
      fetchJson(`${baseUrl}/queue`),
    ]);
    completed = history[promptId];
    const isRunning = (queue.queue_running || []).some(entry => String(entry?.[1] || '') === promptId);
    if (isRunning) {
      const device = stats.devices?.[0] || {};
      peakVramBytes = Math.max(peakVramBytes, Number(device.vram_total || 0) - Number(device.vram_free || 0));
      peakRamBytes = Math.max(peakRamBytes, Number(stats.system?.ram_total || 0) - Number(stats.system?.ram_free || 0));
    }
    process.stdout.write(`POLL ${caseName} ${attempt} ${((Date.now() - started) / 1000).toFixed(1)}s ${completed?.status?.status_str || 'queued'}\n`);
    if (!completed) continue;
    if (completed.status?.status_str === 'error') throw new Error(JSON.stringify(completed.status));
    if (completed.status?.completed) break;
  }
  if (!completed?.status?.completed) throw new Error(`Director ${caseName} timed out`);
  const selected = mediaOutputs(completed).find(item => /\.mp4$/i.test(item.filename || '')) || mediaOutputs(completed)[0];
  if (!selected?.filename) throw new Error(`Director ${caseName} returned no media`);
  const query = new URLSearchParams({ filename: selected.filename, subfolder: selected.subfolder || '', type: selected.type || 'output' });
  const response = await fetch(`${baseUrl}/view?${query}`);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${await response.text()}`);
  const outputPath = path.join(caseDir, `${caseName}.mp4`);
  fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
  const endToEndSeconds = (Date.now() - started) / 1000;
  const messages = completed.status?.messages || [];
  const startedMessage = messages.find(message => message?.[0] === 'execution_start');
  const finishedMessage = [...messages].reverse().find(message => message?.[0] === 'execution_success');
  const executionStartedAt = Number(startedMessage?.[1]?.timestamp || 0);
  const executionFinishedAt = Number(finishedMessage?.[1]?.timestamp || 0);
  const executionSeconds = executionStartedAt && executionFinishedAt
    ? (executionFinishedAt - executionStartedAt) / 1000
    : endToEndSeconds;
  const queueWaitSeconds = executionStartedAt ? Math.max(0, (executionStartedAt - started) / 1000) : 0;
  const seamTimes = caseName === 'continuity'
    ? built.groups.slice(0, -1).map((_, index) => (
        built.groups.slice(0, index + 1).reduce((sum, group) => sum + h3FrameCount(group.duration), 0) / FPS
      ))
    : [];
  const evaluation = await evaluateVideo(outputPath, imagePath, caseDir, seamTimes);
  const result = {
    caseName,
    promptId,
    seed,
    groups: built.groups.map(group => ({ duration: group.duration, promptLength: group.prompt.length })),
    executionSeconds,
    queueWaitSeconds,
    endToEndSeconds,
    secondsPerOutputSecond: executionSeconds / Math.max(0.001, evaluation.durationSeconds),
    peakVramGiB: peakVramBytes / (1024 ** 3),
    peakRamGiB: peakRamBytes / (1024 ** 3),
    outputPath,
    remoteOutput: selected,
    directorReport: directorReport(completed),
    evaluation,
  };
  fs.writeFileSync(path.join(caseDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const baseUrl = String(process.env.AID_COMFYUI_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const imagePath = path.resolve(process.env.AID_H3_FRAME || DEFAULT_FRAME);
  const promptPath = path.resolve(process.env.AID_H3_PROMPT || DEFAULT_PROMPT);
  const outputRoot = path.resolve(process.env.AID_DIRECTOR_OUTPUT_DIR || DEFAULT_OUTPUT);
  const seed = Number(process.env.AID_H3_SEED || DEFAULT_SEED);
  const cases = String(process.env.AID_DIRECTOR_CASES || 'single,continuity,refine')
    .split(',').map(value => value.trim()).filter(Boolean);
  for (const file of [imagePath, promptPath]) if (!fs.existsSync(file)) throw new Error(`Missing input: ${file}`);
  for (const caseName of cases) if (!['single', 'continuity', 'refine'].includes(caseName)) throw new Error(`Unknown case: ${caseName}`);
  fs.mkdirSync(outputRoot, { recursive: true });
  const definitions = await fetchJson(`${baseUrl}/object_info`);
  for (const required of ['MiniMaxH3Director', 'MiniMaxH3DirectorGroupImageToVideo', 'MiniMaxH3DirectorGroupsCombine']) {
    if (!definitions[required]) throw new Error(`Remote ComfyUI is missing ${required}`);
  }
  const promptText = fs.readFileSync(promptPath, 'utf8').trim();
  const baselineVideo = path.resolve(process.env.AID_DIRECTOR_BASELINE_VIDEO
    || 'outputs/nana-broadcast-candid/dasiwa4/nana-shanghai-dasiwa4.mp4');
  let baseline;
  if (fs.existsSync(baselineVideo)) {
    const baselineDir = path.join(outputRoot, 'baseline');
    fs.mkdirSync(baselineDir, { recursive: true });
    const evaluation = await evaluateVideo(baselineVideo, imagePath, baselineDir);
    const legacyResultPath = path.join(path.dirname(baselineVideo), 'result.json');
    const legacy = fs.existsSync(legacyResultPath) ? JSON.parse(fs.readFileSync(legacyResultPath, 'utf8')) : {};
    baseline = {
      outputPath: baselineVideo,
      elapsedSeconds: Number(legacy.elapsedSeconds || 0),
      secondsPerOutputSecond: Number(legacy.elapsedSeconds || 0) / Math.max(0.001, evaluation.durationSeconds),
      evaluation,
    };
    fs.writeFileSync(path.join(baselineDir, 'result.json'), JSON.stringify(baseline, null, 2));
  }
  const results = [];
  for (const caseName of cases) results.push(await runCase({ baseUrl, caseName, imagePath, promptText, outputRoot, definitions, seed }));
  const summary = { createdAt: new Date().toISOString(), baseUrl, seed, baseline, results };
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
