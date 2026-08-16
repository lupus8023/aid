// 从 LLM 返回的自由文本里健壮地提取最外层 JSON（对象或数组）。
// 兼容 markdown 代码块围栏、前后多余文字、以及常见的模型「多嘴」输出。
export function extractJson(text: string): any {
  const t = String(text || '').trim();

  const trySlice = (start: number, end: number): any | undefined => {
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return undefined;
    }
  };

  // 优先最外层对象 {...}
  const obj = trySlice(t.indexOf('{'), t.lastIndexOf('}'));
  if (obj !== undefined) return obj;

  // 其次最外层数组 [...]
  const arr = trySlice(t.indexOf('['), t.lastIndexOf(']'));
  if (arr !== undefined) return arr;

  throw new Error(`No valid JSON in AI response (${t.length} chars): ${t.slice(0, 300)}`);
}
