import assert from 'node:assert/strict';
import test from 'node:test';

import { castCharacterVoice, castStoryVoices, lockStoryboardVoiceIds } from '../lib/voiceCasting.ts';
import { validateVoiceBindings } from '../lib/speechAudioContract.ts';

test('automatically locks a young feminine voice for a mermaid princess', () => {
  const first = castCharacterVoice({ name: '人鱼公主', description: '18岁年轻女性，美人鱼公主' }, 'zh');
  const second = castCharacterVoice({ name: '人鱼公主', description: '18岁年轻女性，美人鱼公主' }, 'zh');
  assert.equal(first.voiceId, second.voiceId);
  assert.equal(first.voiceSource, 'auto');
  assert.match(first.voiceProfile, /年轻女性/);
});

test('never replaces a user-selected voice and migrates old storyboard speech', () => {
  const cast = castStoryVoices([{ name: 'Lanxi', description: 'young mermaid princess', voiceId: 'custom-voice' }], 'en');
  assert.equal(cast[0].voiceId, 'custom-voice');
  assert.equal(cast[0].voiceSource, 'user');
  const [storyboard] = lockStoryboardVoiceIds([{
    characters: ['Lanxi'],
    speech: [{ speakerId: 'S1', character: 'Lanxi', exactLine: 'Let the tide go.', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }],
  }], cast);
  assert.equal(storyboard.speech[0].voiceId, 'custom-voice');
  assert.equal(validateVoiceBindings([storyboard]), undefined);
});

test('rejects any spoken segment that still has no explicit voice', () => {
  assert.match(validateVoiceBindings([{
    characters: ['Lanxi'],
    speech: [{ speakerId: 'S1', character: 'Lanxi', exactLine: 'Let the tide go.', emotion: '', delivery: '', volume: 'normal', lipSync: true, source: 'story_required' }],
  }]), /尚未锁定音色/);
});

