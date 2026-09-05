// User-authorized, bounded real test of the current image-only production path.
// Exactly one MJ creation and one GPT grid creation; repeated commands resume
// recorded tasks. Never clear submission markers after an uncertain response.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildGridPrompt } from '../lib/gridSplitter.ts';
import { createStoryImageRequestPreparer } from '../lib/storyImageRequest.ts';
import { INHERIT_CHARACTER_LOOK, makeCharacterVisualMaster } from '../lib/characterVisualMaster.ts';
import { readApiJson } from '../lib/apiResponse.ts';

process.loadEnvFile('.env.local');
const apiKey = process.env.APIMART_API_KEY;
if (!apiKey) throw new Error('APIMART_API_KEY is not configured');
const root = path.resolve('outputs/song-palace-mj-gpt-20260905');
const base = 'http://127.0.0.1:3039';
await fs.mkdir(root, { recursive: true });
const statePath = path.join(root, 'receipt.json');
const state = await fs.readFile(statePath, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return { title: '疏雨入帘', authorized: 'One MJ master task + one GPT-Image-2 four-panel task', startedAt: new Date().toISOString() }; throw error; });
const save = () => fs.writeFile(statePath, JSON.stringify(state, null, 2));
const json = (name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2));
const request = async (endpoint, body) => readApiJson(await fetch(base + endpoint, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, apiKey }), signal: AbortSignal.timeout(180_000),
}), endpoint, { taskStatus: true });
async function download(url, name) {
  const file = path.join(root, name);
  try { await fs.access(file); return file; } catch {}
  const response = await fetch(url, { headers: { Referer: 'https://apimart.ai/' }, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Image download HTTP ${response.status}; generation task retained`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Result is not an image');
  await fs.writeFile(file, buffer, { flag: 'wx' });
  return { file, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
}

const masterInput = {
  stage: 'concepts', name: '沈清蘅', role: 'An adult noblewoman in a Song-dynasty-inspired Chinese palace drama', age: '26 years old',
  personality: 'Composed, intelligent, inwardly tender',
  description: 'A beautiful adult Chinese palace noblewoman standing beside a tall wooden lattice window after gentle rain, waist-up three-quarter portrait. A delicate softly oval face, dark almond-shaped eyes, natural muted rose lips, refined unexaggerated features and luminous real skin with very fine texture. Glossy black hair gathered into an elegant rounded court updo, two delicate gold floral hairpins with tiny pearls and short fine dangling chains, a few soft loose strands near her cheek. One hand rests lightly on the wooden window sill, the other touches the edge of a translucent silk curtain. Her head is turned slightly toward the window, eyes looking beyond it, a quiet private thought almost becoming a smile. The palace interior and pale silk curtain remain softly visible behind her.',
  costumeDesc: 'Song-inspired long open-front pale celadon silk beizi over a warm ivory inner garment, slim layered silhouette, understated woven floral pattern, narrow finely embroidered edges, flowing sleeves with visible fabric weight. Small pearl-drop gold earrings. Restrained graceful court dress, delicate rather than monumental ornament.',
  aestheticDirection: 'Live-action Chinese historical fantasy movie scene, exceptionally beautiful and lifelike, delicate facial features, detailed realistic skin texture, fine hair strands, flowing tactile silk fabric and intricate handmade gold floral jewelry. Soft even window light through translucent silk, gentle shadows, a warm delicate reflected glow on the face, airy but dimensional cinematic light. Pearly ivory, pale celadon, muted old gold and warm walnut. Clear soft luminous complexion without plastic smoothing; subtle optical falloff, graceful intimate composition, exquisite quiet elegance. A real actress in exquisitely made clothing on a physical palace set. One coherent photographic image, not an illustration or game render.',
  candidateCount: 4, imageModel: 'midjourney', referenceImages: [],
  // Match the currently configured role-design default; record it explicitly.
  midjourneyProfile: 'votj2t8', midjourneyStyle: {},
};

const mode = process.argv[2];
if (mode === 'submit-master') {
  if (state.master) { console.log(JSON.stringify({ alreadyRecorded: state.master })); process.exit(0); }
  await json('01-mj-app-request.json', masterInput);
  state.master = { submissionStartedAt: new Date().toISOString(), status: 'submitting' }; await save();
  const result = await request('/api/character-design', masterInput);
  if (!result.taskId) throw new Error('No task ID returned; do not resubmit');
  state.master = { ...state.master, ...result, status: 'pending' }; await save();
  await fs.writeFile(path.join(root, '01-mj-prompt.txt'), result.prompt);
  console.log(JSON.stringify({ taskId: result.taskId, layout: result.layout, candidateCount: result.candidateCount }));
} else if (mode === 'poll-master' || mode === 'poll-grid') {
  const key = mode === 'poll-master' ? 'master' : 'grid';
  if (!state[key]?.taskId) throw new Error('No recorded task ID; investigate instead of resubmitting');
  const result = await request('/api/check-image-status', { taskId: state[key].taskId });
  state[key] = { ...state[key], ...result, queriedAt: new Date().toISOString() }; await save();
  console.log(JSON.stringify({ stage: key, taskId: state[key].taskId, status: result.status, error: result.error }));
  if (result.status === 'completed') {
    const urls = key === 'master' ? result.candidateUrls || [result.imageUrl] : [result.imageUrl];
    const files = [];
    for (let i = 0; i < urls.length; i++) files.push(await download(urls[i], key === 'master' ? `mj-candidate-${i + 1}.png` : 'gpt-storyboard-2x2.png'));
    state[key].files = files; state[key].completedAt ||= new Date().toISOString(); await save();
    console.log(JSON.stringify({ files }));
  }
} else if (mode === 'select') {
  const index = Number(process.argv[3]) - 1;
  const urls = state.master?.candidateUrls || [state.master?.imageUrl];
  if (state.master?.status !== 'completed' || !urls[index]) throw new Error('Select an existing completed MJ candidate');
  if (state.grid) throw new Error('The grid reference is already committed');
  state.selection = { index: index + 1, imageUrl: urls[index], selectedAt: new Date().toISOString() }; await save();
  console.log(JSON.stringify({ selected: index + 1 }));
} else if (mode === 'submit-grid') {
  if (state.grid) { console.log(JSON.stringify({ alreadyRecorded: state.grid })); process.exit(0); }
  if (!state.selection) throw new Error('Select the MJ master first');
  const character = { id: 'shen-qingheng', name: '沈清蘅', description: 'The same adult palace noblewoman from the approved master, exact face, updo, gold floral hairpins, pearl-drop earrings and pale celadon / ivory silk outfit.', imageUrl: state.selection.imageUrl,
    visualMaster: makeCharacterVisualMaster(state.selection.imageUrl, 'midjourney', state.master.prompt) };
  const shots = [
    'Medium waist-up view from inside the room, at her seated-eye height. 沈清蘅 stands beside the same lattice window, one hand lightly resting on the sill. She has just noticed the silk curtain lifting beside her; her gaze shifts toward its edge while her body remains turned toward the window. The sill crosses the lower foreground, her figure is off-center, and the quiet palace room recedes behind her. Only 沈清蘅 appears in this frame, one instance of each.',
    'Medium close view from the window side, slightly below her chin. 沈清蘅 gently gathers the same sheer curtain between two fingers at chest height, stopping its movement. Her wrist and sleeve are visible, her eyes lower toward her fingers, and the fabric hangs in one soft fold. Her face and hand remain in the same readable plane. Only 沈清蘅 appears in this frame, one instance of each.',
    'Tight over-the-shoulder portrait from just behind her window-side shoulder. 沈清蘅 turns her head toward the doorway inside the room, her face now in three-quarter view and her near eye in focus. Her shoulder fills the lower foreground; the same pearl earring rests beside her jaw and the gold hair ornaments stay unchanged. Her expression is attentive and quietly expectant, lips closed. Only 沈清蘅 appears in this frame, one instance of each.',
    'Medium close portrait from inside the room, showing her face, upper torso and curtain-side hand. 沈清蘅 has let the silk curtain slip from her relaxed fingers; the released edge hangs beside her sleeve. She holds her gaze toward the unseen doorway and settles into a small composed smile, shoulders relaxed. Leave a little open space in the direction of her gaze. Only 沈清蘅 appears in this frame, one instance of each.',
  ];
  const labels = [`CHARACTER IDENTITY: 沈清蘅 — ${character.description} The same image also supplies the approved visual finish and window/curtain continuity; keep the garment, jewelry and curtain design unchanged.`];
  const prompt = buildGridPrompt('The same quiet palace window and silk curtain after rain as the original; no change of time or location.', character.description, shots, '9:16', labels, [1,2,3,4], 'follow-reference', 'follow-reference', 'gpt-image-2');
  const storyboard = { id: 'song-palace-grid', sceneNumber: 1, characters: [character.name], objects: [], prompt, description: '疏雨入帘：听见帘响—止帘—回望—含笑', status: 'pending' };
  const prepared = JSON.parse(await createStoryImageRequestPreparer()({ storyboard, characters: [character], objects: [], apiKey: '', imageModel: 'gpt-image-2', aspectRatio: '9:16', referenceImages: [character.imageUrl], referenceImageLabels: labels, visualStyle: 'follow-reference', capturePreset: 'follow-reference' }));
  delete prepared.apiKey;
  await json('02-gpt-app-request.json', prepared);
  await json('story-shots.json', shots);
  // The shared generator appends this exact contract for referenced GPT grids.
  await fs.writeFile(path.join(root, '02-gpt-provider-prompt.txt'), `${prompt}\n\n${INHERIT_CHARACTER_LOOK}`);
  state.grid = { submissionStartedAt: new Date().toISOString(), status: 'submitting', model: 'gpt-image-2', referenceImageCount: 1, referenceCandidate: state.selection.index }; await save();
  const result = await request('/api/generate', prepared);
  if (!result.taskId) throw new Error('No grid task ID returned; do not resubmit');
  state.grid = { ...state.grid, taskId: result.taskId, status: 'pending' }; await save();
  console.log(JSON.stringify({ taskId: result.taskId, model: 'gpt-image-2', referenceCandidate: state.selection.index }));
} else {
  console.log('Commands: submit-master | poll-master | select 1..4 | submit-grid | poll-grid');
}
