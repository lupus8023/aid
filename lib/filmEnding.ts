import type { Storyboard } from '@/types';

export const FILM_ENDING_SECONDS = 1;

/** Native speech often runs longer than the text estimate; reserve room only at the film end. */
export function filmEndingDuration(base: number, isEnding: boolean, requested = base, repairMinimum = 0): number {
  return Math.min(15, Math.max(base + (isEnding ? 2 : 0), requested, isEnding ? repairMinimum : 0));
}

/** Decide against the whole screenplay, never the last shot of a selected group. */
export function isFilmEndingSegment(allShots: Storyboard[], segment: Storyboard[]): boolean {
  const last = [...allShots].sort((a, b) => a.sceneNumber - b.sceneNumber).at(-1);
  const segmentLast = [...segment].sort((a, b) => a.sceneNumber - b.sceneNumber).at(-1);
  return Boolean(last && segmentLast && last.id === segmentLast.id);
}
