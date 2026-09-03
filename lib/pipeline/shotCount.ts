export const SHOT_COUNT_OPTIONS = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80] as const;
export const DEFAULT_TARGET_SHOT_COUNT = 16;
export const MAX_TARGET_SHOT_COUNT = 80;
export const ESTIMATED_SECONDS_PER_SHOT = 5;

export function normalizeTargetShotCount(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TARGET_SHOT_COUNT;
  const closest = SHOT_COUNT_OPTIONS.reduce((best, option) => (
    Math.abs(option - numeric) < Math.abs(best - numeric) ? option : best
  ), DEFAULT_TARGET_SHOT_COUNT as number);
  return closest;
}

export function targetDurationSeconds(shotCount: unknown): number {
  return normalizeTargetShotCount(shotCount) * ESTIMATED_SECONDS_PER_SHOT;
}

export function storyPlanBeatCount(plan: { sequences?: Array<{ beats?: unknown[] }> } | undefined): number {
  return (plan?.sequences || []).reduce((total, sequence) => (
    total + (Array.isArray(sequence.beats) ? sequence.beats.length : 0)
  ), 0);
}

export function buildShotCountContract(shotCount: unknown, language: 'zh' | 'en' = 'zh'): string {
  const target = normalizeTargetShotCount(shotCount);
  const seconds = targetDurationSeconds(target);
  if (language === 'en') {
    return `[AID PRODUCTION SPEC — overrides any conflicting shot-count request in the brief]\n- Produce exactly ${target} shots.\n- Allocate shot quotas across sequences before writing beats; all sequence quotas must sum to ${target}.\n- Target total runtime is approximately ${seconds} seconds, while each shot duration must still follow its dialogue and action.\n- Do not merge several action units into one shot merely to meet the count.`;
  }
  return `[AID 制作规格——若正文中的镜头数与此冲突，以本规格为准]\n- 严格生成 ${target} 个镜头。\n- 写 beats 前先给各场分配镜头额度，各场额度相加必须等于 ${target}。\n- 目标总片长约 ${seconds} 秒；每镜时长仍须根据台词、动作和情绪停顿推导。\n- 不得为了凑数量把多个动作单元塞进同一镜头。`;
}
