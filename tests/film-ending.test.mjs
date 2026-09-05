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
    assert.equal(prompt.includes('整片结束时，'), shot.id === 'shot-18');
    assert.equal((prompt.match(/<d>\[English] We are home\.<\/d>/g) || []).length, 1);
    if (shot.id === 'shot-18') {
      assert.match(prompt, /只有末镜的00:05\.000–00:06\.000区间没有对白或旁白/);
      assert.match(prompt, /声音保持计划中的环境声与配乐，或保持刻意静默/);
      assert.ok(prompt.length <= 7000);
    }
  }
  const grouped = buildVideoSegmentPrompt(shots.slice(15), [], { duration: 15, isFilmEnding: true });
  assert.equal((grouped.match(/整片结束时，/g) || []).length, 1);
  assert.match(grouped, /只有末镜的00:14\.000–00:15\.000/);
  const firstLast = buildVideoSegmentPrompt([shots[17]], [], { duration: 6, firstFrameUrl: 'opening', isFilmEnding: true });
  assert.match(firstLast, /整片结束时，/);
});

test('saved prompt overrides refresh the ending interval without duplicating it or altering dialogue', () => {
  const original = 'detailed_description:\n<d>[English] We are home.</d>\n\noverall_soundscape: Sea waves.\n\nnon_diegetic_music: N/A';
  const once = applyFilmEndingPrompt(original, 6, true);
  assert.equal(applyFilmEndingPrompt(once, 6, true), once);
  const twice = applyFilmEndingPrompt(once, 8, true);
  assert.equal((twice.match(/整片结束时，/g) || []).length, 1);
  assert.match(twice, /00:07\.000–00:08\.000/);
  assert.doesNotMatch(applyFilmEndingPrompt(twice, 8, false), /整片结束时，/);
  assert.ok(twice.includes('<d>[English] We are home.</d>'));
});
