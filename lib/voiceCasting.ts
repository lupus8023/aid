import type { VoiceAgeGroup, VoiceGender } from '@/types';

export type VoiceSource = 'user' | 'auto';

export interface VoiceCastInput {
  name: string;
  description?: string;
  voiceId?: string;
  voiceProfile?: string;
  voiceSource?: VoiceSource;
  gender?: VoiceGender;
  ageGroup?: VoiceAgeGroup;
  role?: string;
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
    '145d5c8c614f4852a029346ebb5d42db',
  ],
  authoritativeFemaleEn: ['145d5c8c614f4852a029346ebb5d42db'],
  matureFemaleEn: ['15deb7503c784eedba3b72d27978f43b'],
  male: ['802e3bc2b27e49c2995d23ef70e6ac89'],
} as const;

// Fish marketplace references can be removed without notice. Keep explicit
// migrations for ids AID assigned automatically in older projects; never
// rewrite an arbitrary user-entered reference id.
const RETIRED_AUTO_VOICE_IDS: Record<string, string> = {
  '8ef4a238714b45718ce04243307c57a7': '145d5c8c614f4852a029346ebb5d42db',
};

const CURRENT_AUTO_VOICE_IDS: string[] = [...new Set<string>(Object.values(VOICES).flat())];
const FEMALE_AUTO_VOICE_IDS: string[] = [...new Set<string>([
  ...VOICES.youngFemaleZh,
  ...VOICES.matureFemaleZh,
  ...VOICES.youngFemaleEn,
  ...VOICES.authoritativeFemaleEn,
  ...VOICES.matureFemaleEn,
])];
const MALE_AUTO_VOICE_IDS: string[] = [...VOICES.male];

export function normalizeFishVoiceId(voiceId?: string): string | undefined {
  const normalized = String(voiceId || '').trim();
  if (!normalized) return undefined;
  return RETIRED_AUTO_VOICE_IDS[normalized] || normalized;
}

export function fishAutoVoiceCandidates(voiceId?: string): string[] {
  const original = String(voiceId || '').trim();
  if (!original) return [];
  const normalized = normalizeFishVoiceId(original)!;
  const isAIDAutoVoice = original in RETIRED_AUTO_VOICE_IDS
    || CURRENT_AUTO_VOICE_IDS.includes(original);
  if (!isAIDAutoVoice) return [original];
  // A retired/unavailable automatic voice may only fail over inside the same
  // gender pool. Cross-pool retries used to turn a male supporting role into a
  // female voice when the first marketplace reference disappeared.
  const peers = MALE_AUTO_VOICE_IDS.includes(normalized)
    ? MALE_AUTO_VOICE_IDS
    : FEMALE_AUTO_VOICE_IDS.includes(normalized)
      ? FEMALE_AUTO_VOICE_IDS
      : [normalized];
  return [normalized, ...peers.filter(candidate => candidate !== normalized)];
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) || 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function inferVoiceGender(character: VoiceCastInput): VoiceGender {
  if (character.gender && character.gender !== 'unknown') return character.gender;
  // Never use an old automatic profile as evidence: that profile may itself
  // be the result of the legacy unknown=>female bug we are repairing.
  const trustedProfile = character.voiceSource === 'auto' ? '' : character.voiceProfile || '';
  const text = `${character.name} ${character.role || ''} ${character.description || ''} ${trustedProfile}`.toLocaleLowerCase();
  const female = /(?:美人鱼|仙女|公主|女娲|少女|女孩|姑娘|女人|女性|母亲|妈妈|姐姐|妹妹|妻子|皇后|女王|\bwoman\b|\bgirl\b|\bfemale\b|princess|queen|mother|sister|wife|mermaid|\bshe\b|\bher\b)/iu.test(text);
  const male = /(?:男人|男性|男孩|少年|父亲|爸爸|哥哥|弟弟|丈夫|王子|国王|老者|爷爷|男官|男军官|\bman\b|\bboy\b|\bmale\b|father|brother|husband|\bprince\b|\bking\b|old man|\bhe\b|\bhis\b)/iu.test(text);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  return 'unknown';
}

export function inferVoiceAgeGroup(character: VoiceCastInput): VoiceAgeGroup {
  if (character.ageGroup && character.ageGroup !== 'unknown') return character.ageGroup;
  const trustedProfile = character.voiceSource === 'auto' ? '' : character.voiceProfile || '';
  const text = `${character.name} ${character.role || ''} ${character.description || ''} ${trustedProfile}`.toLocaleLowerCase();
  if (/(?:儿童|孩子|小孩|幼年|child|kid|little boy|little girl)/iu.test(text)) return 'child';
  if (/(?:老年|年迈|老人|老者|爷爷|奶奶|elder|elderly|senior|old man|old woman)/iu.test(text)) return 'senior';
  if (/(?:少女|少年|青年|年轻|teen|young adult|young woman|young man|girl|boy)/iu.test(text)) return 'young_adult';
  if (/(?:中年|成年|母亲|父亲|妈妈|爸爸|mature|middle-aged|adult|mother|father)/iu.test(text)) return 'adult';
  return 'unknown';
}

