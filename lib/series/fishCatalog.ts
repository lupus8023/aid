import type { FishVoiceModel } from '@/lib/fishVoiceDiscovery';

export type FishCatalogScope = 'public' | 'licensed' | 'workspace';
export interface FishCatalogVoice {
  id: string; title: string; description: string; languages: string[];
  source: FishCatalogScope; licensed: boolean; sampleUrl?: string; pageUrl: string;
}

function sampleUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password &&
        (url.hostname === 'fish.audio' || url.hostname.endsWith('.fish.audio'))) return url.href;
  } catch {}
}

/** Browsing public models is not a declaration of rights to use them. */
export async function listFishCatalog(key: string, input: {
  scope?: FishCatalogScope; query?: string; language?: string; page?: number;
}) {
  const scope = input.scope || 'public';
  if (!['public', 'licensed', 'workspace'].includes(scope)) throw new Error('无效的 Fish 音色库范围');
  const page = input.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 50) throw new Error('无效的音色页码');
  const query = String(input.query || '').trim().slice(0, 100);
  const language = input.language === 'en' || input.language === 'zh' ? input.language : '';
  const params = new URLSearchParams({ page_size: '20', page_number: String(page), sort_by: 'score' });
  if (scope === 'workspace') params.set('self', 'true');
  if (scope === 'licensed') params.set('licensed', 'true');
  if (language) params.set('language', language);
  if (query) params.set('title', query);
  const response = await fetch(`https://api.fish.audio/model?${params}`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Fish 音色库读取失败（${response.status}），请检查 API Key 或服务状态`);
  const data = await response.json();
  const items: FishCatalogVoice[] = (Array.isArray(data.items) ? data.items : [])
    .filter((m: FishVoiceModel) => /^[a-zA-Z0-9_-]{1,120}$/.test(m._id || '') && (!m.type || m.type === 'tts') &&
      (!m.state || ['created', 'ready', 'trained'].includes(m.state)) && !m.dmca_taken_down && m.pvc_release_state !== 'retiring' &&
      (scope !== 'licensed' || m.licensed === true))
    .map((m: FishVoiceModel & { samples?: Array<{ audio?: string }> }) => ({
      id: m._id, title: String(m.title || m._id).slice(0, 200), description: String(m.description || '').slice(0, 600),
      languages: Array.isArray(m.languages) ? m.languages.slice(0, 12) : [],
      source: scope === 'workspace' ? 'workspace' : m.licensed === true ? 'licensed' : 'public',
      licensed: m.licensed === true,
      sampleUrl: Array.isArray(m.samples) ? m.samples.map(s => sampleUrl(s?.audio)).find(Boolean) : undefined,
      pageUrl: `https://fish.audio/m/${encodeURIComponent(m._id)}/`,
    }));
  return { items, page, hasMore: data.has_more === true || (data.has_more == null && data.items?.length === 20),
    total: Number.isFinite(data.total) ? data.total : undefined, totalIsExact: data.total_is_exact === true };
}
