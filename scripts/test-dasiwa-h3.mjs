import fs from 'node:fs';
import path from 'node:path';

import {
  applyH3Fl2vaProfile,
  compileFrontendWorkflow,
  injectReferenceImages,
  patchWorkflow,
} from '../lib/comfyui.ts';

const baseUrl = String(process.env.AID_COMFYUI_URL || '').replace(/\/$/, '');
if (!baseUrl) throw new Error('AID_COMFYUI_URL is required');

const workflowPath = path.resolve(process.env.AID_H3_WORKFLOW || '/tmp/aid-h3-4step-workflow.json');
const imagePath = path.resolve(process.env.AID_H3_FRAME || 'outputs/nana-broadcast-candid/nana-shanghai-clean-first-frame.png');
const promptPath = path.resolve(process.env.AID_H3_PROMPT || 'outputs/nana-broadcast-candid/h3-submitted-prompt.txt');
const outputDir = path.resolve(process.env.AID_H3_OUTPUT_DIR || 'outputs/nana-broadcast-candid/dasiwa4');
const testModel = String(process.env.AID_H3_TEST_MODEL || '').trim();
const duration = Math.min(15, Math.max(2, Number(process.env.AID_H3_DURATION || 8)));
const seed = Number(process.env.AID_H3_SEED || 8829421);

for (const file of [workflowPath, imagePath, promptPath]) {
  if (!fs.existsSync(file)) throw new Error(`Missing test input: ${file}`);
}
fs.mkdirSync(outputDir, { recursive: true });

const imageBytes = fs.readFileSync(imagePath);
const uploadBody = new FormData();
uploadBody.append('image', new Blob([imageBytes], { type: 'image/png' }), path.basename(imagePath));
uploadBody.append('type', 'input');
uploadBody.append('subfolder', 'aid/dasiwa4-test');
uploadBody.append('overwrite', 'true');
const uploadResponse = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: uploadBody });
if (!uploadResponse.ok) throw new Error(`Upload failed ${uploadResponse.status}: ${await uploadResponse.text()}`);
const uploaded = await uploadResponse.json();
const remoteImage = [uploaded.subfolder, uploaded.name].filter(Boolean).join('/');

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const promptText = fs.readFileSync(promptPath, 'utf8').trim();
const runId = `nana-dasiwa4-${Date.now()}`;
patchWorkflow(workflow, {
  variant: 'aid_single_reference',
  imageRefs: [remoteImage],
  prompt: promptText,
  duration,
  aspectRatio: '16:9',
  seed,
  outputPrefix: `aid/dasiwa4-test/${runId}`,
});
const prompt = compileFrontendWorkflow(workflow);
const profile = applyH3Fl2vaProfile(prompt, 'aid_single_reference', 'dasiwa4');
injectReferenceImages(prompt, 'aid_single_reference', [remoteImage]);
if (testModel) {
  const loader = Object.values(prompt).find(node => node?.class_type === 'UNETLoader');
  if (!loader) throw new Error('UNETLoader is missing from compiled workflow');
  loader.inputs.unet_name = testModel;
}

const manifest = {
  requestedProfile: 'dasiwa4',
  effectiveProfile: profile,
  testModel: testModel || profile.diffusionModel,
  duration,
  seed,
  remoteImage,
  startedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outputDir, 'request-manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(outputDir, 'api-prompt.json'), JSON.stringify(prompt, null, 2));

const started = Date.now();
const submitResponse = await fetch(`${baseUrl}/prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, client_id: runId }),
});
const submitted = await submitResponse.json();
if (!submitResponse.ok || !submitted.prompt_id) {
  throw new Error(`Prompt rejected ${submitResponse.status}: ${JSON.stringify(submitted)}`);
}
const promptId = String(submitted.prompt_id);
process.stdout.write(`SUBMITTED ${promptId}\nMODEL ${manifest.testModel}\n`);

let completed;
for (let attempt = 1; attempt <= 240; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 5000));
  const historyResponse = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`);
  if (!historyResponse.ok) throw new Error(`History failed ${historyResponse.status}`);
  const history = await historyResponse.json();
  completed = history[promptId];
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(`POLL ${attempt} ${elapsed}s ${completed?.status?.status_str || 'queued'}\n`);
  if (!completed) continue;
  if (completed.status?.status_str === 'error') throw new Error(JSON.stringify(completed.status));
  if (completed.status?.completed) break;
}
if (!completed?.status?.completed) throw new Error('DaSiWa H3 test timed out');

const files = [];
for (const output of Object.values(completed.outputs || {})) {
  for (const listName of ['videos', 'gifs', 'images']) {
    for (const item of output?.[listName] || []) files.push(item);
  }
}
const selected = files.find(item => /audio\.mp4$/i.test(item.filename || ''))
  || files.find(item => /\.mp4$/i.test(item.filename || ''))
  || files[0];
if (!selected?.filename) throw new Error(`No generated media in history: ${JSON.stringify(completed.outputs)}`);
const query = new URLSearchParams({
  filename: selected.filename,
  subfolder: selected.subfolder || '',
  type: selected.type || 'output',
});
const mediaResponse = await fetch(`${baseUrl}/view?${query}`);
if (!mediaResponse.ok) throw new Error(`Download failed ${mediaResponse.status}`);
const outputPath = path.join(outputDir, 'nana-shanghai-dasiwa4.mp4');
fs.writeFileSync(outputPath, Buffer.from(await mediaResponse.arrayBuffer()));
const result = {
  ...manifest,
  promptId,
  completedAt: new Date().toISOString(),
  elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  outputPath,
  remoteOutput: selected,
};
fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2));
process.stdout.write(`RESULT ${outputPath}\nELAPSED ${result.elapsedSeconds}s\n`);
