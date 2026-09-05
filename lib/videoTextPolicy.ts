/** Keep dialogue markup an audio instruction instead of letting a multimodal
 * model reinterpret the literal words as typography in the photographed
 * frame. This is a generation-time contract, not an OCR/QC pass. */
export const NO_SUBTITLE_POLICY_MARKER = '纯净原片要求';

export const NO_SUBTITLE_POLICY = `${NO_SUBTITLE_POLICY_MARKER}：画面中不添加字幕、标题、对白文字、水印或界面；只保留参考图中实物本来就有的印字。`;

export const H3_DIALOGUE_NO_SUBTITLE_POLICY = '对白只存在于音轨中，画面中不添加字幕、标题、对白文字、水印或界面。';

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
