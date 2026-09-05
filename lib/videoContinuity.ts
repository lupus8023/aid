import type { Storyboard } from '@/types';

// Use a frame that still contains motion as the next clip's visual handoff.
// The editor trims the same interval from the preceding clip, so the cut never
// jumps backwards to a frame that has already played.
export const CONTINUITY_HANDOFF_LEAD_SECONDS = 0.24;

// H3 commonly holds its supplied first frame while motion ramps up. Removing
// this short head interval keeps the join moving without hiding meaningful action.
export const CONTINUITY_HEAD_TRIM_SECONDS = 0.24;

/** Narrative continuity is not permission to replace a selected first frame. */
export function previousSegmentTailSource(storyboards: Storyboard[], leader: Storyboard): Storyboard | undefined {
  if (leader.videoStartMode !== 'previous-segment-tail') return undefined;
  const index = storyboards.findIndex(item => item.id === leader.id);
  const previous = storyboards[index - 1];
  if (!previous || !leader.sequenceId?.trim() || !leader.locationId?.trim()
    || previous.sequenceId !== leader.sequenceId || previous.locationId !== leader.locationId
    || (previous.transition && previous.transition !== 'cut')) return undefined;
  // The owner must include the immediately preceding shot. Never skip a
  // missing/failed segment and quietly borrow an older video's tail.
  const owner = previous.videoSegmentId
    ? storyboards.find(item => item.videoSegmentId === previous.videoSegmentId
      && item.videoSegmentStoryboardIds?.at(-1) === previous.id)
    : previous;
  return owner?.videoStatus === 'completed' && owner.videoUrl ? owner : undefined;
}

/** Old builds promoted shared location IDs to automatic first/last-frame mode. */
export function hasLegacyAutomaticContinuity(storyboard: Storyboard): boolean {
  return storyboard.continuousFromPrev === true
    && !storyboard.videoStartMode
    && !storyboard.videoGenerationSignature?.startsWith('h3-v34-');
}
