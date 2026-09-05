// No paid calls: isolated browser storage and every API/media request mocked.
// Start a local production server, then run with AID_TEST_NODE_MODULES pointing
// to an existing Playwright installation (no test dependency download required).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.env.AID_TEST_NODE_MODULES || process.cwd()] }));
const base = process.env.AID_TEST_URL || 'http://127.0.0.1:3039';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const browser = await chromium.launch({ headless: true, channel: process.env.AID_TEST_BROWSER || 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const calls = []; const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    if (!localStorage.getItem('ui-test-seeded')) {
      localStorage.setItem('appSettings', JSON.stringify({ apiKey: 'mock-key', imageModel: 'midjourney', comfyui: { useLocalCompanion: false } }));
      localStorage.setItem('ui-test-seeded', '1');
    }
  });
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname === 'example.com') return route.fulfill({ contentType: 'image/png', body: png });
    if (url.hostname === 'api.cloudinary.com') return route.fulfill({ json: { secure_url: 'https://example.com/original.png' } });
    if (url.pathname.startsWith('/api/')) {
      calls.push({ path: url.pathname, body: request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null });
      if (url.pathname === '/api/upload-image') return route.fulfill({ json: { url: 'https://example.com/original.png' } });
      if (url.pathname === '/api/media-upload/sign') return route.fulfill({ json: { targets: [{ url: 'https://api.cloudinary.com/v1_1/mock/image/upload', fields: { signature: 'mock-only' } }] } });
      if (url.pathname === '/api/character-design') {
        const body = request.postDataJSON();
        return route.fulfill({ json: { taskId: body.stage === 'extension' ? 'gpt-extension' : body.imageModel === 'midjourney' ? 'midjourney:mock' : 'gpt-master', prompt: body.aestheticDirection || 'mock master prompt', layout: body.imageModel === 'midjourney' ? 'native-candidates' : 'single' } });
      }
      if (url.pathname === '/api/check-image-status') {
        const mj = request.postDataJSON().taskId.startsWith('midjourney:');
        return route.fulfill({ json: { status: 'completed', imageUrl: `https://example.com/${mj ? 'candidate-1' : request.postDataJSON().taskId}.png`,
          ...(mj ? { candidateUrls: [1,2,3,4].map(i => `https://example.com/candidate-${i}.png`) } : {}) } });
      }
      throw new Error(`Unexpected API call ${url.pathname}`);
    }
    if (url.origin !== base && !url.protocol.startsWith('data')) return route.abort();
    return route.continue();
  });
  await page.goto(`${base}/character-design`);
  await page.getByPlaceholder('例如：Meme').fill('测试角色');
  await page.getByPlaceholder('可以直接粘贴你的 MJ 提示词：', { exact: false }).fill('Fine strands of hair, white silk hanfu, soft even light.');
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: '直接采用原图', exact: true }).click();
  await page.getByRole('button', { name: '原图直接入库', exact: true }).click();
  await page.getByRole('button', { name: '已入库', exact: true }).waitFor();
  let record = await page.evaluate(() => JSON.parse(localStorage.getItem('aidCharacterDesigns'))[0]);
  assert.equal(record.visualMaster.imageUrl, 'https://example.com/original.png');
  assert.equal(record.bibleUrl, '');
  await page.getByLabel('定稿制作风格', { exact: true }).selectOption('warm-film');
  await page.getByLabel('定稿拍摄方式', { exact: true }).selectOption('commercial-studio');
  await page.getByLabel('上传生图风格参考').setInputFiles({ name: 'style.png', mimeType: 'image/png', buffer: png });
  await page.getByAltText('已启用的生图风格参考').waitFor();
  await page.getByLabel('生图风格说明', { exact: true }).fill('Warm gold STYLE_UI_SENTINEL');
  await page.getByLabel('MJ 风格权重', { exact: true }).fill('300');
  await page.getByRole('button', { name: '重新探索角色方向', exact: true }).click();
  await page.getByAltText('角色方向 4', { exact: true }).waitFor();
  assert.equal(await page.locator('img[alt^="角色方向"]').count(), 4);
  const masterRequest = calls.find(call => call.path === '/api/character-design').body;
  assert.equal(masterRequest.visualStyle, 'warm-film');
  assert.equal(masterRequest.capturePreset, 'commercial-studio');
  assert.equal(masterRequest.midjourneyStyle.styleWeight, 300);
  assert.match(masterRequest.styleReference.description, /STYLE_UI_SENTINEL/);
  await page.getByAltText('角色方向 2', { exact: true }).click();
  await page.getByRole('button', { name: 'GPT 四宫格延展（可选）', exact: true }).click();
  await page.getByAltText('测试角色 GPT 延展', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存原图与延展', exact: true }).click();
  record = await page.evaluate(() => JSON.parse(localStorage.getItem('aidCharacterDesigns'))[0]);
  assert.equal(record.visualMaster.imageUrl, 'https://example.com/candidate-2.png');
  assert.equal(record.visualMaster.extensionUrl, 'https://example.com/gpt-extension.png');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('aidCharacterDesigns')).length), 1);
  await page.reload();
  await page.getByRole('button', { name: '已入库', exact: true }).waitFor();
  assert.equal(await page.getByLabel('定稿制作风格', { exact: true }).inputValue(), 'warm-film');
  assert.equal(await page.getByLabel('定稿拍摄方式', { exact: true }).inputValue(), 'commercial-studio');
  assert.match(await page.getByLabel('生图风格说明', { exact: true }).inputValue(), /STYLE_UI_SENTINEL/);
  await page.getByLabel('角色定稿模型（独立于 Story 生图设置）').selectOption('gpt-image-2');
  await page.getByRole('button', { name: '使用预设：古装电影实拍质感', exact: true }).click();
  assert.match(await page.getByLabel('GPT 审美方向（可选，原样保留）').inputValue(), /SKIN AND MATERIALS/);
  await page.getByRole('button', { name: '重新探索角色方向', exact: true }).click();
  await page.locator('img[alt="角色方向 1"][src="https://example.com/gpt-master.png"]').waitFor();
  assert.equal(await page.locator('img[alt^="角色方向"]').count(), 1);
  const generationCount = calls.filter(call => call.path === '/api/character-design').length;
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('aidCharacterMasterDraftV1'));
    draft.pending = { taskId: 'gpt-resumed-master', stage: 'concepts', model: 'gpt-image-2', count: 4, layout: 'single' };
    localStorage.setItem('aidCharacterMasterDraftV1', JSON.stringify(draft));
  });
  await page.reload();
  await page.getByRole('button', { name: '继续查询（不重新生成）', exact: true }).click();
  await page.locator('img[alt="角色方向 1"][src="https://example.com/gpt-resumed-master.png"]').waitFor();
  assert.equal(calls.filter(call => call.path === '/api/character-design').length, generationCount);
  assert.equal(calls.filter(call => call.path === '/api/split-grid').length, 0);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'mobile layout must not overflow');
  console.log('PASS: original adoption, MJ native 4 candidates, direct library save/tag, optional GPT extension, GPT aesthetic preset/single image, reload recovery, no duplicate paid submissions, mobile layout.');
} finally { await browser.close(); }
