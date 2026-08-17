import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkGridBatch } from '../lib/gridSplitter.ts';
import { createProjectId, scopedVideoCacheKey } from '../lib/projectIdentity.ts';

test('groups automatic storyboard images into batches of at most nine', () => {
  const shots = Array.from({ length: 19 }, (_, index) => ({ id: `scene-${index + 1}` }));
  const batches = chunkGridBatch(shots);

  assert.deepEqual(batches.map(batch => batch.length), [9, 9, 1]);
  assert.deepEqual(batches.flat().map(shot => shot.id), shots.map(shot => shot.id));
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
