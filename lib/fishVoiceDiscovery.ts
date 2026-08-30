import type { VoiceAgeGroup, VoiceGender } from '@/types';
import {
  castCharacterVoice,
  resolveGeneratedStoryIdentity,
  type VoiceCastInput,
} from '@/lib/voiceCasting';

export interface FishVoiceModel {
  _id: string;
  type?: string;
  title?: string;
  description?: string;
  state?: string;
  visibility?: string;
  tags?: string[];
  languages?: string[];
  task_count?: number;
  like_count?: number;
  mark_count?: number;
  licensed?: boolean;
  dmca_taken_down?: boolean;
  pvc_release_state?: string;
}

export interface FishVoiceSelectionInput extends VoiceCastInput {
  language: 'zh' | 'en';
}

export interface FishVoiceSelection {
  voiceId: string;
  voiceProfile: string;
  source: 'fish_search' | 'curated_fallback';
  modelTitle?: string;
}

function normalizedText(model: FishVoiceModel): string {
  return [model.title, model.description, ...(model.tags || []), ...(model.languages || [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function genderEvidence(text: string): VoiceGender {
  const female = /(?:女性|女声|少女|女孩|姐姐|妹妹|母亲|妈妈|奶奶|\bfemale\b|\bwoman\b|\bgirl\b|feminine|mother|sister|queen|princess)/iu.test(text);
  const male = /(?:男性|男声|少年|男孩|哥哥|弟弟|父亲|爸爸|爷爷|\bmale\b|\bman\b|\bboy\b|masculine|father|brother|\bking\b|\bprince\b)/iu.test(text);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  return 'unknown';
}

function ageEvidence(text: string): VoiceAgeGroup {
  if (/(?:儿童|孩子|小孩|幼年|child|kid)/iu.test(text)) return 'child';
  if (/(?:老年|老人|年迈|爷爷|奶奶|elder|elderly|senior)/iu.test(text)) return 'senior';
  if (/(?:少女|少年|青年|年轻|teen|young)/iu.test(text)) return 'young_adult';
  if (/(?:成年|中年|成熟|adult|mature|middle.?aged)/iu.test(text)) return 'adult';
  return 'unknown';
}

function languageMatches(model: FishVoiceModel, language: 'zh' | 'en'): boolean {
  const values = (model.languages || []).map(value => String(value).toLocaleLowerCase());
  const text = normalizedText(model);
  if (language === 'zh') return values.some(value => /^(zh|cmn|chinese)/.test(value)) || /中文|普通话|国语|mandarin|chinese/.test(text);
  return values.some(value => /^(en|english)/.test(value)) || /英语|英文|english/.test(text);
}

export function rankFishVoiceModels(
  models: FishVoiceModel[],
  input: FishVoiceSelectionInput,
): FishVoiceModel[] {
  const resolved = resolveGeneratedStoryIdentity(input);
  const desiredGender = resolved.gender;
  const desiredAge = resolved.ageGroup;
  return models
    .filter(model => Boolean(model._id) && (!model.type || model.type === 'tts'))
    .filter(model => !model.visibility || model.visibility === 'public' || model.visibility === 'unlist')
    .filter(model => !model.state || ['created', 'ready', 'trained'].includes(model.state))
    .filter(model => !model.dmca_taken_down && model.pvc_release_state !== 'retiring')
    .map(model => {
      const text = normalizedText(model);
      const foundGender = genderEvidence(text);
      const foundAge = ageEvidence(text);
      let score = languageMatches(model, input.language) ? 80 : 0;
      if (foundGender === desiredGender) score += 55;
      else if (foundGender !== 'unknown' && desiredGender !== 'unknown') score -= 120;
      if (foundAge === desiredAge) score += 18;
      else if (foundAge !== 'unknown' && desiredAge !== 'unknown') score -= 8;
      score += Math.log10(1 + Math.max(0, Number(model.task_count) || 0)) * 5;
      score += Math.log10(1 + Math.max(0, Number(model.like_count) || 0)) * 2;
      score += Math.log10(1 + Math.max(0, Number(model.mark_count) || 0));
      return { model, score };
    })
    .sort((left, right) => right.score - left.score || left.model._id.localeCompare(right.model._id))
    .map(item => item.model);
}

export async function discoverFishVoice(
  input: FishVoiceSelectionInput,
  fishAudioKey: string,
): Promise<FishVoiceSelection> {
  const params = new URLSearchParams({
    page_size: '50',
    page_number: '1',
    language: input.language,
    sort_by: 'task_count',
  });
  let models: FishVoiceModel[] = [];
  try {
    const response = await fetch(`https://api.fish.audio/model?${params.toString()}`, {
      headers: { Authorization: `Bearer ${fishAudioKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const data = await response.json() as { items?: FishVoiceModel[] };
      models = Array.isArray(data.items) ? data.items : [];
    }
  } catch (error) {
    console.warn('Fish voice discovery failed; using curated fallback:', error);
  }

  const ranked = rankFishVoiceModels(models, input);
  const selected = ranked[0];
  if (selected) {
    return {
      voiceId: selected._id,
      voiceProfile: [selected.title, ...(selected.tags || []).slice(0, 4)].filter(Boolean).join(' · ') || 'Fish 自动选声',
      source: 'fish_search',
      modelTitle: selected.title,
    };
  }

  const fallback = castCharacterVoice(resolveGeneratedStoryIdentity(input), input.language);
  if (!fallback.voiceId) throw new Error(`无法为角色“${input.name}”自动选择 Fish Audio 音色`);
  return {
    voiceId: fallback.voiceId,
    voiceProfile: fallback.voiceProfile,
    source: 'curated_fallback',
  };
}
