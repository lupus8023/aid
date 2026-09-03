import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/series/page.tsx', import.meta.url), 'utf8');

test('series actions and job titles do not inherit a legacy project shot quota', () => {
  assert.doesNotMatch(source, /project\??\.shotCount/);
  assert.doesNotMatch(source, /(?:9|18)\s*(?:个镜头|镜剧本|镜就绪)|(?:九|十八)镜/);
  assert.match(source, /script: "分镜剧本"/);
  assert.match(source, /批量生成分镜剧本/);
  assert.match(source, /ep\.script \? "成片" : "生成分镜剧本"/);
  assert.equal((source.match(/\{jobNames\[j\.kind\]\}/g) || []).length, 2);
});

test('script tab, summary and readiness display the actual saved episode length', () => {
  assert.match(source, /分镜剧本 \{episode\.script\?\.length \? `\$\{episode\.script\.length\}镜 ✓` : "待生成"\}/);
  assert.match(source, /<span>\{episode\.script\.length\}个镜头<\/span>/);
  assert.match(source, /label: episode\.script\?\.length \? `\$\{episode\.script\.length\}镜就绪` : "故事就绪"/);
});

test('four-panel batching is explained without claiming every episode has a fixed shot count', () => {
  assert.match(source, /四宫格参考 · 镜数按各集剧本/);
  assert.match(source, /参考图每批 4 镜，已有成稿保留原镜数/);
});
