export interface AuthoredScreenplayShot {
  number: number;
  sourceSeconds: number;
  seconds: number;
  shotSize: string;
  action: string;
  camera: string;
  atmosphere: string;
  imagePrompt: string;
  dialogueSource: string;
  dialogueLines: string[];
}

export interface AuthoredScreenplay {
  shots: AuthoredScreenplayShot[];
  sourceDurationSeconds: number;
  durationSeconds: number;
}

const HEADER = /^\s*镜(?:头)?\s*(\d+)\s*(?:[｜|·、,:：-]?\s*时长\s*[:：]?\s*(\d+(?:\.\d+)?)\s*秒)?[^\n]*$/gim;
const FIELD = /(?:^|\s)(景别|动作|运镜|氛围|AI\s*生图提示词|台词)\s*[:：]\s*/gim;

function clean(value: unknown): string {
  return String(value || '').replace(/\r/g, '').trim();
}

function fieldsFromBlock(block: string): Record<string, string> {
  const matches = [...block.matchAll(FIELD)];
  const fields: Record<string, string> = {};
  matches.forEach((match, index) => {
    const key = match[1].replace(/\s+/g, '');
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : block.length;
    fields[key] = clean(block.slice(start, end));
  });
  return fields;
}

function quotedDialogue(value: string): string[] {
  const lines: string[] = [];
  for (const match of value.matchAll(/[“"]([^”"]+)[”"]/g)) {
    const line = clean(match[1]);
    if (line) lines.push(line);
  }
  return lines;
}

function speechSeconds(lines: string[], language: 'zh' | 'en'): number {
  const spoken = lines.reduce((sum, line) => {
    const han = (line.match(/[\u3400-\u9fff]/g) || []).length;
    const words = (line.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9']+/g) || []).length;
    const punctuation = (line.match(/[，。！？,.!?;；:：]/g) || []).length;
    return sum + Math.max(0.8, han / 4.2 + words / 2.4 + punctuation * 0.08);
  }, 0);
  if (!lines.length) return 0;
  return spoken + Math.max(0, lines.length - 1) * 0.12 + 1.8;
}

/**
 * Recognize a pasted, already-directed screenplay. The high threshold is
 * deliberate: an ordinary story that merely mentions “镜头” must continue to
 * use the normal four-multiple adaptation workflow.
 */
export function parseAuthoredScreenplay(
  brief: unknown,
  language: 'zh' | 'en' = 'zh',
): AuthoredScreenplay | undefined {
  const source = clean(brief);
  const headers = [...source.matchAll(HEADER)];
  if (headers.length < 2 || headers.length > 81) return undefined;
  const shots = headers.map((header, index): AuthoredScreenplayShot => {
    const start = (header.index || 0) + header[0].length;
    const end = index + 1 < headers.length ? headers[index + 1].index! : source.length;
    const fields = fieldsFromBlock(source.slice(start, end));
    const dialogueSource = fields['台词'] || '';
    const dialogueLines = quotedDialogue(dialogueSource);
    const sourceSeconds = Number(header[2] || 0);
    const requiredSeconds = Math.ceil(speechSeconds(dialogueLines, language));
    return {
      number: Number(header[1]),
      sourceSeconds,
      seconds: Math.min(15, Math.max(2, sourceSeconds || 0, requiredSeconds)),
      shotSize: fields['景别'] || '',
      action: fields['动作'] || '',
      camera: fields['运镜'] || '',
      atmosphere: fields['氛围'] || '',
      imagePrompt: fields['AI生图提示词'] || '',
      dialogueSource,
      dialogueLines,
    };
  });
  if (shots.some((shot, index) => shot.number !== index + 1)) return undefined;
  const directed = shots.filter(shot => shot.action && (shot.camera || shot.imagePrompt || shot.dialogueSource));
  if (directed.length < Math.ceil(shots.length * 0.8)) return undefined;
  return {
    shots,
    sourceDurationSeconds: shots.reduce((sum, shot) => sum + shot.sourceSeconds, 0),
    durationSeconds: shots.reduce((sum, shot) => sum + shot.seconds, 0),
  };
}

export function isAuthoredScreenplayBrief(brief: unknown): boolean {
  return Boolean(parseAuthoredScreenplay(brief));
}
