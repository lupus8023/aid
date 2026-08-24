export const VOICE_REFERENCE_CONTRACT_VERSION = 'timbre-v3';

// H3 receives this file only as a speaker/timbre reference. Sustained isolated
// vowels made a weak reference: they contained too little consonant/transient
// information and could leave a voiced tail in the generated audio latent.
// Use a calm, naturally articulated calibration read instead. Exact dialogue
// is generated and ASR-trimmed separately, so these words never become the
// delivered dialogue track.
export function voiceReferenceSample(language: 'zh' | 'en' = 'zh'): string {
  return language === 'en'
    ? 'Today feels calm and clear. I will finish these two sentences in a natural, steady voice, while the quiet moment moves gently forward.'
    : '今天的空气很安静，我会用自然、清楚、平稳的声音说完这两句话。远处的风轻轻吹过，时间正在缓缓向前。';
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
