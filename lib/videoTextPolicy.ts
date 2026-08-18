/**
 * Global visual-text policy for generated video.
 *
 * Keep this provider-agnostic and inject it at the final request boundary. H3
 * can otherwise interpret spoken dialogue as a request to burn a translation
 * or caption into only some shots.
 */
export const NO_SUBTITLE_POLICY_MARKER = 'ZERO-SUBTITLE OUTPUT CONTRACT';

export const NO_SUBTITLE_POLICY = `${NO_SUBTITLE_POLICY_MARKER} (absolute, applies to every frame): The picture must remain image-only. Render zero subtitles, closed captions, burned-in dialogue, translated dialogue, karaoke text, title cards, lower thirds, speech bubbles, credits, UI text, timecodes, logos or watermarks. Spoken dialogue exists in the audio track only: never transcribe, translate, quote or visualize any spoken word. Keep the bottom, top and margins of the frame completely free of generated glyphs. Do not add letters, numbers or symbols anywhere; any unavoidable writing already physically present in a supplied reference must remain unchanged and must never become an overlay. 画面中禁止出现任何字幕，台词只能存在于音轨。`;

/** Add the hard rule around a complete provider prompt, without multiplying it. */
export function enforceNoSubtitles(prompt: string): string {
  const body = String(prompt || '').trim();
  if (!body) return NO_SUBTITLE_POLICY;
  if (body.startsWith(NO_SUBTITLE_POLICY) && body.endsWith(NO_SUBTITLE_POLICY)) return body;
  return `${NO_SUBTITLE_POLICY}\n\n${body}\n\nFINAL VISUAL CHECK — ${NO_SUBTITLE_POLICY}`;
}

/**
 * Inject the rule into each Story beat before the request reaches localhost.
 * This deliberately supports already-installed Companion versions, which
 * rebuild the final H3 prompt from each storyboard description.
 */
export function withNoSubtitleBeat(description?: string): string {
  const body = String(description || '').trim();
  if (body.includes(NO_SUBTITLE_POLICY_MARKER)) return body;
  return `${NO_SUBTITLE_POLICY}\nVISUAL ACTION: ${body || 'Continue the scripted visual action without adding text.'}`;
}
