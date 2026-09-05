// Release smoke: real persisted grid/cell delivery and browser preprocessing.
// The H3 transport is replaced BEFORE importing the real API handler: no GPU submission.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.env.AID_TEST_NODE_MODULES || process.cwd()] }));
const base = process.env.AID_TEST_URL || 'http://127.0.0.1:3039';
const out = path.resolve('outputs/image-style-controls-20260905/h3-handoff');
await mkdir(out, { recursive: true });
const receipt = JSON.parse(await readFile('outputs/image-style-controls-20260905/receipt.json', 'utf8'));
const source = receipt.jobs['grid-cinema'].imageUrl;
const previousSplit = await readFile(path.join(out, 'split-response.json'), 'utf8').then(JSON.parse).catch(() => undefined);
const response = await fetch(`${base}/api/split-grid`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: previousSplit?.gridUrl || source, gridSize: 2 }),
});
const split = await response.json();
assert.equal(response.status, 200, JSON.stringify(split));
assert.equal(split.cells.length, 4);
assert.equal(new Set(split.cells).size, 4);
assert.equal(split.preprocessing.gridSize, 2);
await writeFile(path.join(out, 'split-response.json'), JSON.stringify(split, null, 2));
const positions = split.cells.map(url => {
  const match = url.match(/c_crop,x_(\d+),y_(\d+),w_(\d+),h_(\d+)/);
  assert.ok(match); return match.slice(1).map(Number);
});
assert.equal(positions[0][0], positions[2][0]);
assert.equal(positions[0][1], positions[1][1]);
assert.ok(positions[1][0] > positions[0][0] && positions[2][1] > positions[0][1]);

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const references = [], images = [];
try {
  const page = await browser.newPage();
  await page.route('**/api/**', route => route.abort()); // browser never submits a job
  await page.goto(`${base}/`);
  const sourceModule = await readFile('lib/storyboardImageSource.ts', 'utf8');
  const preprocess = (await readFile('lib/storyboardImagePreprocess.ts', 'utf8')).replace(/^import .*;\n/m, '');
  const js = ts.transpileModule(`${sourceModule}\n${preprocess}`.replace(/\bexport /g, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  await page.addScriptTag({ content: js });
  for (const [index, url] of split.cells.entries()) {
    const delivery = await fetch(url, { headers: { Accept: 'image/webp,image/*' } });
    assert.equal(delivery.status, 200);
    const bytes = Buffer.from(await delivery.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    await writeFile(path.join(out, `cell-${index + 1}.${meta.format}`), bytes);
    const reference = await page.evaluate(async ({ url, index }) => prepareStoryboardReference(url, `Scene ${index + 1}`, '9:16'), { url, index });
    assert.match(reference, /^data:image\/(webp|jpeg);base64,/);
    const data = Buffer.from(reference.split(',')[1], 'base64');
    const prepared = await sharp(data).metadata();
    assert.ok(data.length <= 1_600_000);
    assert.ok(prepared.width <= 900 && prepared.height <= 1600);
    assert.ok(Math.abs(prepared.width / prepared.height - 9 / 16) < .002);
    await writeFile(path.join(out, `h3-reference-${index + 1}.${prepared.format}`), data);
    references.push(reference);
    images.push({ scene: index + 1, delivered: { width: meta.width, height: meta.height, bytes: bytes.length }, h3: { width: prepared.width, height: prepared.height, bytes: data.length }, crop: positions[index] });
  }
} finally { await browser.close(); }

// Keep the complete real generate-video handler and prompt compiler; replace only GPU submission.
globalThis.__aidH3HandoffCalls = [];
const stub = `export async function createComfyUIVideoTask(input) { globalThis.__aidH3HandoffCalls.push(input); return {taskId:'comfyui:handoff-mock', workflow:input.auxiliaryImages.length?'aid_multi_reference':'aid_i2v',prompt:input.prompt}; } export function isComfyUITask(s){return s.startsWith('comfyui:');} export async function createComfyUISubtitleRemovalTask(){throw new Error('Unexpected repair');}`;
const stubUrl = `data:text/javascript;base64,${Buffer.from(stub).toString('base64')}`;
const routeSource = (await readFile('app/api/generate-video/route.ts', 'utf8'))
  .replace("'@/lib/comfyui'", JSON.stringify(stubUrl))
  .replace("'next/server'", JSON.stringify(pathToFileURL(require.resolve('next/server.js')).href));
const compiled = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const shots = references.map((imageUrl, i) => ({ id: `handoff-${i + 1}`, sceneNumber: i + 1, imageUrl, status: 'completed', characters: ['Qing'], description: 'She gently gathers the curtain.', prompt: 'A woman by a window.', duration: 2, videoDuration: 2, visualStyle: 'follow-reference', capturePreset: 'follow-reference', videoDirection: { action: 'She gently gathers the curtain with two fingers.', camera: 'A steady medium shot.', ending: 'Her hand rests on the curtain.' } }));
for (const group of [...shots.map(shot => [shot]), shots]) {
  const result = await POST(new Request(`${base}/api/generate-video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyboard: { ...group[0], videoDuration: group.length * 2 }, segmentStoryboards: group, videoProvider: 'comfyui', aspectRatio: '9:16', language: 'zh' }) }));
  const json = await result.json();
  assert.equal(result.status, 200, JSON.stringify(json));
  const call = globalThis.__aidH3HandoffCalls.at(-1);
  assert.equal(call.firstFrame, group[0].imageUrl);
  assert.deepEqual(call.auxiliaryImages, group.slice(1).map(shot => shot.imageUrl));
  assert.equal(call.aspectRatio, '9:16');
  assert.equal(call.endFrame, undefined);
  assert.equal(call.referenceAudios.length, 0);
  assert.doesNotMatch(call.prompt, /--sref|--sw|IMAGE STYLE REFERENCE|CONTACT SHEET|2x2/i);
}
const report = { checkedAt: new Date().toISOString(), source, split, images, h3ApiCases: 5, h3Transport: 'mocked; actual API handler and prompt compiler', realVideoGeneration: false, order: 'top-left, top-right, bottom-left, bottom-right' };
await writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ images, h3ApiCases: 5, realVideoGeneration: false, result: 'PASS' }, null, 2));
