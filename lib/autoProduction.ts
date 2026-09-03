import { isImageSafetyRejection } from './imagePromptSafety';
import type { Storyboard } from '@/types';
import { storyboardImageMode } from './imageModels';

export const AUTO_RETRY_DELAYS_MS = [3_000, 8_000, 15_000, 30_000, 60_000] as const;

export class AwaitingMediaTaskError extends Error {
  constructor(readonly taskId: string) {
    super('已提交任务仍在处理中，继续查询原任务，不重复提交');
    this.name = 'AwaitingMediaTaskError';
  }
}

export function imagePollingTimeoutError(taskId: string, lastActiveAt?: number, now = Date.now()): Error {
  // Only a recent successful provider status permits a wait without spending
  // a failure attempt. An outage or invalid credential must not wait forever.
  return lastActiveAt !== undefined && now >= lastActiveAt && now - lastActiveAt <= 60_000
    ? new AwaitingMediaTaskError(taskId)
    : new Error('Image generation timeout');
}

export function isTransientAutoProductionError(error: unknown): boolean {
  if (isImageSafetyRejection(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  // These are explicit congestion responses or a connection that failed before
  // TLS was established. Do not broadly retry uncertain paid POST timeouts.
  return /\b(?:429|503)\b|rate[ -]?limit|too many requests|receiving a lot of requests|temporarily unavailable|try again shortly|socket disconnected before secure TLS connection was established/i.test(message);
}

export function autoProductionLockName(projectId: string): string {
  return `aid:auto-production:${String(projectId || 'unknown').trim() || 'unknown'}`;
}

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
 * Submit independent video groups in small parallel waves. A group that starts
 * from the previous segment's tail must remain alone so its reference frame is
 * available before submission.
 */
export function planAutoVideoBatches(groups: Storyboard[][], maxConcurrency = 2): Storyboard[][][] {
  const limit = Math.max(1, Math.floor(maxConcurrency) || 1);
  const batches: Storyboard[][][] = [];
  for (let index = 0; index < groups.length;) {
    const current = groups[index];
    if (current[0]?.videoStartMode === 'previous-segment-tail') {
      batches.push([current]);
      index += 1;
      continue;
    }
    const batch = [current];
    while (batch.length < limit && index + batch.length < groups.length) {
      const candidate = groups[index + batch.length];
      if (candidate[0]?.videoStartMode === 'previous-segment-tail') break;
      batch.push(candidate);
    }
    batches.push(batch);
    index += batch.length;
  }
  return batches;
}

/**
 * Resume the paid nine-panel task whenever the unfinished cards still point
 * to one durable task id. Otherwise a fully missing batch gets one fresh grid,
 * while a partially completed batch repairs only its missing cards so already
 * delivered storyboards are never purchased or replaced again.
 */
export function planAutoImageBatch(group: Storyboard[], model = ''): AutoImageBatchPlan {
  const missing = group.filter(storyboard => !hasUsableStoryboardImage(storyboard));
  if (!missing.length) return { kind: 'skip' };
  if (storyboardImageMode(model) === 'single') return { kind: 'generate-missing', storyboardIds: missing.map(s => s.id) };

  const recoverableTaskIds = [...new Set(missing
    .filter(storyboard => storyboard.imageTaskMode !== 'single')
    .map(storyboard => storyboard.taskId)
    .filter((taskId): taskId is string => Boolean(taskId)))];
  if (recoverableTaskIds.length === 1) return { kind: 'resume-grid', taskId: recoverableTaskIds[0] };
  if (missing.length === group.length) return { kind: 'generate-grid' };
  return { kind: 'generate-missing', storyboardIds: missing.map(storyboard => storyboard.id) };
}