/**
 * Story can discover a speaking supporting role from the screenplay before a
 * user has designed its card.  For that generated role only, lock a concrete
 * production identity once so the character-card prompt and Fish reference
 * cannot make independent gender/age guesses.  Explicit/inferred facts win;
 * an otherwise ambiguous supporting identity uses the conservative adult
 * masculine fallback that replaces the old (and visibly wrong) female default.
 */
export function resolveGeneratedStoryIdentity<T extends VoiceCastInput>(character: T): T & {
  gender: VoiceGender;
  ageGroup: VoiceAgeGroup;
} {
  const gender = inferVoiceGender(character);
  const ageGroup = inferVoiceAgeGroup(character);
  return {
    ...character,
    gender: gender === 'unknown' ? 'male' : gender,
    ageGroup: ageGroup === 'unknown' ? 'adult' : ageGroup,
  };
}

function inferredProfile(character: VoiceCastInput, language: 'zh' | 'en'): {
  label: string;
  pool: readonly string[];
} {
  const text = `${character.name} ${character.role || ''} ${character.description || ''} ${character.voiceProfile || ''}`.toLocaleLowerCase();
  const gender = inferVoiceGender(character);
  const ageGroup = inferVoiceAgeGroup(character);
  const isFemale = gender === 'female';
  const isMale = gender === 'male';
  const isMature = ageGroup === 'adult' || ageGroup === 'senior';
  const isAuthoritativeWoman = isFemale && /(?:女官|军官|指挥官|队长|舰长|警官|officer|commander|captain|chief|inspector)/iu.test(text);

  if (isFemale) {
    if (language === 'en') return isAuthoritativeWoman
      ? { label: 'calm authoritative feminine, measured natural English', pool: VOICES.authoritativeFemaleEn }
      : isMature
        ? { label: 'mature feminine, calm, natural English', pool: VOICES.matureFemaleEn }
        : { label: 'young feminine, warm, natural English', pool: VOICES.youngFemaleEn };
    if (isMature) return { label: '成熟女性，自然沉稳，克制清晰', pool: VOICES.matureFemaleZh };
    return { label: '年轻女性，自然温暖，清晰克制', pool: VOICES.youngFemaleZh };
  }
  if (isMale) return { label: language === 'en' ? 'masculine, natural, restrained English' : '男性，自然克制，清晰稳定', pool: VOICES.male };
  return {
    label: language === 'en'
      ? 'voice gender not confirmed — review required before dialogue generation'
      : '角色性别未确认——生成对白前需要确认',
    pool: [],
  };
}

export function castCharacterVoice<T extends VoiceCastInput>(
  character: T,
  language: 'zh' | 'en' = 'zh',
): T & VoiceCastResult {
  const existing = normalizeFishVoiceId(character.voiceId);
  if (existing) {
    return {
      ...character,
      gender: inferVoiceGender(character),
      ageGroup: inferVoiceAgeGroup(character),
      voiceId: existing,
      voiceProfile: String(character.voiceProfile || '用户指定音色').trim(),
      voiceSource: character.voiceSource === 'auto' ? 'auto' : 'user',
    };
  }
  const profile = inferredProfile(character, language);
  if (!profile.pool.length) {
    return {
      ...character,
      gender: inferVoiceGender(character),
      ageGroup: inferVoiceAgeGroup(character),
      voiceId: '',
      voiceProfile: profile.label,
      voiceSource: 'auto',
    };
  }
  return {
    ...character,
    gender: inferVoiceGender(character),
    ageGroup: inferVoiceAgeGroup(character),
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
      .map(character => normalizeFishVoiceId(character.voiceId)!),
  );

  return characters.map(character => {
    const existing = normalizeFishVoiceId(character.voiceId);
    if (existing && character.voiceSource !== 'auto') {
      usedVoiceIds.add(existing);
      return castCharacterVoice(character, language);
    }

    const profile = inferredProfile(character, language);
    if (!profile.pool.length) {
      return {
        ...character,
        gender: inferVoiceGender(character),
        ageGroup: inferVoiceAgeGroup(character),
        voiceId: '',
        voiceProfile: profile.label,
        voiceSource: 'auto' as const,
      };
    }
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
      gender: inferVoiceGender(character),
      ageGroup: inferVoiceAgeGroup(character),
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
    speech: storyboard.speech?.map(line => {
      const nameKey = line.character.trim().toLocaleLowerCase();
      return {
        ...line,
        // The project cast is authoritative. An explicit but unresolved cast
        // member also clears a legacy per-line id; otherwise an old wrong-
        // gender voice could survive behind a UI row marked "待确认".
        voiceId: voiceByName.has(nameKey)
          ? normalizeFishVoiceId(voiceByName.get(nameKey))
          : normalizeFishVoiceId(line.voiceId),
      };
    }),
  }));
}
