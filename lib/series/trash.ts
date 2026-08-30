import type { SeriesJob, SeriesProject } from "./types";

// Reversible removal only. Media files and shared library records are never deleted.
export function moveSeriesToTrash(project: SeriesProject, jobs: SeriesJob[], now: string): void {
  if (jobs.some(j => j.seriesId === project.id && j.status === "running"))
    throw new Error("请先暂停制作队列，等待当前任务保存断点后再删除");
  project.deletedAt = now;
  project.paused = true;
  for (const job of jobs.filter(j => j.seriesId === project.id)) {
    if (job.status === "queued" || job.status === "paused") {
      job.status = "paused";
      job.stage = "连续剧已移入回收站";
      job.updatedAt = now;
      job.cancelRequested = true;
      job.lease = undefined;
      job.workerId = undefined;
    }
  }
}

export function restoreSeriesFromTrash(project: SeriesProject): void {
  delete project.deletedAt;
  // Restoring content must never restart paid generation by itself.
  project.paused = true;
}
