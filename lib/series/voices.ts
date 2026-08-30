import { rankFishVoiceModels, type FishVoiceModel } from '@/lib/fishVoiceDiscovery';
import { inferVoiceGender } from '@/lib/voiceCasting';
import type { SeriesCharacter } from './types';

export async function findSeriesVoices(character: SeriesCharacter, language: 'zh' | 'en', key: string, excludedIds: string[]) {
  const signal = AbortSignal.timeout(45000);
  const load = async (owned: boolean) => {
    const models: FishVoiceModel[] = [];
    let limited = false;
    for (let page = 1; page <= 5; page++) {
      const params = new URLSearchParams({ page_size: '100', page_number: String(page), sort_by: 'score', ...(owned ? { self: 'true' } : { licensed: 'true', language }) });
      const response = await fetch(`https://api.fish.audio/model?${params}`, { headers: { Authorization: `Bearer ${key}` }, signal });
      if (!response.ok) throw new Error(`Fish ${owned ? '自有工作区' : '授权库'}搜索失败（${response.status}）；未提交试读，请检查账户与服务状态`);
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items as FishVoiceModel[] : [];
      models.push(...items);
      limited = data.has_more === true || (data.has_more === undefined && items.length === 100);
      if (!limited) break;
    }
    return { models, limited };
  };
  const [workspace, licensed] = await Promise.all([load(true), load(false)]);
  const ownedIds = new Set(workspace.models.map(m => m._id));
  const pool = [...new Map([...licensed.models.filter(m => m.licensed === true), ...workspace.models].map(m => [m._id, m])).values()];
  const matches = pool.filter(m => {
    if (excludedIds.includes(m._id)) return false;
    const description = [m.title, m.description, ...(m.tags || [])].join(' ');
    const languages = (m.languages || []).join(' ').toLowerCase();
    const matchedLanguage = language === 'en' ? /\ben(?:-|\b)|english/i.test(languages) || /英语|英文|english/i.test(description) : /\bzh(?:-|\b)|\bcmn\b|chinese/i.test(languages) || /中文|普通话|国语|mandarin|chinese/i.test(description);
    if (!matchedLanguage) return false;
    const gender = inferVoiceGender({ name: m.title || '', description });
    return !(['male', 'female'].includes(character.gender || '') && gender !== 'unknown' && gender !== character.gender);
  });
  // Private workspace voices may be used by their owner. Do not change the
  // shared public-library ranking policy or label these voices platform licensed.
  const ranked = rankFishVoiceModels(matches.map(m => ownedIds.has(m._id) ? { ...m, visibility: 'unlist' } : m), { ...character, language });
  const keywords = character.voiceBrief?.match(/沙哑|温柔|沉稳|低沉|清亮|活泼|磁性|温暖|成熟|叙述|warm|deep|calm|raspy|bright|narrat\w*/gi) || [];
  const candidates = ranked.map((m, index) => {
    const owned = ownedIds.has(m._id);
    const description = [m.title, m.description, ...(m.tags || [])].join(' ').toLowerCase();
    return {
      voiceId: m._id, title: m.title || m._id, licensed: m.licensed === true,
      source: owned ? 'workspace' as const : 'licensed' as const,
      score: ranked.length - index + keywords.filter(k => description.includes(k.toLowerCase())).length * 15,
      reason: `语言与角色资料匹配；已排除本剧占用音色；${owned ? '来自你的Fish工作区（不等同于平台授权认证，请确保拥有使用权）' : '通过平台授权筛选'}`,
    };
  }).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!candidates.length) throw new Error(`${character.name} 未找到可用的${language === 'en' ? '英语' : '中文'}音色：已检查自有工作区${workspace.models.length}个、平台授权库${licensed.models.length}个模型${workspace.limited || licensed.limited ? '（达到本次搜索上限）' : ''}，并排除语言不明/不符、性别冲突、已占用及下架项。请指定已获授权的音色或在Fish工作区补充相应语言音色；不会随机换声。`);
  return { candidates, evaluation: 'metadata-ranking; synthesis availability is checked separately, not an acting-quality rating' };
}
