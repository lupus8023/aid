import type { SeriesJobKind, SeriesProject } from "./types";
import { seriesObjectReferenceMode } from "./domain";

// Shared by the page, queue and executor so production stages agree on prerequisites.
export function seriesStageBlocker(project: SeriesProject | undefined, kind: SeriesJobKind): string {
  if (!project) return "请先选择连续剧";
  if (kind === "develop") return "";
  if (!project.bible) return "请先生成故事总纲";
  if (kind === "prepare") {
    if (!project.characters.length || !project.locations.length)
      return "请先生成总纲中的角色与场景清单";
    const missingUploads = (project.objects || []).filter(
      object => seriesObjectReferenceMode(object) === "upload" && !object.imageUrl,
    );
    if (missingUploads.length)
      return `请先为用户指定道具上传参考图：${missingUploads.map(object => object.name).join('、')}`;
    return "";
  }
  if (project.episodes.length !== project.episodeCount || project.episodes.some(e => e.needsReview))
    return "请先完成／更新整季分集故事";
  return "";
}

export function seriesAssetsReady(project: SeriesProject): boolean {
  return !seriesStageBlocker(project, "prepare") &&
    project.characters.every(c => c.locked &&
      (c.appearance === "voice_only" || Boolean(c.bibleUrl)) &&
      (!c.speaking || Boolean(c.voiceId && c.voiceReferenceUrl))) &&
    project.locations.every(l => Boolean(l.imageUrl)) &&
    (project.objects || []).every(object => Boolean(object.imageUrl));
}
