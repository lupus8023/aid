import assert from 'node:assert/strict';
import test from 'node:test';

import { castCharacterVoice, castStoryVoices, fishAutoVoiceCandidates, lockStoryboardVoiceIds, normalizeFishVoiceId, resolveGeneratedStoryIdentity } from '../lib/voiceCasting.ts';
import { validateVoiceBindings } from '../lib/speechAudioContract.ts';
import { fishS2ControlledText } from '../lib/fishSpeechControl.ts';
import { effectiveStoryCast } from '../lib/storyCast.ts';
import { characterAliasValues, characterIdentityIndex, withoutCharacterValues } from '../lib/characterIdentity.ts';
import { recoverSeriesStoryAliases } from '../lib/series/storyCastRecovery.ts';
import { reconcileSeriesProductionContract } from '../lib/series/productionContract.ts';

test('registered 贵妃 alias reuses 沈贵妃 casting in both boards and stale segment speech', () => {
  const actor = { id: 'c1', name: '唐朝贵妃', aliases: ['贵妃', '娘娘', '沈贵妃'],
    voiceId: 'library-voice', voiceLocked: true, imageUrl: 'existing-card.png' };
  const cast = effectiveStoryCast([actor], [{ name: '贵妃', voiceId: '' }]);
  assert.equal(cast.length, 1);
  const original = { characters: ['贵妃'], speech: [{ character: '贵妃', speakerId: 'S1', exactLine: '你先试。', voiceId: '' }] };
  const [bound] = lockStoryboardVoiceIds([original], cast);
  assert.equal(bound.speech[0].voiceId, 'library-voice');
  assert.equal(validateVoiceBindings([bound]), undefined);
  assert.deepEqual(bound.speech[0], { ...original.speech[0], voiceId: 'library-voice' });
  assert.equal(original.speech[0].voiceId, '');
  const [segment] = lockStoryboardVoiceIds([{ ...original, id: 'segment', speech: original.speech.map(line => ({ ...line, voiceId: 'old-voice' })) }], cast);
  assert.equal(segment.speech[0].voiceId, 'library-voice');
  const refs = characterAliasValues({ 沈贵妃: 'existing-reference.mp3' }, cast);
  assert.equal(refs.贵妃, 'existing-reference.mp3');
  assert.equal(refs.唐朝贵妃, 'existing-reference.mp3');
  assert.deepEqual(withoutCharacterValues(refs, '贵妃', cast), {});
});

test('similar names and ambiguous aliases never borrow another actor voice', () => {
  const cast = [{ name: '沈贵妃', aliases: ['贵妃'], voiceId: 'a' }, { name: '李贵妃', aliases: ['贵妃'], voiceId: 'b' }];
  assert.equal(characterIdentityIndex(cast).resolve('贵妃'), undefined);
  assert.equal(characterIdentityIndex([{ name: '沈贵妃' }]).resolve('贵妃'), undefined);
  const [board] = lockStoryboardVoiceIds([{ speech: [{ character: '贵妃', voiceId: 'stale' }] }], cast);
  assert.equal(board.speech[0].voiceId, undefined);
  assert.equal(characterAliasValues({ 沈贵妃: 'a.mp3', 李贵妃: 'b.mp3' }, cast).贵妃, undefined);
  assert.equal(characterIdentityIndex([...cast, { name: '贵妃', voiceId: 'exact' }]).resolve('贵妃').voiceId, 'exact');
});

test('series contract canonicalizes registered speaker aliases without touching spoken words', () => {
  const contract = { shotCount: 1, voices: { 贵妃: 'old' }, dialogue: [{ character: '贵妃', text: '沈贵妃，你先试。' }],
    shots: [{ characters: ['贵妃'], dialogue: [{ character: '贵妃', text: '沈贵妃，你先试。' }] }] };
  const repaired = reconcileSeriesProductionContract(contract, [{ name: '唐朝贵妃', aliases: ['贵妃', '沈贵妃'], voiceId: 'locked' }]);
  assert.deepEqual(repaired.voices, { 唐朝贵妃: 'locked' });
  assert.deepEqual(repaired.shots[0].characters, ['唐朝贵妃']);
  assert.equal(repaired.dialogue[0].text, '沈贵妃，你先试。');
  assert.equal(contract.dialogue[0].character, '贵妃');
});

