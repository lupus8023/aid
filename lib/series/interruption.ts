import type { SeriesJob, SeriesProject } from './types';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function seriesCheckpointAdvanced(before: SeriesProject, after: SeriesProject): boolean {
  const content = (p: SeriesProject) => { const {revision:_revision,updatedAt:_updatedAt,paused:_paused,...rest}=p; return canonical(rest); };
  return content(before) !== content(after);
}

/** Total launches include successful work and requested pauses. Only repeated
 * interruptions without checkpoint progress consume the connection retry limit. */
export function recordSeriesInterruption(job: SeriesJob, paused: boolean): void {
  if (paused) job.status = 'paused';
  else {
    job.consecutiveInterruptions = (job.consecutiveInterruptions || 0) + 1;
    job.status = job.consecutiveInterruptions >= 3 ? 'failed' : 'queued';
  }
  job.lease = undefined;
  job.stage = '执行器中断，已保留断点';
  job.error = job.status === 'failed' ? '执行器连续三次中断且没有新增进度，请检查环境后重试' : undefined;
}
