import { extractJson } from '@/lib/pipeline/json';

export class ScriptModelRefusalError extends Error {
  readonly code = 'MODEL_CONTENT_REJECTED';
  constructor() {
    super('文本模型在剧本输出中拒绝继续，未返回完整剧本；原稿已保留，不会自动重提。请检查模型提示的拒绝原因及输入内容后再处理');
  }
}

export class IncompleteScriptOutputError extends Error {
  readonly code = 'SCRIPT_OUTPUT_INCOMPLETE';
  constructor(readonly shots: Record<string, unknown>[]) {
    super(`剧本 JSON 未完整返回，已保留 ${shots.length} 个完整镜头，需要补齐剩余内容`);
  }
}

// Refusal prose must be outside a valid JSON document; an actor saying these
// words in a valid screenplay is ordinary dialogue, not a provider refusal.
function hasRefusalTail(text: string): boolean {
  return /(?:^|\n)\s*(?:(?:I['’]m|I am) sorry[,，]?\s*(?:but\s*)?)I (?:cannot|can['’]t|am unable to) (?:assist|help|comply|continue)[^\n]*[.!]?\s*$/i.test(text)
    || /(?:^|\n)\s*(?:抱歉|对不起)[，,。\s]*(?:但)?我(?:无法|不能)(?:帮助|协助|继续|满足|提供)[^\n]*\s*$/.test(text);
}

/** Extract only fully closed shot objects from the top-level shots array.
 * Never close a broken string, invent fields, or use an inner dialogue object. */
export function completeScriptPrefix(text: string): Record<string, unknown>[] {
  const source = text.trim().replace(/^```(?:json)?\s*/i, '');
  const opening = source.match(/^\{\s*"shots"\s*:\s*\[/);
  if (!opening) return [];
  const shots: Record<string, unknown>[] = [];
  let start = opening[0].length;
  while (start < source.length) {
    while (/\s/.test(source[start] || '') && start < source.length) start++;
    if (source[start] !== '{') break;
    const stack = ['{'];
    let quoted = false, escaped = false, complete = false;
    for (let end = start + 1; end < source.length; end++) {
      const char = source[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === '{' || char === '[') stack.push(char);
      if (char !== '}' && char !== ']') continue;
      if (stack.pop() !== (char === '}' ? '{' : '[')) return shots;
      if (stack.length) continue;
      try {
        const shot = JSON.parse(source.slice(start, end + 1));
        if (!Number.isInteger(shot.number) || shot.number < 1
          || (shots.length && shot.number !== Number(shots.at(-1)!.number) + 1)) return shots;
        shots.push(shot);
      } catch { return shots; }
      start = end + 1;
      while (start < source.length && /\s/.test(source[start])) start++;
      if (source[start] !== ',') return shots;
      start++;
      complete = true;
      break;
    }
    if (!complete) break;
  }
  return shots;
}

export function parseScriptOutput(text: string): any {
  let raw: any;
  try { raw = extractJson(text); }
  catch (error) {
    if (hasRefusalTail(text)) throw new ScriptModelRefusalError();
    const prefix = completeScriptPrefix(text);
    if (prefix.length) throw new IncompleteScriptOutputError(prefix);
    throw error;
  }
  if (raw?._aidModelRefusal === true) throw new ScriptModelRefusalError();
  if (raw?._aidIncompleteScript === true && Array.isArray(raw.shots))
    throw new IncompleteScriptOutputError(raw.shots);
  return raw;
}

export function appendScriptContinuation(
  prefix: Record<string, unknown>[], response: string, count: number,
): { shots: Record<string, unknown>[]; _aidIncompleteScript?: true } {
  let extra: Record<string, unknown>[];
  try { extra = parseScriptOutput(response)?.shots; }
  catch (error) {
    if (!(error instanceof IncompleteScriptOutputError)) throw error;
    extra = error.shots;
  }
  if (!Array.isArray(extra) || !extra.length) throw new Error('续写必须返回包含缺失镜头的 shots 数组');
  // Accept a provider that repeats the full document only if the retained
  // prefix is byte-for-byte equivalent at the JSON-value level.
  if (extra[0]?.number === 1) {
    if (JSON.stringify(extra.slice(0, prefix.length)) !== JSON.stringify(prefix))
      throw new Error('续写改动了已保留镜头，未覆盖原稿');
    extra = extra.slice(prefix.length);
  }
  if (!extra.length || extra.some((shot, i) => shot?.number !== prefix.length + i + 1)
    || prefix.length + extra.length > count) throw new Error('续写镜头编号不连续或超出本集范围，未覆盖原稿');
  const shots = [...prefix, ...extra];
  return { shots, ...(shots.length < count ? { _aidIncompleteScript: true as const } : {}) };
}
