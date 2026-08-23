function normalized(value: string | undefined): string {
  return String(value || '').trim().toLocaleLowerCase();
}

/**
 * Fish S2-Pro interprets one concise bracket cue as delivery control rather
 * than spoken dialogue. The exact line remains byte-for-byte unchanged after
 * the cue, so screenplay directions can never leak into the audible wording.
 */
export function fishS2ControlledText(
  exactLine: string,
  emotion?: string,
  delivery?: string,
): string {
  const line = String(exactLine || '').trim();
  if (!line) return '';
  const control = `${normalized(emotion)} ${normalized(delivery)}`;
  const cue = /(?:愤怒|恼怒|怒|angry|anger|furious|confront)/u.test(control)
    ? 'restrained anger'
    : /(?:悲伤|难过|哽咽|哭|sad|grief|broken|tearful)/u.test(control)
      ? 'restrained sadness'
      : /(?:害怕|恐惧|焦虑|不安|fear|afraid|anxious|uncertain)/u.test(control)
        ? 'contained anxiety'
        : /(?:坚定|果断|决心|坚决|determined|firm|resolute|decisive)/u.test(control)
          ? 'calm determination'
          : /(?:温柔|关切|安慰|同情|warm|gentle|empathetic|compassion)/u.test(control)
            ? 'gentle warmth'
            : /(?:急迫|紧急|迅速|urgent|quick|fast)/u.test(control)
              ? 'urgent but controlled'
              : '';
  return cue ? `[${cue}] ${line}` : line;
}
