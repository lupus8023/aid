import { fishAutoVoiceCandidates } from '@/lib/voiceCasting';

export interface FishSpeechResult {
  buffer: Buffer;
  voiceId: string;
  requestedVoiceId: string;
}

function referenceMissing(status: number, body: string): boolean {
  return status === 400 && /reference\s+not\s+found/i.test(body);
}

export async function generateFishSpeech(
  text: string,
  voiceId: string | undefined,
  fishAudioKey: string,
  options: { strictVoice?: boolean } = {},
): Promise<FishSpeechResult> {
  const requestedVoiceId = String(voiceId || '').trim();
  if (!requestedVoiceId) throw new Error('每条台词必须绑定明确的角色 voiceId，已禁止使用 Fish 默认音色');
  const candidates = options.strictVoice ? [requestedVoiceId] : fishAutoVoiceCandidates(requestedVoiceId);
  let lastError = '';
  for (const candidate of candidates) {
    const response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${fishAudioKey}`,
        'Content-Type': 'application/json',
        'model': 's2-pro',
      },
      body: JSON.stringify({ text, format: 'mp3', reference_id: candidate }),
      signal: AbortSignal.timeout(120000),
    });
    if (response.ok) {
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        voiceId: candidate,
        requestedVoiceId,
      };
    }
    const body = await response.text();
    lastError = body;
    if (!referenceMissing(response.status, body) || candidates.length === 1) {
      throw new Error(`fish.audio error: ${body}`);
    }
  }
  throw new Error(`fish.audio error: ${lastError || 'No usable automatic voice reference remains'}`);
}
