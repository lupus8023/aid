type Asset = { id: string; name: string; aliases?: string[] };
const key = (value: string) => value.trim().toLocaleLowerCase();
/** Resolve exact registered names/aliases only. Never invent a cast member or
 * guess the identity behind an unknown ID. Missing arrays can be reconstructed
 * from the episode's own prose, not next-episode promises. */
export function episodeAssetReferences(episode: Record<string, unknown>, field: 'characterIds' | 'locationIds', assets: Asset[]): string[] {
  const raw = Array.isArray(episode[field]) ? episode[field] as unknown[] : [];
  const resolve = (value: string) => {
    if (assets.some(asset => asset.id === value)) return value;
    const matches = assets.filter(asset => [asset.name, ...(asset.aliases || [])].some(name => key(name) === key(value)));
    return matches.length === 1 ? matches[0].id : value;
  };
  const values = raw.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(value => resolve(value.trim()));
  if (values.length) return [...new Set(values)];
  const prose = ['title', 'synopsis', 'opening', 'goal', 'conflict', 'choice', 'resolution', 'hook']
    .map(field => typeof episode[field] === 'string' ? episode[field] : '').join('\n').toLocaleLowerCase();
  const matches = assets.flatMap(asset => [asset.name, ...(asset.aliases || [])].filter(Boolean).flatMap(name => {
    const term = key(name);
    if (assets.some(other => other.id !== asset.id && [other.name, ...(other.aliases || [])].some(alias => key(alias) === term))) return [];
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = /^[a-z0-9 _-]+$/.test(term) ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i') : new RegExp(escaped);
    return pattern.test(prose) ? [asset.id] : [];
  }));
  return [...new Set(matches)];
}
