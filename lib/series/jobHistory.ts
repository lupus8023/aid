import type { SeriesJob } from './types';

export function sameSeriesJobScope(a: SeriesJob, b: SeriesJob): boolean {
  return a.seriesId === b.seriesId && a.kind === b.kind && a.episodeId === b.episodeId;
}

export function partitionSeriesJobs(jobs: SeriesJob[]) {
  const ordered = jobs.map((job, index) => ({ job, index })).sort((a, b) =>
    Date.parse(b.job.updatedAt || b.job.createdAt) - Date.parse(a.job.updatedAt || a.job.createdAt) || b.index - a.index);
  const latest: SeriesJob[] = [], current: SeriesJob[] = [], history: SeriesJob[] = [];
  for (const { job } of ordered) {
    const previous = latest.find(other => sameSeriesJobScope(job, other));
    if (!previous || ['queued', 'running', 'paused'].includes(job.status)) current.push(job);
    else history.push(job);
    if (!previous) latest.push(job);
  }
  return { current, history };
}

export function seriesRetryBlocker(job: SeriesJob, jobs: SeriesJob[]): string {
  const related = jobs.filter(other => sameSeriesJobScope(job, other));
  if (related.some(other => other.id !== job.id && ['queued', 'running', 'paused'].includes(other.status))) return '同一阶段已有排队、执行或暂停的任务，请使用现有任务，避免重复制作';
  if (partitionSeriesJobs(related).history.some(other => other.id === job.id)) return '这是历史任务，已有较新的执行记录；请从当前任务重试';
  return '';
}
