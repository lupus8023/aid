import test from 'node:test';
import assert from 'node:assert/strict';
import { listFishCatalog } from '../lib/series/fishCatalog.ts';

test('Fish public browsing is not constrained to licensed voices or a character-name search', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const q = new URL(url).searchParams;
    assert.equal(q.has('licensed'), false); assert.equal(q.has('self'), false); assert.equal(q.has('title'), false);
    assert.equal(q.get('page_number'), '2'); assert.equal(q.get('language'), 'en');
    assert.equal(init.headers.Authorization, 'Bearer fixture-key');
    return Response.json({ items: [
      { _id: 'public', title: 'Deep narrator', licensed: false, samples: [{ audio: 'https://platform.r2.fish.audio/task/sample.mp3' }] },
      { _id: 'licensed', title: 'Licensed', licensed: true },
      { _id: 'removed', dmca_taken_down: true }, { _id: 'retired', pvc_release_state: 'retiring' },
      { _id: 'wrong-type', type: 'svc' },
    ], total: 1000, total_is_exact: false, has_more: true });
  };
  try {
    const result = await listFishCatalog('fixture-key', { page: 2, language: 'en' });
    assert.deepEqual(result.items.map(x => x.source), ['public', 'licensed']);
    assert.equal(result.items[0].licensed, false); assert.match(result.items[0].sampleUrl, /^https:\/\/platform\.r2\.fish\.audio\//);
    assert.equal(result.hasMore, true); assert.equal(result.totalIsExact, false);
    assert.ok(!JSON.stringify(result).includes('fixture-key'));
  } finally { globalThis.fetch = previous; }
});

test('catalog preserves source distinctions, uses title filtering, and rejects unsafe sample links', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async url => {
    const q = new URL(url).searchParams;
    assert.equal(q.get('title'), 'deep');
    return Response.json({ items: [
      { _id: 'a', licensed: false, samples: [{ audio: 'https://untrusted.test/a.mp3' }] },
      { _id: 'b', licensed: true, samples: [{ audio: 'javascript:alert(1)' }] },
    ], has_more: false });
  };
  try {
    const owned = await listFishCatalog('key', { scope: 'workspace', query: 'deep' });
    assert.deepEqual(owned.items.map(x => x.source), ['workspace', 'workspace']);
    assert.ok(owned.items.every(x => !x.sampleUrl));
    const licensed = await listFishCatalog('key', { scope: 'licensed', query: 'deep' });
    assert.deepEqual(licensed.items.map(x => x.id), ['b']);
  } finally { globalThis.fetch = previous; }
});

test('invalid pagination and scopes stop before a provider request', async () => {
  const previous = globalThis.fetch; globalThis.fetch = async () => { throw new Error('provider should not be called'); };
  try {
    await assert.rejects(listFishCatalog('key', { page: -1 }), /页码/);
    await assert.rejects(listFishCatalog('key', { scope: 'all-private' }), /范围/);
  } finally { globalThis.fetch = previous; }
});
