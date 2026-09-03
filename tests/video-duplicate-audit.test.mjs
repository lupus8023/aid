import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoDuplicates, prepareVideoDuplicateRepair, videoDuplicateAuditContext, videoDuplicateAuditScope, videoHasClosedCast, videoSubtitleRemovalSourceTaskId } from '../lib/videoDuplicateAudit.ts';
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
  assert.equal(videoHasClosedCast('小太监端着茶盏跨进来，青鸾抬手压住笑意。'), false);
  assert.equal(videoHasClosedCast('来人进殿看见贵妃脸上的面膜布而僵住。'), false);
  const edited = 'At 00:01.000, she says <d>[English] Absolutely not.</d>';
  const once = applyVideoDuplicateRepairPrompt(edited, 'Exactly one body.');
  assert.equal(applyVideoDuplicateRepairPrompt(once, 'Exactly one body.'), once);
  assert.ok(once.includes('<d>[English] Absolutely not.</d>'));
});

test('puts confirmed visual repairs inside the official detailed section before shots', () => {
  const prompt = `subject_definitions:\n<Subject 1> is Luna.\n\nsummary:\nOne shot.\n\nretention_analysis:\nKeep Luna.\n\ndetailed_description:\n[Shot 1] Luna speaks <d>[English] Stop.</d>\n\noverall_soundscape:\nRoom tone.\n\nnon_diegetic_music:\nN/A`;
  const repaired = applyVideoDuplicateRepairPrompt(prompt, '画面必须完全无字幕。');
  assert.ok(repaired.indexOf('detailed_description:') < repaired.indexOf('For this regeneration, correct the confirmed visual anomaly:'));
  assert.ok(repaired.indexOf('For this regeneration, correct the confirmed visual anomaly:') < repaired.indexOf('[Shot 1]'));
  assert.ok(repaired.indexOf('[Shot 1]') < repaired.indexOf('overall_soundscape:'));
  assert.match(repaired, /ordered <d> blocks remain soundtrack audio only/);
  assert.equal((repaired.match(/<d>\[English] Stop\.<\/d>/g) || []).length, 1);
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

test('burned dialogue text requires adjacent-frame confirmation and ignores physical labels', () => {
  const frame = (number, readableText) => ({ frame: number, visible: [], readableText });
  const subtitle = text => ({ text, position: 'bottom center', kind: 'subtitle', evidence: 'white dialogue glyphs over the picture' });
  const physical = { text: '御赐', position: 'engraved on box', kind: 'physical_label', evidence: 'moves with the prop surface' };
  const one = parseVideoDuplicates(JSON.stringify({ observations: [frame(1, [subtitle('娘娘')]), frame(2, []), frame(3, [physical])] }), []);
  assert.equal(one.passed, null);
  assert.deepEqual(one.subtitles[0].frames, [1]);
  const confirmed = parseVideoDuplicates(JSON.stringify({ observations: [frame(1, [subtitle('娘娘')]), frame(2, [subtitle('娘娘')]), frame(3, [physical])] }), []);
  assert.equal(confirmed.passed, false);
  assert.match(confirmed.reason, /烧录字幕/);
  const clean = parseVideoDuplicates(JSON.stringify({ observations: [frame(1, [physical]), frame(2, []), frame(3, [])] }), []);
  assert.equal(clean.passed, true);
  assert.deepEqual(clean.subtitles, []);
});

test('confirmed burned subtitles create a text-free retry without changing dialogue', () => {
  const board = { id: 'bad-text', sceneNumber: 4, characters: [], imageUrl: 'approved.png', videoTaskId: 'paid-text', videoStatus: 'completed', speech: [{ character: '甲', exactLine: '娘娘。' }] };
  const audit = { taskId: 'paid-text', passed: false, duplicates: [], subtitles: [{ text: '娘娘', frames: [1, 2, 3], evidence: 'bottom-center white text' }] };
  const repaired = prepareVideoDuplicateRepair([board], [board], audit);
  assert.equal(repaired[0].videoTaskId, undefined);
  assert.deepEqual(repaired[0].speech, board.speech);
  assert.match(repaired[0].videoDuplicateRepairPrompt, /画面必须完全无字幕/);
  assert.match(repaired[0].videoDuplicateRepairPrompt, /对白只存在于音轨中/);
  assert.equal(videoSubtitleRemovalSourceTaskId(repaired[0]), 'paid-text');
});

test('does not route duplicate-only repairs through subtitle-removal V2V', () => {
  const board = {
    videoDuplicateRepairPrompt: 'Keep exactly one body.',
    videoDuplicateHistory: [{ taskId: 'paid-duplicate', audit: { subtitles: [], duplicates: [{ name: 'A', frames: [1, 2] }] } }],
  };
  assert.equal(videoSubtitleRemovalSourceTaskId(board), undefined);
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
  const exhausted = { ...bad, videoDuplicateRepairAttempts: 3 };
  assert.throws(() => prepareVideoDuplicateRepair([exhausted], [exhausted], audit), /上限/);
  assert.throws(() => prepareVideoDuplicateRepair([bad], [bad], { ...audit, passed: null }), /明确证据/);
});

test('extra-body repair names the full closed cast and exact body count', () => {
  const board = {
    id: 'scene-3', sceneNumber: 3, characters: ['Inkfin', 'Clawrence', 'Bram Brinejaw'],
    description: 'Three characters stand together.', videoStatus: 'completed',
    videoTaskId: 'comfyui:extra', videoUrl: 'blob:extra',
  };
  const repaired = prepareVideoDuplicateRepair([board], [board], {
    version: 1, taskId: 'comfyui:extra', mediaSha256: 'b'.repeat(64), passed: false,
    reason: 'extra body', checkedAt: new Date().toISOString(),
    duplicates: [{ name: '__extra__', frames: [1, 2, 3], evidence: 'four bodies' }],
  });
  assert.match(repaired[0].videoDuplicateRepairPrompt, /exactly 3 visible story-character bodies total/i);
  assert.match(repaired[0].videoDuplicateRepairPrompt, /Inkfin, Clawrence, Bram Brinejaw/);
  assert.match(repaired[0].videoDuplicateRepairPrompt, /No fourth body/);
});

test('legacy vague extra-body checkpoint gets one bounded exact-cast migration repair', () => {
  const board = {
    id: 'scene-3', sceneNumber: 3, characters: ['Inkfin', 'Clawrence', 'Bram Brinejaw'],
    description: 'Three characters stand together.', videoStatus: 'completed',
    videoTaskId: 'comfyui:legacy-extra', videoDuplicateRepairAttempts: 3,
    videoDuplicateRepairPrompt: 'Keep exactly one visible instance of each named character. Each person must remain the same single body throughout this shot.',
  };
  const audit = {
    version: 1, taskId: 'comfyui:legacy-extra', mediaSha256: 'c'.repeat(64), passed: false,
    reason: 'extra body', checkedAt: new Date().toISOString(),
    duplicates: [{ name: '__extra__', frames: [1, 2, 3], evidence: 'four bodies' }],
  };
  const migrated = prepareVideoDuplicateRepair([board], [board], audit);
  assert.equal(migrated[0].videoDuplicateRepairAttempts, 4);
  assert.match(migrated[0].videoDuplicateRepairPrompt, /exactly 3 visible story-character bodies total/i);
  assert.throws(() => prepareVideoDuplicateRepair(
    [{ ...board, videoDuplicateRepairAttempts: 4, videoDuplicateRepairPrompt: migrated[0].videoDuplicateRepairPrompt }],
    [{ ...board, videoDuplicateRepairAttempts: 4, videoDuplicateRepairPrompt: migrated[0].videoDuplicateRepairPrompt }],
    audit,
  ), /上限/);
});

test('legacy H3 subtitle redraws get one migration to temporal inpainting', () => {
  const board = {
    id: 'scene-text', sceneNumber: 1, characters: ['裴行简'], description: '裴行简举起面膜袋。',
    videoStatus: 'completed', videoTaskId: 'comfyui:legacy-redraw', videoDuplicateRepairAttempts: 3,
    videoDuplicateRepairPrompt: '画面必须完全无字幕。',
    videoDuplicateHistory: [{
      taskId: 'comfyui:older-redraw',
      audit: { subtitles: [{ text: '乱码', frames: [1, 2], evidence: 'bottom text' }] },
    }],
  };
  const audit = {
    taskId: 'comfyui:legacy-redraw', passed: false, duplicates: [],
    subtitles: [{ text: '乱码', frames: [1, 2, 3], evidence: 'bottom-center white text' }],
  };
  const migrated = prepareVideoDuplicateRepair([board], [board], audit);
  assert.equal(migrated[0].videoDuplicateRepairAttempts, 4);
  assert.equal(videoSubtitleRemovalSourceTaskId(migrated[0]), 'comfyui:legacy-redraw');
  const exhausted = {
    ...board,
    videoTaskId: 'comfyui-subtitle:already-tried',
    videoDuplicateRepairAttempts: 4,
    videoDuplicateHistory: [{ ...board.videoDuplicateHistory[0], taskId: 'comfyui-subtitle:already-tried' }],
  };
  assert.throws(() => prepareVideoDuplicateRepair(
    [exhausted], [exhausted], { ...audit, taskId: exhausted.videoTaskId },
  ), /上限/);
});
