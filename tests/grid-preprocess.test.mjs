import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { buildCloudinaryGridCellUrls, cloudinaryGridDimensions, cloudinaryGridInfoUrl } from '../lib/gridCloudinary.ts';

test('derives four native-detail cells with a compact delivery cap', () => {
  const cells = buildCloudinaryGridCellUrls('https://res.cloudinary.com/demo/image/upload/grid.jpg', 4096, 2304);
  assert.equal(cells.length, 4);
  assert.equal(new Set(cells).size, 4);
  cells.forEach(url => {
    assert.match(url, /c_crop/);
    assert.match(url, /c_limit,w_1600,h_1600/);
    assert.match(url, /q_auto:good,f_auto/);
  });
});

test('keeps the 4K mother-grid path instead of shrinking it to 2K before split', async () => {
  const generator = await readFile(new URL('../lib/imageGenerator.ts', import.meta.url), 'utf8');
  const splitter = await readFile(new URL('../app/api/split-grid/route.ts', import.meta.url), 'utf8');
  assert.match(generator, /'4K'/);
  assert.match(splitter, /width: 4096/);
  assert.doesNotMatch(splitter, /resize\(\{ width: 2048/);
});

test('reuses a plain persisted Cloudinary mother grid without uploading it again', () => {
  const source = 'https://res.cloudinary.com/demo/image/upload/v1788366640/aid-images/grid.webp';
  assert.equal(cloudinaryGridInfoUrl(source), 'https://res.cloudinary.com/demo/image/upload/fl_getinfo/v1788366640/aid-images/grid.webp');
  assert.equal(cloudinaryGridInfoUrl('https://getapib.org/grid.png'), undefined);
  assert.equal(cloudinaryGridInfoUrl('https://res.cloudinary.com/demo/image/upload/c_crop,w_3/grid.webp'), undefined);
  assert.deepEqual(cloudinaryGridDimensions({ input: { width: 2160, height: 3840 } }), { width: 2160, height: 3840 });
  assert.equal(cloudinaryGridDimensions({ output: { width: 2160, height: 3840 } }), undefined);
});
