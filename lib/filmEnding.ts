import type { Storyboard } from '@/types';

export const FILM_ENDING_SECONDS = 1;

/** Decide against the whole screenplay, never the last shot of a selected group. */
export function isFilmEndingSegment(allShots: Storyboard[], segment: Storyboard[]): boolean {
  const last = [...allShots].sort((a, b) => a.sceneNumber - b.sceneNumber).at(-1);
  const segmentLast = [...segment].sort((a, b) => a.sceneNumber - b.sceneNumber).at(-1);
  return Boolean(last && segmentLast && last.id === segmentLast.id);
}
