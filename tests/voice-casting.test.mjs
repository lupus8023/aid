import assert from 'node:assert/strict';
import test from 'node:test';

import { castCharacterVoice, castStoryVoices, fishAutoVoiceCandidates, lockStoryboardVoiceIds, normalizeFishVoiceId } from '../lib/voiceCasting.ts';
import { validateVoiceBindings } from '../lib/speechAudioContract.ts';
import { fishS2ControlledText } from '../lib/fishSpeechControl.ts';

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

test('casts distinct role-appropriate voices across an English ensemble', () => {
  const cast = castStoryVoices([
    { name: 'Mermaid Princess', description: 'young woman', voiceSource: 'auto' },
    { name: 'Tide Officer', description: 'young female officer', voiceSource: 'auto' },
    { name: 'A-Luo', description: 'young woman', voiceSource: 'auto' },
    { name: 'Old Sea Turtle', description: 'elder turtle', voiceSource: 'auto' },
    { name: 'Mother', description: 'middle-aged woman', voiceSource: 'auto' },
  ], 'en');
  assert.equal(new Set(cast.map(character => character.voiceId)).size, cast.length);
  assert.equal(cast.find(character => character.name === 'Mermaid Princess').voiceId, '6d5d07dcc342440ba701aa36f7daf42f');
  assert.equal(cast.find(character => character.name === 'Tide Officer').voiceId, '145d5c8c614f4852a029346ebb5d42db');
  assert.notEqual(cast.find(character => character.name === 'Mermaid Princess').voiceId, '27254d2e219945c9896da5cc5e1e77f1');
  assert.match(cast.find(character => character.name === 'Old Sea Turtle').voiceProfile, /masculine/);
  assert.match(cast.find(character => character.name === 'Mother').voiceProfile, /mature feminine/);
});

test('migrates a retired automatic Fish reference without touching custom ids', () => {
  const retired = '8ef4a238714b45718ce04243307c57a7';
  assert.equal(normalizeFishVoiceId(retired), '145d5c8c614f4852a029346ebb5d42db');
  assert.deepEqual(fishAutoVoiceCandidates('custom-fish-reference'), ['custom-fish-reference']);
  assert.ok(fishAutoVoiceCandidates(retired).length > 1);
  const [storyboard] = lockStoryboardVoiceIds([{
    speech: [{ character: 'A-Luo', voiceId: retired }],
  }], []);
  assert.equal(storyboard.speech[0].voiceId, '145d5c8c614f4852a029346ebb5d42db');
});

test('Fish delivery control never changes or absorbs the exact spoken line', () => {
  const exactLine = 'Princess, the Southern Bay channel is blocked.';
  const controlled = fishS2ControlledText(exactLine, 'urgent', 'fast but controlled');
  assert.equal(controlled, `[urgent but controlled] ${exactLine}`);
  assert.equal(fishS2ControlledText('I can do this.', 'determined', 'firm'), '[calm determination] I can do this.');
  assert.equal(fishS2ControlledText(exactLine, 'neutral', 'plainly'), exactLine);
  assert.doesNotMatch(controlled, /先短暂停顿|坚定语气|无其他角色/u);
});
