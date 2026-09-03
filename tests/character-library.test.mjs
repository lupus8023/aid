import assert from 'node:assert/strict';
import test from 'node:test';
import {
  characterFromGeneratedSeries,
  characterFromDesignRecord,
  mergeCharacterHistory,
  parseStoredArray,
  upsertCharacterHistory,
} from '../lib/characterLibrary.ts';

const design = {
  id: 'design-meme',
  name: 'Meme',
  role: 'Mermaid',
  age: 'Childlike',
  personality: 'Curious, brave',
  coreTheme: 'Explores with a kind heart',
  description: 'Brown curly hair and a turquoise tail',
  costumeDesc: 'Green top and shell pendant',
  conceptUrl: 'https://example.com/meme-concept.png',
  bibleUrl: 'https://example.com/meme-bible.png',
};

test('character designs become Story-compatible history characters', () => {
  const character = characterFromDesignRecord(design);
  assert.equal(character?.id, 'design-meme');
  assert.equal(character?.imageUrl, design.conceptUrl);
  assert.match(character?.description || '', /Mermaid/);
  assert.match(character?.description || '', /Brown curly hair/);
  assert.doesNotMatch(character?.imageUrl || '', /bible/);
});

test('existing character designs are migrated and replace stale same-name history', () => {
  const stale = { id: 'old', name: 'Meme', description: 'old', imageUrl: 'old.png' };
  const merged = mergeCharacterHistory([stale], [design]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'design-meme');
});

test('new designs upsert cleanly and malformed storage is ignored', () => {
  const character = characterFromDesignRecord(design);
  assert.ok(character);
  assert.deepEqual(parseStoredArray('{bad json'), []);
  const history = upsertCharacterHistory([{ ...character, imageUrl: 'old.png' }], character);
  assert.equal(history.length, 1);
  assert.equal(history[0].imageUrl, design.conceptUrl);
});

test('a finished series character can be saved with its card and reusable voice', () => {
  const record = characterFromGeneratedSeries('series-1', {
    id: 'c1',
    name: '武曌',
    description: '绛红圆领袍，金线窄袖。',
    imageUrl: 'https://assets.test/concept.png',
    bibleUrl: 'https://assets.test/card.png',
    voiceId: 'voice-1',
    voiceProfile: '沉稳清晰',
    voiceSource: 'auto',
    voiceLocked: true,
    voiceReferenceUrl: 'https://assets.test/voice.mp3',
    gender: 'female',
    ageGroup: 'adult',
  });
  assert.equal(record.imageUrl, 'https://assets.test/card.png');
  assert.equal(record.bibleUrl, record.imageUrl);
  assert.equal(record.voiceId, 'voice-1');
  assert.equal(record.voiceReferenceUrl, 'https://assets.test/voice.mp3');
  assert.equal(upsertCharacterHistory([], record)[0].sourceSeriesId, 'series-1');
  assert.throws(() => characterFromGeneratedSeries('series-1', {
    id: 'c2', name: '未定稿', description: '尚无图',
  }), /尚未完成/);
});
