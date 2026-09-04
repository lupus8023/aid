import type { Character } from '@/types';

export const CHARACTER_HISTORY_STORAGE_KEY = 'character_history';
export const CHARACTER_DESIGNS_STORAGE_KEY = 'aidCharacterDesigns';
export const MAX_CHARACTER_HISTORY = 50;

export interface CharacterDesignLibraryRecord {
  id: string;
  name: string;
  role?: string;
  age?: string;
  personality?: string;
  coreTheme?: string;
  description?: string;
  costumeDesc?: string;
  visualStyle?: string;
  conceptUrl?: string;
  bibleUrl?: string;
  createdAt?: string;
}

export interface GeneratedSeriesCharacterRecord extends Character {
  bibleUrl: string;
  voiceReferenceUrl?: string;
  sourceSeriesId: string;
  sourceCharacterId: string;
  savedAt: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseStoredArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function characterFromDesignRecord(value: unknown): Character | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<CharacterDesignLibraryRecord>;
  const name = text(record.name);
  const imageUrl = text(record.conceptUrl) || text(record.bibleUrl);
  if (!name || !imageUrl) return undefined;

  const details = [
    text(record.role) && `身份：${text(record.role)}`,
    text(record.age) && `年龄：${text(record.age)}`,
    text(record.personality) && `性格：${text(record.personality)}`,
    text(record.coreTheme) && `核心设定：${text(record.coreTheme)}`,
    text(record.description) && `外观：${text(record.description)}`,
    text(record.costumeDesc) && `服装材质：${text(record.costumeDesc)}`,
  ].filter(Boolean);

  return {
    id: text(record.id) || `character-design-${name}`,
    name,
    description: details.join('；') || '角色设计工作台生成的角色',
    imageUrl,
  };
}

function isCharacter(value: unknown): value is Character {
  if (!value || typeof value !== 'object') return false;
  const character = value as Partial<Character>;
  return Boolean(text(character.id) && text(character.name) && text(character.imageUrl));
}

export function mergeCharacterHistory(history: unknown[], designs: unknown[]): Character[] {
  const designedCharacters = designs.map(characterFromDesignRecord).filter((item): item is Character => Boolean(item));
  const savedCharacters = history.filter(isCharacter);
  const names = new Set<string>();

  return [...designedCharacters, ...savedCharacters].filter(character => {
    const key = character.name.trim().toLocaleLowerCase();
    if (!key || names.has(key)) return false;
    names.add(key);
    return true;
  }).slice(0, MAX_CHARACTER_HISTORY);
}

export function upsertCharacterHistory(history: unknown[], character: Character): Character[] {
  const name = character.name.trim().toLocaleLowerCase();
  return [character, ...history.filter(isCharacter).filter(item => item.name.trim().toLocaleLowerCase() !== name)]
    .slice(0, MAX_CHARACTER_HISTORY);
}

export function characterFromGeneratedSeries(
  sourceSeriesId: string,
  character: {
    id: string;
    name: string;
    aliases?: string[];
    casting?: { name?: string };
    description: string;
    bibleUrl?: string;
    imageUrl?: string;
    voiceId?: string;
    voiceProfile?: string;
    voiceSource?: Character['voiceSource'];
    voiceLocked?: boolean;
    voiceReferenceUrl?: string;
    gender?: Character['gender'];
    ageGroup?: Character['ageGroup'];
  },
): GeneratedSeriesCharacterRecord {
  const imageUrl = text(character.bibleUrl) || text(character.imageUrl);
  if (!text(sourceSeriesId) || !text(character.id) || !text(character.name) || !imageUrl)
    throw new Error('角色卡尚未完成，暂时不能加入角色库');
  return {
    id: `series-character-${text(sourceSeriesId)}-${text(character.id)}`,
    name: text(character.name),
    aliases: [...new Set([...(character.aliases || []), character.casting?.name].map(text).filter(alias => alias && alias !== text(character.name)))],
    description: text(character.description),
    imageUrl,
    bibleUrl: imageUrl,
    voiceId: text(character.voiceId) || undefined,
    voiceProfile: text(character.voiceProfile) || undefined,
    voiceSource: character.voiceSource,
    voiceLocked: character.voiceLocked,
    voiceReferenceUrl: text(character.voiceReferenceUrl) || undefined,
    gender: character.gender,
    ageGroup: character.ageGroup,
    sourceSeriesId: text(sourceSeriesId),
    sourceCharacterId: text(character.id),
    savedAt: new Date().toISOString(),
  };
}
