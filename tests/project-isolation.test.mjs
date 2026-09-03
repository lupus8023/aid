import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGridPrompt, chunkGridBatch } from '../lib/gridSplitter.ts';
import { buildCloudinaryGridCellUrls } from '../lib/gridCloudinary.ts';
import { createProjectId, scopedVideoCacheKey } from '../lib/projectIdentity.ts';

test('groups automatic storyboard images into batches of at most four', () => {
  const shots = Array.from({ length: 11 }, (_, index) => ({ id: `scene-${index + 1}` }));
  const batches = chunkGridBatch(shots);

  assert.deepEqual(batches.map(batch => batch.length), [4, 4, 3]);
  assert.deepEqual(batches.flat().map(shot => shot.id), shots.map(shot => shot.id));
});

test('keeps every image batch distinct before the provider truncation boundary', () => {
  const shots = Array.from(
    { length: 8 },
    (_, index) => `Unique action for story scene ${index + 1}. ${'visual detail '.repeat(12)}`,
  );
  const firstNumbers = Array.from({ length: 4 }, (_, index) => index + 1);
  const secondNumbers = Array.from({ length: 4 }, (_, index) => index + 5);
  const first = buildGridPrompt('forest', 'panda cast', shots.slice(0, 4), '16:9', ['cast'], firstNumbers);
  const second = buildGridPrompt('forest', 'panda cast', shots.slice(4), '16:9', ['cast'], secondNumbers);

  assert.notEqual(first, second);
  assert.match(first.slice(0, 3900), /UNIQUE STORYBOARD BATCH: 1-2-3-4/);
  assert.match(second.slice(0, 3900), /UNIQUE STORYBOARD BATCH: 5-6-7-8/);
  assert.match(first.slice(0, 3900), /story scene 4/);
  assert.match(second.slice(0, 3900), /story scene 8/);
  assert.match(first, /Each frame's stated people are authoritative/);
  assert.match(first, /exactly once/);
  assert.match(first, /No headings, camera terms, captions, subtitles/);
});

test('builds four distinct Cloudinary crop URLs for a persisted grid', () => {
  const cells = buildCloudinaryGridCellUrls(
    'https://res.cloudinary.com/demo/image/upload/v1/aid-grid-sources/grid.png',
    3000,
    1686,
  );

  assert.equal(cells.length, 4);
  assert.equal(new Set(cells).size, 4);
  assert.match(cells[0], /c_crop,x_38,y_38,w_1424,h_767/);
  assert.match(cells[3], /x_1538,y_881/);
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
