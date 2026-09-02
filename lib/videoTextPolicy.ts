/**
 * H3 has one positive conditioning stream. Repeating a long list of words such
 * as "subtitle", "caption" and "title card" can make those concepts more
 * salient. Keep the visual-text rule short, positive and present only once at
 * the provider boundary.
 */
export const NO_SUBTITLE_POLICY_MARKER = 'CLEAN-FRAME PRESENTATION';

export const NO_SUBTITLE_POLICY = `${NO_SUBTITLE_POLICY_MARKER}: Keep every generated frame free of generated text. Spoken words exist only in the synchronized audio track. Do not render subtitles, captions, titles, speech bubbles, watermarks, UI, or newly invented readable characters. Existing printed markings on an explicitly supplied fixed-object reference may remain only when copied exactly.`;

/** Add the clean-frame rule once, without wrapping or multiplying it. */
export function enforceNoSubtitles(prompt: string): string {
  const body = String(prompt || '').trim();
  if (!body) return NO_SUBTITLE_POLICY;
  if (body.includes(NO_SUBTITLE_POLICY_MARKER)) return body;
  return `${body}\n\n${NO_SUBTITLE_POLICY}`;
}

/**
 * Compatibility export for saved web projects. New Companion builds construct
 * the complete H3 prompt centrally, so a storyboard beat no longer receives a
 * repeated visual-text block.
 */
export function withNoSubtitleBeat(description?: string): string {
  return String(description || '').trim();
}
