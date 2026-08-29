import fs from 'node:fs';
import path from 'node:path';

import { createMidjourneyImageTask, getMidjourneyImageStatus } from '../lib/apimart.ts';

function readApiKey() {
  const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const line = env.split(/\r?\n/).find(value => /^APIMART_API_KEY=/.test(value));
  const raw = line?.slice(line.indexOf('=') + 1).trim() || '';
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

function asDataUrl(filename) {
  const data = fs.readFileSync(filename).toString('base64');
  return `data:image/png;base64,${data}`;
}

const apiKey = readApiKey();
if (!apiKey) throw new Error('APIMART_API_KEY missing from .env.local');

const referencePath = process.env.NANA_REFERENCE_PATH || '/Users/yao/Downloads/Nana角色卡照片版.png';
if (!fs.existsSync(referencePath)) throw new Error(`Nana reference is missing: ${referencePath}`);

const prompt = `IMAGE GOAL:
The same adult Chinese woman Nana from the identity reference browses a lively Shanghai shopping street in late afternoon. She walks beside a shop window with one small paper shopping bag at her side, slows for a moment to glance at an object inside the window, then lets her gaze drift away from the camera. She wears a practical pale oatmeal cardigan over a simple white top, a charcoal ankle-length skirt and flat dark loafers; her long dark wavy hair remains unchanged. The frame includes layered pedestrians, street trees, parked bicycles, storefront depth and passing traffic, but no readable signs.

CAMERA:
An authentic television-live candid long-lens view from across the pedestrian flow. Nana is unaware of the camera, side-on with relaxed imperfect posture, placed off-center near the right third. A passerby's shoulder softly blocks part of the left foreground and another pedestrian briefly overlaps the lower edge. Use a slightly untidy composition with a small natural edge crop, plausible walking motion blur, restrained broadcast compression noise, subtle interlaced texture and long-lens softness. Preserve truthful pores, small skin variation and minor redness. No influencer behavior, fashion pose, beauty retouching, glossy commercial lighting, studio background, captions, subtitles, logos, watermark, UI or readable text.`;

const taskId = await createMidjourneyImageTask(
  prompt,
  [asDataUrl(referencePath)],
  apiKey,
  '16:9',
  'character',
  'cinematic-natural',
  'broadcast-candid',
  'story-shot',
  true,
  'votj2t8',
);

process.stdout.write(`TASK ${taskId}\n`);
for (let attempt = 1; attempt <= 120; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 5000));
  const status = await getMidjourneyImageStatus(taskId, apiKey);
  process.stdout.write(`POLL ${attempt} ${status.status}\n`);
  if (status.status === 'failed') throw new Error(status.error || 'Midjourney generation failed');
  if (status.status !== 'completed') continue;

  const outputDir = path.resolve('outputs/nana-broadcast-candid');
  fs.mkdirSync(outputDir, { recursive: true });
  const urls = status.imageUrls.length ? status.imageUrls : status.gridImageUrl ? [status.gridImageUrl] : [];
  if (!urls.length) throw new Error('Midjourney completed without output images');
  const manifest = { taskId, prompt, referencePath, imageUrls: urls, gridImageUrl: status.gridImageUrl };
  fs.writeFileSync(path.join(outputDir, 'midjourney-result.json'), JSON.stringify(manifest, null, 2));
  for (let index = 0; index < urls.length; index += 1) {
    const response = await fetch(urls[index]);
    if (!response.ok) throw new Error(`Download candidate ${index + 1}: HTTP ${response.status}`);
    fs.writeFileSync(path.join(outputDir, `mj-candidate-${index + 1}.png`), Buffer.from(await response.arrayBuffer()));
  }
  process.stdout.write(`RESULT ${JSON.stringify(manifest)}\n`);
  process.exit(0);
}

throw new Error('Midjourney Nana smoke test timed out');
