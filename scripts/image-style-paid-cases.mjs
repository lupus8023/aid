// User-authorized bounded integration cases: at most ten creation tasks.
// An uncertain creation is never automatically resubmitted. Poll by stored ID.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGridPrompt } from '../lib/gridSplitter.ts';
import { createStoryImageRequestPreparer } from '../lib/storyImageRequest.ts';
import { readApiJson } from '../lib/apiResponse.ts';

process.loadEnvFile('.env.local');
const apiKey = process.env.APIMART_API_KEY;
if (!apiKey) throw new Error('APIMART_API_KEY missing');
const base = 'http://127.0.0.1:3039';
const root = path.resolve('outputs/image-style-controls-20260905');
await fs.mkdir(root, { recursive: true });
const lockPath = path.join(root, '.case-run.lock');
const lock = await fs.open(lockPath, 'wx').catch(() => { throw new Error('Another case command is active. Do not run submit and poll concurrently.'); });
try {
const receiptPath = path.join(root, 'receipt.json');
const state = await fs.readFile(receiptPath, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return { authorizedLimit: 10, jobs: {} }; throw e; });
const save = () => fs.writeFile(receiptPath, JSON.stringify(state, null, 2));
const original = JSON.parse(await fs.readFile('outputs/song-palace-mj-gpt-20260905/receipt.json', 'utf8')).selection.imageUrl;
const cast = { id: 'qing', name: '清蘅', description: 'the approved adult Chinese woman, ivory woven silk robe, black updo, gold floral hairpins and pearl earrings', imageUrl: original, visualMaster: { version: 1, source: 'midjourney', imageUrl: original } };
const shots = [
  '清蘅 stands at the wooden lattice window, her left hand resting on the sill, looking toward the silk curtain. Only 清蘅 appears in this frame, one instance of each.',
  '清蘅 gathers the edge of the same silk curtain with two fingers at chest height and looks at her fingertips. Only 清蘅 appears in this frame, one instance of each.',
  '清蘅 turns her head toward the room interior, lips closed, quietly expectant, one hand still holding the curtain. Only 清蘅 appears in this frame, one instance of each.',
  '清蘅 releases the curtain, her hand relaxes beside her waist, and she gives the unseen doorway a very small smile. Only 清蘅 appears in this frame, one instance of each.',
];
const jobs = {
  'mj-baseline': { model: 'midjourney', style: 'follow-reference', capture: 'follow-reference' },
  'mj-sref': { model: 'midjourney', style: 'follow-reference', capture: 'follow-reference', sref: true },
  'gpt-warm-film': { model: 'gpt-image-2', style: 'warm-film', capture: 'follow-reference' },
  'gpt-neo-noir': { model: 'gpt-image-2', style: 'neo-noir', capture: 'follow-reference' },
  'gpt-anime': { model: 'gpt-image-2', style: 'anime', capture: 'follow-reference' },
  'gpt-stop-motion': { model: 'gpt-image-2', style: 'stop-motion', capture: 'follow-reference' },
  'gpt-3d': { model: 'gpt-image-2', style: '3d-cg', capture: 'follow-reference' },
  'grid-cinema': { grid: true, model: 'gpt-image-2', style: 'follow-reference', capture: 'cinematic-narrative' },
  'grid-surveillance': { grid: true, model: 'gpt-image-2', style: 'follow-reference', capture: 'surveillance' },
  'grid-style-reference': { grid: true, model: 'gpt-image-2', style: 'follow-reference', capture: 'cinematic-narrative', useNoirReference: true },
};
async function request(endpoint, body) {
  return readApiJson(await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, apiKey }), signal: AbortSignal.timeout(180_000) }), endpoint, { taskStatus: true });
}
async function submit(name) {
  if (!jobs[name]) throw new Error('Unknown case');
  if (state.jobs[name]) { console.log(name, 'already recorded; will not resubmit'); return; }
  if (Object.keys(state.jobs).length >= state.authorizedLimit) throw new Error('Case creation cap reached');
  const job = jobs[name];
  let body, endpoint;
  if (job.grid) {
    const styleReference = job.useNoirReference ? { imageUrl: state.jobs['gpt-neo-noir']?.imageUrl, description: 'Use the supplied style image for cool slate/cyan shadows, small warm practical highlights, dense readable blacks and directional contrast. Keep the original character identity and ivory garment; do not copy the style image pose.' } : undefined;
    if (job.useNoirReference && !styleReference.imageUrl) throw new Error('Complete and poll the noir source first');
    const labels = ['CHARACTER IDENTITY: 清蘅 — the original approved actor and outfit'];
    const prompt = buildGridPrompt('The same wooden window and silk curtain in the palace room.', cast.description, shots, '9:16', labels, [1,2,3,4], job.style, job.capture, job.model);
    body = JSON.parse(await createStoryImageRequestPreparer()({ storyboard: { id: name, sceneNumber: 1, prompt, description: shots[0], characters: [cast.name], objects: [], status: 'pending' }, characters: [cast], objects: [], referenceImages: [original], referenceImageLabels: labels, imageModel: job.model, aspectRatio: '9:16', visualStyle: job.style, capturePreset: job.capture, styleReference, apiKey: '' }));
    delete body.apiKey;
    endpoint = '/api/generate';
  } else {
    const mj = job.model === 'midjourney';
    body = { stage: 'concepts', name: '清蘅', role: 'Adult noblewoman in a Song-inspired Chinese palace drama', description: 'A 26-year-old Chinese palace woman, elegant oval face and almond-shaped eyes, black hair in a rounded court updo, two delicate gold floral hairpins and pearl-drop earrings. She wears an ivory silk robe with fine woven floral embroidery. Waist-up three-quarter portrait beside a tall wooden lattice window and sheer silk curtain, both hands resting together at her waist, quietly looking toward the window. One woman only. Keep this subject, outfit and pose; no extra objects or text.', imageModel: job.model, visualStyle: job.style, capturePreset: job.capture, referenceImages: mj ? [] : [original], midjourneyProfile: '', midjourneyStyle: job.sref ? { styleReferenceUrl: original, styleWeight: 300 } : {} };
    endpoint = '/api/character-design';
  }
  await fs.writeFile(path.join(root, name + '-request.json'), JSON.stringify(body, null, 2));
  state.jobs[name] = { ...job, submissionStartedAt: new Date().toISOString(), status: 'submitting', endpoint }; await save();
  const result = await request(endpoint, body);
  if (!result.taskId) throw new Error('No task ID; preserve submission marker and investigate');
  state.jobs[name] = { ...state.jobs[name], ...result, status: 'pending' }; await save();
  if (result.prompt) await fs.writeFile(path.join(root, name + '-prompt.txt'), result.prompt);
  console.log(JSON.stringify({ name, taskId: result.taskId }));
}
async function poll(name) {
  const entry = state.jobs[name];
  if (entry?.status === 'completed' && entry.files?.length) return;
  if (!entry?.taskId) { console.log(name, 'has no task ID; not resubmitting'); return; }
  const result = await request('/api/check-image-status', { taskId: entry.taskId });
  state.jobs[name] = { ...entry, ...result, queriedAt: new Date().toISOString() }; await save();
  console.log(JSON.stringify({ name, status: result.status, error: result.error }));
  if (result.status !== 'completed') return;
  const urls = result.candidateUrls || [result.imageUrl]; const files = [];
  for (let i = 0; i < urls.length; i++) {
    const filename = name + (urls.length > 1 ? `-${i + 1}` : '') + '.png';
    const file = path.join(root, filename);
    const exists = await fs.access(file).then(() => true).catch(() => false);
    if (!exists) {
      const response = await fetch(urls[i], { headers: { Referer: 'https://apimart.ai/' }, signal: AbortSignal.timeout(90_000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Download failed; preserve existing generation');
      await fs.writeFile(file, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
    }
    files.push(file);
  }
  state.jobs[name].files = files; state.jobs[name].completedAt = new Date().toISOString(); await save();
}
const command = process.argv[2];
if (command === 'submit') await submit(process.argv[3]);
else if (command === 'submit-initial') { for (const name of Object.keys(jobs).filter(name => name !== 'grid-style-reference')) await submit(name); }
else if (command === 'poll') { for (const name of process.argv[3] ? [process.argv[3]] : Object.keys(state.jobs)) await poll(name); }
else console.log('submit-initial | submit CASE | poll [CASE]');
} finally { await lock.close(); await fs.unlink(lockPath); }
