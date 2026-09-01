import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoDuplicates, prepareVideoDuplicateRepair, videoDuplicateAuditContext, videoDuplicateAuditScope, videoHasClosedCast } from '../lib/videoDuplicateAudit.ts';
import { videoSegmentGenerationSignature } from '../lib/videoSegments.ts';
import { applyVideoDuplicateRepairPrompt, buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';

test('count distinct bodies within each frame, not repeated appearances across the sequence', () => {
  const luna = position => ({ name: 'Luna', position, evidence: 'Short black hair with pale streak and teal coat.' });
  const raw = visible => JSON.stringify({ observations: visible.map((v, i) => ({ frame: i + 1, visible: v })) });
  assert.equal(parseVideoDuplicates(raw([[luna('left')], [luna('right')], [luna('left')]]), ['Luna']).passed, true);
  assert.equal(parseVideoDuplicates(raw([[luna('left')], [luna('left'), luna('right')], [luna('left')]]), ['Luna']).passed, null);
  assert.equal(parseVideoDuplicates(raw([[luna('left'), luna('right')], [luna('left'), luna('right')], []]), ['Luna']).passed, false);
  const extra = { name: null, position: 'right', evidence: 'Another cropped woman in a teal coat.' };
  assert.equal(parseVideoDuplicates(raw([[luna('left'), extra], [luna('left'), extra], []]), ['Luna'], true).passed, false);
  assert.equal(parseVideoDuplicates(raw([[luna('left'), extra], [luna('left'), extra], []]), ['Luna'], false).passed, true);
  assert.equal(videoHasClosedCast('Luna and Rill stand at an arch. An offscreen crowd swells.'), true);
  assert.equal(videoHasClosedCast('Victoria waits with two clerks behind her.'), false);
  assert.equal(videoHasClosedCast("Bram's envoys turn their backs on Victoria and lean toward the trade map."), false);
  assert.equal(videoHasClosedCast('The emissaries wait behind the speaking stone.'), false);
  assert.equal(videoHasClosedCast('The hall behind them ripples with a few visible reactions.'), false);
  assert.equal(videoHasClosedCast('None of them move far, but the room around them reacts as the bargain hardens.'), false);
  assert.equal(videoHasClosedCast('Luna studies Bram while armed sharks stacked behind him hold their line.'), false);
  assert.equal(videoHasClosedCast(videoDuplicateAuditContext({ description: 'Luna reads a tablet.', videoDirection: { camera: 'Hold while Oscar and the crowd remain visible behind her.' } })), false);
  assert.equal(videoHasClosedCast('Luna watches the soaked cleanup team drag a covered body past the dais.'), false);
  const edited = 'At 00:01.000, she says <d>[English] Absolutely not.</d>';
  const once = applyVideoDuplicateRepairPrompt(edited, 'Exactly one body.');
  assert.equal(applyVideoDuplicateRepairPrompt(once, 'Exactly one body.'), once);
  assert.ok(once.includes('<d>[English] Absolutely not.</d>'));
});

test('combined H3 segments audit every authored shot with one stable cast scope', () => {
  const scope = videoDuplicateAuditScope([
    { sceneNumber: 13, characters: ['Luna', 'Inkfin'], description: 'Luna faces Inkfin.', videoDirection: { action: 'Inkfin waits.' } },
    { sceneNumber: 14, characters: ['Inkfin', 'Tilda'], description: 'Tilda enters beside Inkfin.', videoDirection: { camera: 'Track toward the desk.' } },
  ]);
  assert.deepEqual(scope.names, ['Luna', 'Inkfin', 'Tilda']);
  assert.match(scope.context, /Shot 13: Luna faces Inkfin\. Inkfin waits\./);
  assert.match(scope.context, /Shot 14: Tilda enters beside Inkfin\. Track toward the desk\./);
});

test('only supported duplicate-body evidence across multiple sampled frames allows a repair', () => {
  const parse = duplicates => parseVideoDuplicates(JSON.stringify({ reviewedAllFrames: true, duplicates }), ['Luna', 'Rill']);
  assert.equal(parse([]).passed, true);
  assert.equal(parse([{ name: 'Luna', frames: [2], evidence: 'Two partially visible bodies at left and right.' }]).passed, null);
  assert.equal(parse([{ name: 'Luna', frames: [2,2], evidence: 'Same frame repeated.' }]).passed, null);
  assert.equal(parse([{ name: 'Luna', frames: [1,2], evidence: 'Two matching faces and bodies on opposite sides of Rill in both frames.' }]).passed, false);
  assert.throws(() => parse([{ name: 'unknown', frames: [1,2], evidence: 'x' }]), /证据/);
  assert.throws(() => parse([{ name: 'Luna', frames: [1,4], evidence: 'x' }]), /证据/);
  assert.throws(() => parseVideoDuplicates('{}', ['Luna']), /格式/);
});

test('repair preserves existing media receipts, exact speech and every other shot, with a durable bound', () => {
  const earlier = { id: 'first', sceneNumber: 1, videoTaskId: 'other-paid', videoStatus: 'completed' };
  const bad = { id: 'bad', sceneNumber: 2, characters: ['Luna'], imageUrl: 'approved.png', videoTaskId: 'paid-bad', videoStatus: 'completed', videoCacheKey: 'old', speech: [{ character: 'Luna', exactLine: 'Absolutely not.' }], description: 'Luna reads the paper.' };
  const audit = { taskId: 'paid-bad', passed: false, duplicates: [{ name: 'Luna', frames: [1,2], evidence: 'Two matching bodies.' }] };
  const repaired = prepareVideoDuplicateRepair([earlier, bad], [bad], audit);
  assert.equal(repaired[0], earlier);
  assert.equal(repaired[1].imageUrl, bad.imageUrl);
  assert.deepEqual(repaired[1].speech, bad.speech);
  assert.equal(repaired[1].videoTaskId, undefined);
  assert.equal(repaired[1].videoDuplicateRepairAttempts, 1);
  assert.equal(repaired[1].videoDuplicateHistory[0].taskId, 'paid-bad');
  assert.equal(repaired[1].videoDuplicateHistory[0].videoCacheKey, 'old');
  assert.notEqual(videoSegmentGenerationSignature([bad]), videoSegmentGenerationSignature([repaired[1]]));
  const prompt = buildVideoSegmentPrompt([repaired[1]], [], { duration: 6, language: 'en' });
  assert.match(prompt, /same single body/);
  assert.equal((prompt.match(/<d>\[English] Absolutely not\.<\/d>/g) || []).length, 1);
  assert.throws(() => prepareVideoDuplicateRepair([bad], [bad], { ...audit, taskId: 'stale' }), /明确证据/);
  const exhausted = { ...bad, videoDuplicateRepairAttempts: 2 };
  assert.throws(() => prepareVideoDuplicateRepair([exhausted], [exhausted], audit), /上限/);
  assert.throws(() => prepareVideoDuplicateRepair([bad], [bad], { ...audit, passed: null }), /明确证据/);
});
