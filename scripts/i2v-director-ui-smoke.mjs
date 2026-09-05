// Local UI contract test. Every generation endpoint is mocked; no model/GPU calls.
// AID_PLAYWRIGHT_MODULE may point to an already installed Playwright module.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.AID_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.AID_UI_ORIGIN || 'http://127.0.0.1:3041';
const browser = await chromium.launch({ headless: true, ...(process.env.AID_BROWSER_EXECUTABLE ? { executablePath: process.env.AID_BROWSER_EXECUTABLE } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem('appSettings', JSON.stringify({ videoProvider: 'comfyui', scriptModel: 'gpt-4o', apiKey: 'mock-only', comfyui: { useLocalCompanion: false } }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let submissions = 0, queries = 0, submitted, capability = true;
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  await context.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    const json = data => route.fulfill({ json: data });
    if (pathname === '/api/companion/status') return json({ ok: true, version: '0.1.196', h3DirectorLongVideo: capability });
    if (pathname === '/api/prepare-long-video') return json({ plan: { duration: body.duration, sourcePrompt: body.prompt, segments: Array.from({ length: body.duration / 10 }, (_, i) => ({ prompt: `00:00.000–00:09.500: ACTION_${i + 1}. No dialogue.` })) } });
    if (pathname === '/api/image-to-video') {
      submissions++; submitted = body;
      return json({ taskId: 'comfyui:smoke-director-123', totalSegments: body.duration / 10 });
    }
    if (pathname === '/api/check-video-status') { queries++; return json({ status: 'processing', stage: 'director_generating', completedSegments: 1, totalSegments: 6 }); }
    throw new Error(`Unmocked API: ${pathname}`);
  });
  await page.goto(`${origin}/image-to-video`);
  await page.getByRole('button', { name: '连续长视频 · 实验', exact: false }).click();
  await page.locator('select').filter({ has: page.locator('option[value="60"]') }).selectOption('60');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSDoAAAAASUVORK5CYII=', 'base64') });
  await page.locator('textarea').first().fill('手持黑灰网布面膜，缓慢展开并展示，动作连续，无对白。');
  await page.getByRole('button', { name: '按原稿整理分段', exact: true }).click();
  await page.locator('textarea').nth(6).waitFor();
  assert.equal(await page.locator('textarea').count(), 7);
  await page.locator('textarea').nth(3).fill('00:00.000–00:09.500: USER_EDITED_ACTION. No dialogue.');
  await page.getByRole('button', { name: '开始连续生成约 60 秒', exact: true }).click();
  await page.getByText('连续生成中，已完成 1/6 段', { exact: true }).waitFor();
  assert.equal(submissions, 1);
  assert.equal(submitted.duration, 60);
  assert.equal(submitted.comfyWorkflowMode, 'director_continuous');
  assert.equal(submitted.directorPlan.segments.length, 6);
  assert.match(submitted.directorPlan.segments[2].prompt, /USER_EDITED_ACTION/);
  assert.equal(submitted.directorPlan.sourcePrompt, submitted.prompt);
  await page.reload();
  await page.getByRole('button', { name: '继续查询（不重新生成）', exact: true }).click();
  await page.getByText('连续生成中，已完成 1/6 段', { exact: true }).waitFor();
  assert.ok(queries >= 2);
  assert.equal(submissions, 1, 'reload/recovery must not purchase another video');

  // Older server capability must stop the request before any video submission.
  await page.evaluate(() => localStorage.removeItem('aid:i2v:task:v1'));
  await page.reload();
  capability = false;
  await page.getByRole('button', { name: '连续长视频 · 实验', exact: false }).click();
  await page.locator('textarea').first().fill('A slow continuous hand movement.');
  await page.getByRole('button', { name: '按原稿整理分段', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  assert.ok(dialogs.some(message => message.includes('尚不支持 H3 Director')));
  assert.equal(submissions, 1);
  assert.deepEqual(errors, []);
  console.log('PASS: 60-second selection, editable six-segment plan, one video submission, refresh/resume without resubmit, older-Companion guard; no real API generation.');
} finally {
  await browser.close();
}
