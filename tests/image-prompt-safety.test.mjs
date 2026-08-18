import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeImagePromptSafety,
  extractImageTaskError,
  imageSafetyReasonLabel,
  isImageSafetyRejection,
  rewriteImagePromptForSafety,
} from '../lib/imagePromptSafety.ts';

test('locates graphic and lethal content in Chinese and English storyboard prompts', () => {
  assert.deepEqual(analyzeImagePromptSafety('鲜血从伤口流出，长剑刺入身体'), ['graphic-injury', 'lethal-action']);
  assert.deepEqual(analyzeImagePromptSafety('bloody open wound, a fatal stabbing'), ['graphic-injury', 'lethal-action']);
  assert.deepEqual(analyzeImagePromptSafety('camera shoots a calm winter landscape'), []);
});

test('rewrites unsafe imagery into non-graphic cinematic staging', () => {
  const rewritten = rewriteImagePromptForSafety('鲜血飞溅，长剑刺入身体，尸体倒在雪地', 2);
  assert.match(rewritten, /STRICT FAMILY-SAFE STAGING/);
  assert.doesNotMatch(rewritten, /鲜血|刺入|尸体/);
  assert.match(rewritten, /画外|失去行动能力/);
});

test('recognizes provider safety rejection variants and extracts nested reasons', () => {
  assert.equal(isImageSafetyRejection('Your prompt or input was rejected by the content safety system.'), true);
  assert.equal(isImageSafetyRejection('read ETIMEDOUT'), false);
  assert.equal(extractImageTaskError({ error: { message: 'content safety system' } }), 'content safety system');
  assert.equal(extractImageTaskError({ details: { error: { message: 'nested failure' } } }), 'nested failure');
  assert.match(imageSafetyReasonLabel(['graphic-injury', 'lethal-action']), /写实伤口.*致命动作/);
});

