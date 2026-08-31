import assert from 'node:assert/strict';
import test from 'node:test';
import { persistGeneratedStoryboardImage } from '../lib/generatedImagePersistence.ts';

test('paid provider output and inline images are stored before returning a usable URL', async () => {
  for (const source of ['https://getapib.org/f/paid.png', 'data:image/png;base64,fixture']) {
    const result = await persistGeneratedStoryboardImage(source, async (url, options) => {
      assert.equal(url, '/api/upload-image');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { imageData: source });
      return Response.json({ url: 'https://res.cloudinary.com/aid/stored.png' });
    });
    assert.equal(result, 'https://res.cloudinary.com/aid/stored.png');
  }
});

test('storage failure is not accepted as a completed image and can retry the same paid output', async () => {
  const source = 'https://getapib.org/f/paid.png';
  await assert.rejects(persistGeneratedStoryboardImage(source, async () => Response.json({ error: 'storage offline' }, { status: 503 })), /已保留生成任务.*storage offline/);
  await assert.rejects(persistGeneratedStoryboardImage(source, async () => Response.json({})), /没有返回素材地址/);
  await assert.rejects(persistGeneratedStoryboardImage(source, async () => Response.json({ url: source })), /没有返回素材地址/);
  assert.equal(await persistGeneratedStoryboardImage(source, async () => Response.json({ url: 'https://res.cloudinary.com/aid/recovered.png' })), 'https://res.cloudinary.com/aid/recovered.png');
});

test('existing storage and unrelated or disguised hosts do not trigger another upload', async () => {
  for (const source of ['https://res.cloudinary.com/aid/stored.png', 'https://other-provider.example/image.png', 'https://getapib.org.attacker.example/image.png', 'https://user:secret@getapib.org/image.png', 'https://getapib.org:444/image.png']) {
    assert.equal(await persistGeneratedStoryboardImage(source, async () => assert.fail('must not upload')), source);
  }
});
