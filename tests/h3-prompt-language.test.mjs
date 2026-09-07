import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';
import { h3VisualPromptIsChinese, parseChineseH3Rewrite } from '../lib/h3PromptLanguage.ts';

const storyboard = {
  id: 's1',
  sceneNumber: 1,
  characters: ['沈贵妃'],
  objects: ['金色面膜盒'],
  action: '沈贵妃从金色面膜盒中取出面膜，抬眼看向裴大人。',
  description: '沈贵妃从金色面膜盒中取出面膜，抬眼看向裴大人。',
  prompt: 'A historical palace still.',
  imageUrl: 'https://example.com/shot.jpg',
  status: 'completed',
  durationHint: 8,
  dialogueLines: [{ character: '沈贵妃', text: 'You try it first.' }],
  videoDirection: {
    action: '沈贵妃用右手打开金色面膜盒，取出面膜后抬眼看向裴大人。',
    camera: '固定中景，镜头轻微推近她的手和眼神。',
    detail: '她的指尖捏住面膜边缘，眉峰缓慢抬起。',
    ending: '她将面膜停在胸前，视线落在裴大人脸上。',
  },
  visualStyle: 'cinematic-natural',
  audioPlan: { backgroundHuman: 'none', environment: [], foley: [], music: 'none' },
};

test('H3 prompt keeps all direction Chinese while exact dialogue follows English project language', () => {
  const prompt = buildVideoSegmentPrompt([storyboard], [], { duration: 8, language: 'en' });
  assert.equal(h3VisualPromptIsChinese(prompt), true);
  assert.match(prompt, /<d>\[English] You try it first\.<\/d>/);
  assert.equal((prompt.match(/You try it first\./g) || []).length, 1);
  assert.doesNotMatch(prompt, /The shot follows|Dialogue exists only|REFERENCE IMAGE|CAMERA:/i);
  assert.match(prompt, /逐字对白仅由声音承载/);
});

test('language detector ignores exact dialogue and H3 machine labels, not English directing prose', () => {
  assert.equal(h3VisualPromptIsChinese('subject_definitions:\n<Subject 1>是<Picture 1>中的Lin。\ndetailed_description:\n人物缓慢抬手，镜头固定。\n对白：<d>[English] This is the exact line.</d>'), true);
  assert.equal(h3VisualPromptIsChinese('REFERENCE IMAGE: Preserve the exact opening frame. CAMERA: Slowly push toward the actor. <d>[Chinese] 这是台词。</d>'), false);
});

test('English legacy prompt rewrite preserves exact dialogue byte for byte', () => {
  const original = 'CAMERA: Push in slowly. Dialogue: <d>[English] Keep this exact line.</d>';
  const rewritten = parseChineseH3Rewrite(
    JSON.stringify({ prompt: '镜头缓慢推近。对白：<d>[English] Keep this exact line.</d> 画面中不添加字幕。' }),
    original,
  );
  assert.equal(h3VisualPromptIsChinese(rewritten), true);
  assert.match(rewritten, /<d>\[English] Keep this exact line\.<\/d>/);
  assert.throws(() => parseChineseH3Rewrite(
    JSON.stringify({ prompt: '镜头缓慢推近。对白：<d>[English] Changed line.</d>' }),
    original,
  ), /改变了逐字台词/);
});
