import type { ProjectProductionTiming } from '@/types';

function validTime(value?: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function normalizeProductionTiming(value: unknown): ProjectProductionTiming | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<ProjectProductionTiming>;
  const startedAt = validTime(source.startedAt);
  if (startedAt === undefined) return undefined;
  const status = source.status === 'paused' || source.status === 'completed' ? source.status : 'running';
  const pausedAt = validTime(source.pausedAt);
  const completedAt = validTime(source.completedAt);
  const elapsedMs = Number.isFinite(source.elapsedMs) ? Math.max(0, Number(source.elapsedMs)) : undefined;
  return {
    startedAt: new Date(startedAt).toISOString(),
    status,
    pausedDurationMs: Number.isFinite(source.pausedDurationMs) ? Math.max(0, Number(source.pausedDurationMs)) : 0,
    ...(status === 'paused' && pausedAt !== undefined ? { pausedAt: new Date(pausedAt).toISOString() } : {}),
    ...(status === 'completed' && completedAt !== undefined ? { completedAt: new Date(completedAt).toISOString() } : {}),
    ...(status === 'completed' && elapsedMs !== undefined ? { elapsedMs } : {}),
  };
}

export function startProductionTiming(
  current?: ProjectProductionTiming,
  now = Date.now(),
): ProjectProductionTiming {
  const normalized = normalizeProductionTiming(current);
  if (!normalized || normalized.status === 'completed') {
    return {
      startedAt: new Date(now).toISOString(),
      status: 'running',
      pausedDurationMs: 0,
    };
  }
  if (normalized.status === 'running') return normalized;
  const pausedAt = validTime(normalized.pausedAt) ?? now;
  return {
    startedAt: normalized.startedAt,
    status: 'running',
    pausedDurationMs: normalized.pausedDurationMs + Math.max(0, now - pausedAt),
  };
}

export function pauseProductionTiming(
  current: ProjectProductionTiming | undefined,
  now = Date.now(),
): ProjectProductionTiming | undefined {
  const normalized = normalizeProductionTiming(current);
  if (!normalized || normalized.status !== 'running') return normalized;
  return {
    ...normalized,
    status: 'paused',
    pausedAt: new Date(now).toISOString(),
  };
}

export function productionElapsedMs(
  current: ProjectProductionTiming | undefined,
  now = Date.now(),
): number | undefined {
  const normalized = normalizeProductionTiming(current);
  if (!normalized) return undefined;
  if (normalized.status === 'completed' && normalized.elapsedMs !== undefined) return normalized.elapsedMs;
  const startedAt = validTime(normalized.startedAt);
  if (startedAt === undefined) return undefined;
  const effectiveNow = normalized.status === 'paused'
    ? validTime(normalized.pausedAt) ?? now
    : now;
  return Math.max(0, effectiveNow - startedAt - normalized.pausedDurationMs);
}

export function completeProductionTiming(
  current: ProjectProductionTiming | undefined,
  now = Date.now(),
): ProjectProductionTiming | undefined {
  const normalized = normalizeProductionTiming(current);
  if (!normalized) return undefined;
  if (normalized.status === 'completed') return normalized;
  return {
    startedAt: normalized.startedAt,
    status: 'completed',
    pausedDurationMs: normalized.pausedDurationMs,
    completedAt: new Date(now).toISOString(),
    elapsedMs: productionElapsedMs(normalized, now) || 0,
  };
}

export function formatProductionElapsed(milliseconds?: number): string {
  if (milliseconds === undefined) return '尚未开始';
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}
