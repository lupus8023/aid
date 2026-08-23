export type VoiceSource = 'user' | 'auto';

export interface VoiceCastInput {
  name: string;
  description?: string;
  voiceId?: string;
  voiceProfile?: string;
  voiceSource?: VoiceSource;
}

export interface VoiceCastResult extends VoiceCastInput {
  voiceId: string;
  voiceProfile: string;
  voiceSource: VoiceSource;
}

// Public Fish Audio reference voices. A user-entered reference_id always wins.
// Automatic casting exists to make unattended Story generation deterministic:
// Fish must never be called without a reference_id and silently choose a voice.
const VOICES = {
  youngFemaleZh: ['fdd3a82f118a4024a1c4059b4e4c2887', '48bc3ceafb0a4125a4c553d9b52b2fd9'],
  matureFemaleZh: ['da05afbbc5fa4c8b97d183f90e020427'],
  youngFemaleEn: ['27254d2e219945c9896da5cc5e1e77f1', '617167a94e49486f80d4c4047584d9ed'],
  male: ['802e3bc2b27e49c2995d23ef70e6ac89'],
} as const;

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) || 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function inferredProfile(character: VoiceCastInput, language: 'zh' | 'en'): {
  label: string;
  pool: readonly string[];
} {
  const text = `${character.name} ${character.description || ''} ${character.voiceProfile || ''}`.toLocaleLowerCase();
  const isFemale = /(?:美人鱼|公主|女娲|少女|女孩|姑娘|女人|女性|母亲|妈妈|姐姐|妹妹|妻子|皇后|女王|woman|girl|female|princess|queen|mother|sister|wife|mermaid)/iu.test(text);
  const isMale = /(?:男人|男性|男孩|少年|父亲|爸爸|哥哥|弟弟|丈夫|王子|国王|老者|爷爷|man|boy|male|father|brother|husband|prince|king|old man)/iu.test(text);
  const isMature = /(?:中年|年长|老年|母亲|妈妈|女王|皇后|mature|middle-aged|elder|mother|queen)/iu.test(text);

  if (isFemale || !isMale) {
    if (language === 'en') return { label: isMature ? 'mature feminine, calm, natural English' : 'young feminine, warm, natural English', pool: VOICES.youngFemaleEn };
    if (isMature) return { label: '成熟女性，自然沉稳，克制清晰', pool: VOICES.matureFemaleZh };
    return { label: '年轻女性，自然温暖，清晰克制', pool: VOICES.youngFemaleZh };
  }
  return { label: language === 'en' ? 'masculine, natural, restrained English' : '男性，自然克制，清晰稳定', pool: VOICES.male };
}

export function castCharacterVoice<T extends VoiceCastInput>(
  character: T,
  language: 'zh' | 'en' = 'zh',
): T & VoiceCastResult {
  const existing = String(character.voiceId || '').trim();
  if (existing) {
    return {
      ...character,
      voiceId: existing,
      voiceProfile: String(character.voiceProfile || '用户指定音色').trim(),
      voiceSource: character.voiceSource === 'auto' ? 'auto' : 'user',
    };
  }
  const profile = inferredProfile(character, language);
  return {
    ...character,
    voiceId: profile.pool[hash(character.name) % profile.pool.length],
    voiceProfile: profile.label,
    voiceSource: 'auto',
  };
}

export function castStoryVoices<T extends VoiceCastInput>(
  characters: T[],
  language: 'zh' | 'en' = 'zh',
): Array<T & VoiceCastResult> {
  return characters.map(character => castCharacterVoice(character, language));
}

export function lockStoryboardVoiceIds<T extends {
  speech?: Array<{ character: string; voiceId?: string }>;
}>(storyboards: T[], characters: VoiceCastInput[]): T[] {
  const voiceByName = new Map(characters.map(character => [character.name.trim().toLocaleLowerCase(), character.voiceId]));
  return storyboards.map(storyboard => ({
    ...storyboard,
    speech: storyboard.speech?.map(line => ({
      ...line,
      voiceId: line.voiceId || voiceByName.get(line.character.trim().toLocaleLowerCase()),
    })),
  }));
}
