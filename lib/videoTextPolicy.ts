/** Keep dialogue markup an audio instruction instead of letting a multimodal
 * model reinterpret the literal words as typography in the photographed
 * frame. This is a generation-time contract, not an OCR/QC pass. */
export const NO_SUBTITLE_POLICY_MARKER = 'CLEAN-FRAME PRESENTATION';

export const NO_SUBTITLE_POLICY = `${NO_SUBTITLE_POLICY_MARKER}: Keep every frame photographic and free of added typography; no subtitles, captions, dialogue lettering, phonetic lines, logos, or watermarks. Preserve only lettering already present in reference pictures.`;

export const H3_DIALOGUE_NO_SUBTITLE_POLICY = 'Deliver clean camera-original footage before graphics. Dialogue exists only in the audio track; every frame contains uninterrupted scene imagery with no added typography.';

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
