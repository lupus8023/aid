// Use a frame that still contains motion as the next clip's visual handoff.
// The editor trims the same interval from the preceding clip, so the cut never
// jumps backwards to a frame that has already played.
export const CONTINUITY_HANDOFF_LEAD_SECONDS = 0.24;

// H3 commonly holds its supplied first frame while motion ramps up. Removing
// this short head interval keeps the join moving without hiding meaningful action.
export const CONTINUITY_HEAD_TRIM_SECONDS = 0.18;
