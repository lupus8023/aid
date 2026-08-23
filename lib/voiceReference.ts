export const VOICE_REFERENCE_CONTRACT_VERSION = 'timbre-v2';

// H3 receives this file only as a speaker/timbre reference. Ordinary words in
// the old reference sentence could be copied into the start of a generated
// clip, so the reference deliberately contains no lexical or story content.
export function voiceReferenceSample(language: 'zh' | 'en' = 'zh'): string {
  return language === 'en'
    ? 'Mmm—ah—oh—ee—oo. Mmm—ah—oh—ee—oo.'
    : '嗯——啊——哦——咿——呜。嗯——啊——哦——咿——呜。';
}

export function voiceReferencePublicId(characterName?: string): string {
  const safeName = String(characterName || 'character').trim().replace(/\s+/g, '-') || 'character';
  return `voice-ref-${VOICE_REFERENCE_CONTRACT_VERSION}-${safeName}-${Date.now()}`;
}

export function isCurrentVoiceReference(url: unknown): url is string {
  return typeof url === 'string' && url.includes(`/voice-ref-${VOICE_REFERENCE_CONTRACT_VERSION}-`);
}

export function currentVoiceReferences(references: unknown): Record<string, string> | undefined {
  if (!references || typeof references !== 'object') return undefined;
  const current: Record<string, string> = {};
  for (const [name, url] of Object.entries(references as Record<string, unknown>)) {
    if (isCurrentVoiceReference(url)) current[name] = url;
  }
  return Object.keys(current).length ? current : undefined;
}
