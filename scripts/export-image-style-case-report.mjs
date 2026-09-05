// Offline evidence export; provider calls are intercepted, never sent.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import axios from 'axios';
import { POST as characterDesign } from '../app/api/character-design/route.ts';
import { generateStoryboardImage } from '../lib/imageGenerator.ts';
const root = path.resolve('outputs/image-style-controls-20260905');
const receipt = JSON.parse(await fs.readFile(path.join(root, 'receipt.json'), 'utf8'));
const originalPost = axios.post;
try {
  for (const [name, job] of Object.entries(receipt.jobs)) {
    assert.equal(job.status, 'completed');
    const input = JSON.parse(await fs.readFile(path.join(root, name + '-request.json'), 'utf8'));
    const calls = [];
    axios.post = async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      return { data: { task_id: 'offline-export-only', data: [{ task_id: 'offline-export-only' }] } };
    };
    if (job.grid) {
      await generateStoryboardImage(input.storyboard, input.characters, 'offline-placeholder', input.objects, input.aspectRatio, input.imageModel, input.costumeImages, input.sceneImage, input.referenceImages, input.referenceImageLabels, input.visualStyle, input.capturePreset, {}, '', {}, input.styleReference);
    } else {
      const result = await characterDesign(new Request('http://localhost/api/character-design', { method: 'POST', body: JSON.stringify({ ...input, apiKey: 'offline-placeholder' }) }));
      assert.equal(result.status, 200);
    }
    assert.equal(calls.length, 1);
    await fs.writeFile(path.join(root, name + '-provider-payload.json'), JSON.stringify({ evidence: 'Offline recompiled from the saved actual application request; no network call or charge.', ...calls[0] }, null, 2));
    await fs.writeFile(path.join(root, name + '-prompt.txt'), calls[0].payload.prompt);
  }
} finally { axios.post = originalPost; }
console.log('Exported 10 provider payloads and prompts, offline only.');
