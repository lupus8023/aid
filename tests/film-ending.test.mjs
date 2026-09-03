import assert from 'node:assert/strict';
import test from 'node:test';
import { isFilmEndingSegment } from '../lib/filmEnding.ts';
import { applyFilmEndingPrompt, buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';

const shots = Array.from({ length: 18 }, (_, i) => ({
  id: `shot-${i + 1}`, sceneNumber: i + 1, characters: ['Lin'], status: 'completed',
  prompt: '', description: 'Lin lowers the envelope onto the table.', durationHint: 4,
  speech: [{ character: 'Lin', exactLine: 'We are home.' }],
}));

test('the film ending is determined by the full screenplay, not batch ends or a fixed shot number', () => {
  assert.equal(isFilmEndingSegment(shots, []), false);
  assert.equal(isFilmEndingSegment([], [shots[17]]), false);
  for (const shot of shots.slice(0, -1)) assert.equal(isFilmEndingSegment(shots, [shot]), false);
  assert.equal(isFilmEndingSegment(shots, shots.slice(15)), true);
  assert.equal(isFilmEndingSegment([...shots].reverse(), [shots[17]]), true);
  assert.equal(isFilmEndingSegment(shots.slice(0, 8), [shots[7]]), true);
});

test('only final shot gets the one-second no-speech interval, with exact dialogue unchanged', () => {
  for (const shot of shots) {
    const prompt = buildVideoSegmentPrompt([shot], [], {
      duration: 6, language: 'en', isFilmEnding: isFilmEndingSegment(shots, [shot]),
    });
    assert.equal(prompt.includes('At the end of the complete film,'), shot.id === 'shot-18');
    assert.equal((prompt.match(/<d>\[English] We are home\.<\/d>/g) || []).length, 1);
    if (shot.id === 'shot-18') {
      assert.match(prompt, /only the final shot's 00:05\.000–00:06\.000 interval contains no dialogue or narration/);
      assert.match(prompt, /accompanied by the planned ambience and music or by intentional silence/);
      assert.ok(prompt.length <= 7000);
    }
  }
  const grouped = buildVideoSegmentPrompt(shots.slice(15), [], { duration: 15, isFilmEnding: true });
  assert.equal((grouped.match(/At the end of the complete film,/g) || []).length, 1);
  assert.match(grouped, /only the final shot's 00:14\.000–00:15\.000/);
  const firstLast = buildVideoSegmentPrompt([shots[17]], [], { duration: 6, firstFrameUrl: 'opening', isFilmEnding: true });
  assert.match(firstLast, /At the end of the complete film,/);
});

test('saved prompt overrides refresh the ending interval without duplicating it or altering dialogue', () => {
  const original = 'detailed_description:\n<d>[English] We are home.</d>\n\noverall_soundscape: Sea waves.\n\nnon_diegetic_music: N/A';
  const once = applyFilmEndingPrompt(original, 6, true);
  assert.equal(applyFilmEndingPrompt(once, 6, true), once);
  const twice = applyFilmEndingPrompt(once, 8, true);
  assert.equal((twice.match(/At the end of the complete film,/g) || []).length, 1);
  assert.match(twice, /00:07\.000–00:08\.000/);
  assert.doesNotMatch(applyFilmEndingPrompt(twice, 8, false), /At the end of the complete film,/);
  assert.ok(twice.includes('<d>[English] We are home.</d>'));
});