test('legacy series Story recovers aliases only from its owner and stable ID without changing assets', () => {
  const snapshot = [{ id: 'c1', name: '唐朝贵妃', voiceId: 'user-selected', imageUrl: 'saved.png' }];
  const series = { id: 'series-a', episodes: [{ id: 'ep-1', version: 1 }], characters: [
    { id: 'c1', name: '唐朝贵妃', aliases: ['贵妃', '娘娘'], casting: { name: '沈贵妃' }, voiceId: 'different', imageUrl: 'new.png' },
  ] };
  const [recovered] = recoverSeriesStoryAliases('series-a-ep-1-v1', snapshot, [series]);
  assert.deepEqual(recovered, { ...snapshot[0], aliases: ['贵妃', '娘娘', '沈贵妃'] });
  assert.equal(recoverSeriesStoryAliases('series-other-ep-1-v1', snapshot, [series]), snapshot);
  assert.equal(snapshot[0].aliases, undefined);
  assert.equal(recoverSeriesStoryAliases('series-a-ep-1-v1', [recovered], [series])[0], recovered);
});

test('screenplay-discovered supporting roles receive one reusable character-card identity', () => {
  const cast = effectiveStoryCast([{
    id: 'uploaded-lead', name: '人鱼公主', description: 'uploaded card', imageUrl: 'lead.png',
  }], [{
    name: '人鱼公主', role: 'lead', want: '', obstacle: '', arc: '', subtext: '',
  }, {
    name: 'Old Sea Turtle', role: 'ancient mentor', gender: 'male', ageGroup: 'senior',
    want: 'help Lanxi release control', obstacle: 'her fear', arc: 'waits then guides', subtext: 'quiet affection',
  }]);
  assert.deepEqual(cast.map(character => character.name), ['人鱼公主', 'Old Sea Turtle']);
  assert.equal(cast[0].imageUrl, 'lead.png');
  assert.equal(cast[1].id, 'story-plan:Old Sea Turtle');
  assert.match(cast[1].description, /ancient mentor/);
  assert.match(cast[1].description, /species anatomy/);
});

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
    { name: 'Old Sea Turtle', description: 'elder male turtle', voiceSource: 'auto' },
    { name: 'Mother', description: 'middle-aged woman', voiceSource: 'auto' },
  ], 'en');
  assert.equal(new Set(cast.map(character => character.voiceId)).size, cast.length);
  assert.equal(cast.find(character => character.name === 'Mermaid Princess').voiceId, '6d5d07dcc342440ba701aa36f7daf42f');
  assert.equal(cast.find(character => character.name === 'Tide Officer').voiceId, '145d5c8c614f4852a029346ebb5d42db');
  assert.notEqual(cast.find(character => character.name === 'Mermaid Princess').voiceId, '27254d2e219945c9896da5cc5e1e77f1');
  assert.match(cast.find(character => character.name === 'Old Sea Turtle').voiceProfile, /masculine/);
  assert.match(cast.find(character => character.name === 'Mother').voiceProfile, /mature feminine/);
});

test('never defaults an unknown supporting role to a feminine voice', () => {
  const unknown = castCharacterVoice({ name: 'Tide Officer', description: 'supporting palace officer' }, 'en');
  assert.equal(unknown.gender, 'unknown');
  assert.equal(unknown.voiceId, '');
  assert.match(unknown.voiceProfile, /review required/);

  const male = castCharacterVoice({
    name: 'Tide Officer',
    description: 'supporting palace officer',
    gender: 'male',
    ageGroup: 'adult',
  }, 'en');
  assert.equal(male.gender, 'male');
  assert.match(male.voiceProfile, /masculine/);
  assert.ok(male.voiceId);
});

test('a screenplay-generated ambiguous role locks one production identity for both card and voice', () => {
  const identity = resolveGeneratedStoryIdentity({
    name: 'Tide Officer',
    description: 'Text-defined supporting story identity explicitly named by the user.',
    role: 'supporting palace officer',
  });
  assert.equal(identity.gender, 'male');
  assert.equal(identity.ageGroup, 'adult');
  const cast = castCharacterVoice(identity, 'en');
  assert.ok(cast.voiceId);
  assert.match(cast.voiceProfile, /masculine/);
});

test('automatic Fish fallback never crosses from a male voice into a female pool', () => {
  const male = castCharacterVoice({ name: 'Guard', gender: 'male', ageGroup: 'adult' }, 'en');
  assert.deepEqual(fishAutoVoiceCandidates(male.voiceId), [male.voiceId]);
});

test('an unresolved project cast clears a legacy per-line voice instead of hiding it', () => {
  const [storyboard] = lockStoryboardVoiceIds([{
    speech: [{ character: 'Tide Officer', voiceId: 'legacy-wrong-voice' }],
  }], [{ name: 'Tide Officer', gender: 'unknown', voiceId: '' }]);
  assert.equal(storyboard.speech[0].voiceId, undefined);
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
