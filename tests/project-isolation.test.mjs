import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGridPrompt, chunkGridBatch } from '../lib/gridSplitter.ts';
import { buildCloudinaryGridCellUrls } from '../lib/gridCloudinary.ts';
import { createProjectId, scopedVideoCacheKey } from '../lib/projectIdentity.ts';

test('groups automatic storyboard images into batches of at most nine', () => {
  const shots = Array.from({ length: 19 }, (_, index) => ({ id: `scene-${index + 1}` }));
  const batches = chunkGridBatch(shots);

  assert.deepEqual(batches.map(batch => batch.length), [9, 9, 1]);
  assert.deepEqual(batches.flat().map(shot => shot.id), shots.map(shot => shot.id));
});

test('keeps every image batch distinct before the provider truncation boundary', () => {
  const shots = Array.from(
    { length: 18 },
    (_, index) => `Unique action for story scene ${index + 1}. ${'visual detail '.repeat(12)}`,
  );
  const firstNumbers = Array.from({ length: 9 }, (_, index) => index + 1);
  const secondNumbers = Array.from({ length: 9 }, (_, index) => index + 10);
  const first = buildGridPrompt('forest', 'panda cast', shots.slice(0, 9), '16:9', ['cast'], firstNumbers);
  const second = buildGridPrompt('forest', 'panda cast', shots.slice(9), '16:9', ['cast'], secondNumbers);

  assert.notEqual(first, second);
  assert.match(first.slice(0, 3900), /UNIQUE STORYBOARD BATCH: 1-2-3-4-5-6-7-8-9/);
  assert.match(second.slice(0, 3900), /UNIQUE STORYBOARD BATCH: 10-11-12-13-14-15-16-17-18/);
  assert.match(first.slice(0, 3900), /story scene 9/);
  assert.match(second.slice(0, 3900), /story scene 18/);
  assert.match(first, /EXACT CAST count/);
  assert.match(first, /exactly once/);
  assert.match(first, /No captions, subtitles/);
});

test('builds nine distinct Cloudinary crop URLs for a persisted grid', () => {
  const cells = buildCloudinaryGridCellUrls(
    'https://res.cloudinary.com/demo/image/upload/v1/aid-grid-sources/grid.png',
    3000,
    1686,
  );

  assert.equal(cells.length, 9);
  assert.equal(new Set(cells).size, 9);
  assert.match(cells[0], /c_crop,x_25,y_25,w_950,h_512/);
  assert.match(cells[8], /x_2025,y_1149/);
});

test('isolates identical storyboard ids between projects', () => {
  const firstProject = createProjectId();
  const secondProject = createProjectId();

  assert.notEqual(firstProject, secondProject);
  assert.notEqual(
    scopedVideoCacheKey(firstProject, 'scene-1'),
    scopedVideoCacheKey(secondProject, 'scene-1'),
  );
  assert.notEqual(scopedVideoCacheKey(firstProject, 'scene-1'), 'storyboard-video:scene-1');
});

test('isolates different creative revisions inside the same project', () => {
  assert.notEqual(
    scopedVideoCacheKey('project-1', 'scene-1', 'h3-v2-first'),
    scopedVideoCacheKey('project-1', 'scene-1', 'h3-v2-second'),
  );
});

test('isolates repeated renders of the same creative revision by paid task id', () => {
  assert.notEqual(
    scopedVideoCacheKey('project-1', 'scene-3', 'h3-v16-same', 'comfyui:old-task'),
    scopedVideoCacheKey('project-1', 'scene-3', 'h3-v16-same', 'comfyui:new-task'),
  );
});
