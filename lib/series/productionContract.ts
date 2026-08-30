import type { Storyboard } from "@/types";

export interface SeriesProductionContract {
  shotCount: 18;
  voices: Record<string, string | undefined>;
  dialogue: Array<{ character: string; text: string }>;
}

// A second directing pass is allowed to stage the approved episode, but must
// not silently rewrite its dialogue, invent speakers or recast its actors.
export function validateSeriesProduction(
  contract: SeriesProductionContract,
  storyboards: Storyboard[],
): void {
  if (storyboards.length !== contract.shotCount)
    throw new Error("连续剧导演结果偏离已定稿的18镜");
  const canonical = (value: string) => value.replace(/\s+/g, "");
  const expected = new Map<string, string>();
  for (const line of contract.dialogue)
    expected.set(
      line.character,
      (expected.get(line.character) || "") + canonical(line.text),
    );
  const actual = new Map<string, string>();
  for (const shot of storyboards) {
    for (const line of shot.speech || []) {
      if (!(line.character in contract.voices))
        throw new Error(`导演新增了未定稿的发声角色“${line.character}”`);
      if (line.voiceId !== contract.voices[line.character])
        throw new Error(`角色“${line.character}”的声音偏离全剧定稿`);
      actual.set(
        line.character,
        (actual.get(line.character) || "") + canonical(line.exactLine),
      );
    }
  }
  for (const name of new Set([...expected.keys(), ...actual.keys()])) {
    if ((expected.get(name) || "") !== (actual.get(name) || ""))
      throw new Error(
        `导演改写、遗漏或重复了“${name}”的定稿台词；已停止进入付费画面制作`,
      );
  }
}
