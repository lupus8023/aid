// Isolated browser: every API is mocked; never writes to the real Companion.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSeries, parseOutline } from '../lib/series/domain.ts';
import { outlineFixture } from './fixtures/series.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.env.AID_TEST_NODE_MODULES || process.cwd()] }));
const base = process.env.AID_TEST_URL || 'http://127.0.0.1:3039';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const project = createSeries({ name: '新增道具隔离测试', brief: '独立测试', episodeCount: 3 });
Object.assign(project, parseOutline(outlineFixture(), project));
project.objects = [{ id: 'box', name: '锦盒', aliases: ['面膜'], description: '木盒', referenceMode: 'upload', imageUrl: 'https://example.com/box.png' }];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  let uploads = 0, saves = 0, failSave = true;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'example.com') return route.fulfill({ contentType: 'image/png', body: png });
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/companion/series') {
        if (route.request().method() === 'GET') return route.fulfill({ json: { projects: [project], jobs: [], workerOnline: true } });
        const body = route.request().postDataJSON();
        if (body.action === 'claim') return route.fulfill({ json: { claim: null } });
        assert.equal(body.action, 'upsert-object'); saves++;
        if (failSave) return route.fulfill({ status: 400, json: { error: '测试保存故障' } });
        project.objects.push({ id: 'new-prop', ...body.patch }); project.revision++;
        return route.fulfill({ json: { project, narrativeQueued: false } });
      }
      if (url.pathname === '/api/companion/status') return route.fulfill({ json: { seriesFixedObjects: true, seriesObjectAutoReferences: true, seriesNarrativeObjectInsertion: true } });
      if (url.pathname === '/api/upload-image') { uploads++; return route.fulfill({ json: { url: 'https://example.com/new.png' } }); }
      throw Error(`Unexpected API ${url.pathname}`);
    }
    if (url.origin !== base && !['blob:', 'data:'].includes(url.protocol)) return route.abort();
    return route.continue();
  });
  await page.goto(`${base}/series`);
  await page.getByRole('button', { name: '角色与场景', exact: true }).click();
  const card = page.locator('article').filter({ has: page.getByRole('button', { name: '添加全剧固定道具', exact: true }) });
  await card.locator('input[name=name]').fill('面膜袋');
  await card.locator('textarea[name=description]').fill('金色包装袋');
  await card.locator('input[name=aliases]').fill('面膜、面膜袋子');
  await card.locator('input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png });
  await card.getByAltText('待保存的道具参考图').waitFor();
  project.revision++;
  await page.waitForTimeout(4500); // Cross the real UI snapshot refresh interval.
  assert.equal(await card.locator('input[name=name]').inputValue(), '面膜袋');
  assert.equal(await card.locator('input[type=file]').evaluate(el => el.files.length), 1);
  await card.getByRole('button', { name: '添加全剧固定道具', exact: true }).click();
  await card.getByRole('alert').filter({ hasText: '已被道具“锦盒”使用' }).waitFor();
  assert.equal(uploads, 0); assert.equal(saves, 0);
  await card.locator('input[name=aliases]').fill('面膜袋子');
  await card.getByRole('button', { name: '添加全剧固定道具', exact: true }).click();
  await card.getByRole('alert').filter({ hasText: '测试保存故障' }).waitFor();
  assert.equal(await card.locator('input[name=name]').inputValue(), '面膜袋');
  assert.equal(await card.locator('input[type=file]').evaluate(el => el.files.length), 1);
  failSave = false;
  await card.getByRole('button', { name: '添加全剧固定道具', exact: true }).click();
  await card.getByRole('status').filter({ hasText: '已新增' }).waitFor();
  assert.equal(await card.locator('input[name=name]').inputValue(), '');
  assert.equal(await card.locator('input[type=file]').evaluate(el => el.files.length), 0);
  assert.equal(project.objects.length, 2);
  assert.equal(saves, 2); assert.deepEqual(errors, []);
  console.log('PASS: preview, draft survives refresh/failure, conflict before upload, success resets once');
} finally { await browser.close(); }
