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
  youngFemaleEn: [
    '6d5d07dcc342440ba701aa36f7daf42f',
    '617167a94e49486f80d4c4047584d9ed',
    '8ef4a238714b45718ce04243307c57a7',
  ],
  authoritativeFemaleEn: ['145d5c8c614f4852a029346ebb5d42db'],
  matureFemaleEn: ['15deb7503c784eedba3b72d27978f43b'],
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
  const isMale = /(?:男人|男性|男孩|少年|父亲|爸爸|哥哥|弟弟|丈夫|王子|国王|老者|爷爷|海龟|乌龟|兽|man|boy|male|father|brother|husband|prince|king|old man|turtle|beast)/iu.test(text);
  const isMature = /(?:中年|年长|老年|母亲|妈妈|女王|皇后|mature|middle-aged|elder|mother|queen)/iu.test(text);
  const isAuthoritativeWoman = isFemale && /(?:女官|军官|指挥官|队长|舰长|警官|officer|commander|captain|chief|inspector)/iu.test(text);

  if (isFemale || !isMale) {
    if (language === 'en') return isAuthoritativeWoman
      ? { label: 'calm authoritative feminine, measured natural English', pool: VOICES.authoritativeFemaleEn }
      : isMature
        ? { label: 'mature feminine, calm, natural English', pool: VOICES.matureFemaleEn }
        : { label: 'young feminine, warm, natural English', pool: VOICES.youngFemaleEn };
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
  const usedVoiceIds = new Set(
    characters
      .filter(character => String(character.voiceId || '').trim() && character.voiceSource !== 'auto')
      .map(character => String(character.voiceId).trim()),
  );

  return characters.map(character => {
    const existing = String(character.voiceId || '').trim();
    if (existing && character.voiceSource !== 'auto') {
      usedVoiceIds.add(existing);
      return castCharacterVoice(character, language);
    }

    const profile = inferredProfile(character, language);
    const start = hash(character.name) % profile.pool.length;
    let voiceId = profile.pool[start];
    for (let offset = 0; offset < profile.pool.length; offset += 1) {
      const candidate = profile.pool[(start + offset) % profile.pool.length];
      if (!usedVoiceIds.has(candidate)) {
        voiceId = candidate;
        break;
      }
    }
    usedVoiceIds.add(voiceId);
    return {
      ...character,
      voiceId,
      voiceProfile: profile.label,
      voiceSource: 'auto' as const,
    };
  });
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
