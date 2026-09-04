export interface SourceShotBlock { index: number; sequence: string; text: string }

/** Retain the whole directed shot, not just its heading. Consecutive H3
 * timeline sections labelled Shot 1 are phases of one shot, not new shots. */
export function sourceShotBlocks(source: string): SourceShotBlock[] {
  const shots: SourceShotBlock[] = [];
  let sequence = 'source-sequence-1';
  let current: SourceShotBlock | undefined;
  for (const line of String(source || '').split(/\r?\n/)) {
    const heading = line.match(/^\s*#{2,}\s*(?:SEQUENCE|场次)\s*([^\n]*)/iu);
    if (heading) { sequence = heading[1]?.trim() || sequence; current = undefined; continue; }
    const shot = line.match(/^\s*(?:#{1,6}\s*)?\[?\s*(?:SHOT|镜(?:头)?)\s*0*(\d+)(?!\d)/iu);
    if (shot) {
      const index = Number(shot[1]);
      if (!current || current.index !== index || current.sequence !== sequence) {
        current = { index, sequence, text: line.trim() }; shots.push(current); continue;
      }
    }
    if (current) current.text += `\n${line}`;
  }
  return shots;
}

/** Dialogue may follow its own heading on later lines. Stop before the next
 * authored visual/audio section so quoted product text is never spoken. */
export function sourceDialogueSections(source: string): string[] {
  return [...source.matchAll(/(?:dialogue|台词|对白)\s*[:：]\s*([\s\S]*?)(?=(?:\n|\|)\s*(?:\[|#{1,6}\s|(?:动作|景别|运镜|氛围|AI\s*生图提示词|环境音|配乐|Action|Camera|Sound|Music|SFX|Atmosphere)\s*[:：])|$)/giu)]
    .map(match => match[1]);
}

export function sourceShotVisualFields(text: string): { action?: string; shotSize?: string; cameraMove?: string } {
  const fields = [...text.matchAll(/(?:^|\s|\|)(景别|动作|运镜|氛围|AI\s*生图提示词|台词|对白|Action|Shot size|Camera|Atmosphere|Image prompt|Dialogue)\s*[:：]\s*/gimu)];
  const result: Record<string, string> = {};
  fields.forEach((field, index) => {
    const key = ({ 动作: 'action', action: 'action', 景别: 'shotSize', 'shot size': 'shotSize', 运镜: 'cameraMove', camera: 'cameraMove' } as Record<string, string>)[field[1].toLowerCase()];
    if (!key) return;
    const value = text.slice(field.index! + field[0].length, fields[index + 1]?.index ?? text.length).trim();
    if (value) result[key] = [result[key], value].filter(Boolean).join('\n');
  });
  return result;
}
