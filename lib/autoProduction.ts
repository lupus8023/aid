import type { Storyboard } from '@/types';

export const AUTO_RETRY_DELAYS_MS = [3_000, 8_000, 15_000, 30_000, 60_000] as const;

export function autoRetryDelayMs(failureCount: number): number {
  return AUTO_RETRY_DELAYS_MS[Math.min(Math.max(1, failureCount) - 1, AUTO_RETRY_DELAYS_MS.length - 1)];
}

export function hasUsableStoryboardImage(storyboard: Storyboard): boolean {
  return typeof storyboard.imageUrl === 'string' && storyboard.imageUrl.trim().length > 0;
}

export function normalizeStoryboardImageArtifact(storyboard: Storyboard): Storyboard {
  if (!hasUsableStoryboardImage(storyboard) || storyboard.status === 'completed') return storyboard;
  return {
    ...storyboard,
    status: 'completed',
    imageFailureReason: undefined,
  };
}

export type AutoImageBatchPlan =
  | { kind: 'skip' }
  | { kind: 'resume-grid'; taskId: string }
  | { kind: 'generate-grid' }
  | { kind: 'generate-missing'; storyboardIds: string[] };

/**
 * Resume the paid nine-panel task whenever the unfinished cards still point
 * to one durable task id. Otherwise a fully missing batch gets one fresh grid,
 * while a partially completed batch repairs only its missing cards so already
 * delivered storyboards are never purchased or replaced again.
 */
export function planAutoImageBatch(group: Storyboard[]): AutoImageBatchPlan {
  const missing = group.filter(storyboard => !hasUsableStoryboardImage(storyboard));
  if (!missing.length) return { kind: 'skip' };

  const recoverableTaskIds = [...new Set(missing
    .filter(storyboard => storyboard.imageTaskMode !== 'single')
    .map(storyboard => storyboard.taskId)
    .filter((taskId): taskId is string => Boolean(taskId)))];
  if (recoverableTaskIds.length === 1) return { kind: 'resume-grid', taskId: recoverableTaskIds[0] };
  if (missing.length === group.length) return { kind: 'generate-grid' };
  return { kind: 'generate-missing', storyboardIds: missing.map(storyboard => storyboard.id) };
}
