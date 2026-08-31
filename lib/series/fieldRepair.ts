export interface EpisodeFieldIssue {
  index: number;
  key: string;
  path: string;
  label: string;
}

export class EpisodeFieldError extends Error {
  constructor(public issues: EpisodeFieldIssue[]) {
    super(issues.map(issue => `缺少${issue.label}（${issue.path} 必须是非空字符串）`).join('；'));
    this.name = 'EpisodeFieldError';
  }
}

const episodeTextFields = {
  title: '单集标题', synopsis: '单集故事', opening: '开场承接', goal: '本集目标',
  conflict: '本集冲突', choice: '人物选择', resolution: '本集回报',
  hook: '结尾钩子／终局余韵', hookType: '钩子类型', nextOpening: '下一集承接',
} as const;

export function checkEpisodeTextFields(episodes: unknown[], start: number, episodeCount: number): void {
  const issues: EpisodeFieldIssue[] = [];
  for (let index = 0; index < episodes.length; index++) {
    const episode = episodes[index];
    if (!episode || typeof episode !== 'object' || Array.isArray(episode))
      throw new Error(`episodes[${index}] 必须是分集对象`);
    for (const [key, label] of Object.entries(episodeTextFields)) {
      if (key === 'nextOpening' && start + index === episodeCount) continue;
      const value = (episode as Record<string, unknown>)[key];
      if (typeof value !== 'string' || !value.trim())
        issues.push({ index, key, path: `episodes[${index}].${key}`, label });
    }
  }
  if (issues.length) throw new EpisodeFieldError(issues);
}

// Apply only model-authored values for the explicitly missing fields. A repair
// cannot rewrite valid story details, cast IDs, promise schedules or user edits.
export function applyEpisodeFieldRepairs(raw: any, reply: any, issues: EpisodeFieldIssue[]) {
  let repairs = reply?.repairs;
  // Some providers still return the full document despite the focused request.
  // Accept only the requested field values, never their unrelated rewrites.
  if (!Array.isArray(repairs) && Array.isArray(reply?.episodes))
    repairs = issues.map(issue => ({ path: issue.path, value: reply.episodes[issue.index]?.[issue.key] }));
  if (!Array.isArray(repairs) || repairs.length !== issues.length)
    throw new Error(`修稿必须返回 repairs 数组，逐项补齐 ${issues.map(i => i.path).join('、')}`);
  const allowed = new Map(issues.map(issue => [issue.path, issue]));
  const seen = new Set<string>();
  const result = { ...raw, episodes: raw.episodes.map((episode: any) => ({ ...episode })) };
  for (const repair of repairs) {
    const issue = allowed.get(repair?.path);
    if (!issue || seen.has(issue.path) || typeof repair.value !== 'string' || !repair.value.trim())
      throw new Error('修稿仅可包含指定的缺失字段，每项 value 必须是非空字符串，不得重复或改写其他字段');
    result.episodes[issue.index][issue.key] = repair.value;
    seen.add(issue.path);
  }
  return result;
}
