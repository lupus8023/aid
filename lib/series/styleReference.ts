import { normalizeImageStyleReference } from '../imageStyleReference';
import type { SeriesProject } from './types';

export function setSeriesStyleReference(project: SeriesProject, input: unknown): boolean {
  const style = normalizeImageStyleReference(input);
  if ((project.styleReference?.imageUrl || '') === (style?.imageUrl || '') && (project.styleReference?.description || '') === (style?.description || '')) return false;
  project.visualHistory ||= [];
  project.visualHistory.push({
    changedAt: new Date().toISOString(), reason: 'style_change', styleReference: project.styleReference,
    characters: structuredClone(project.characters), locations: structuredClone(project.locations), objects: structuredClone(project.objects),
    productions: project.episodes.filter(e => e.production).map(e => ({ episodeId:e.id, version:e.version, production:structuredClone(e.production!) })),
  });
  project.styleReference = style ? { ...style, version: project.visualHistory.length } : undefined;
  for (const c of project.characters) {
    for (const key of ['bibleUrl','imageTaskId','imageSubmissionKey','imageIssue','imageFailures','photographicAnchor','photographicCardReview','photographicSheetUrl'] as const) delete c[key];
    c.locked = c.appearance === 'voice_only' && (!c.speaking || !!(c.voiceId && c.voiceReferenceUrl));
    c.version++;
  }
  for (const l of project.locations) for (const key of ['imageUrl','imageTaskId','imageSubmissionKey','imageIssue','imageFailures'] as const) delete l[key];
  for (const e of project.episodes) { delete e.production; e.version++; }
  return true;
}
