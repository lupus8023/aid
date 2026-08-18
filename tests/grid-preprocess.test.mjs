import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { buildCloudinaryGridCellUrls } from '../lib/gridCloudinary.ts';

test('derives nine native-detail cells with a compact delivery cap', () => {
  const cells = buildCloudinaryGridCellUrls('https://res.cloudinary.com/demo/image/upload/grid.jpg', 4096, 2304);
  assert.equal(cells.length, 9);
  assert.equal(new Set(cells).size, 9);
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
