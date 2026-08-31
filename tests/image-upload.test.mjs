import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { fitImageUpload, MAX_STORED_IMAGE_BYTES, uploadImage } from '../lib/imageUpload.ts';

const width = 2048, height = 2048;
const large = await sharp(randomBytes(width * height * 4), { raw: { width, height, channels: 4 } }).png().toBuffer();

test('oversized images retain full resolution and alpha under the storage limit; small images remain unchanged', async () => {
  assert.ok(large.byteLength > 10 * 1024 * 1024);
  const output = await fitImageUpload(large);
  const metadata = await sharp(output).metadata();
  assert.ok(output.byteLength <= MAX_STORED_IMAGE_BYTES);
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.format, 'webp');
  assert.equal(await fitImageUpload(output), output);
  await assert.rejects(fitImageUpload(Buffer.alloc(50 * 1024 * 1024 + 1)), /超过 50 MB/);
});

test('storage size rejection retries the same generated image as a buffer, without any generation call', async () => {
  const keys = ['CLOUDINARY_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_BACKUP_URL', 'CLOUDINARY_URL_BACKUP', 'AID_LOCAL_COMPANION'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const source = 'https://images.example.test/already-generated.png';
  const upload = 'https://api.cloudinary.com/v1_1/fixture/image/upload';
  let downloads = 0, uploads = 0, networkFailure = false;
  try {
    keys.forEach(key => { delete process.env[key]; });
    process.env.AID_LOCAL_COMPANION = '1';
    globalThis.fetch = async (url, init) => {
      if (String(url) === 'https://pandais.beauty/api/media-upload/sign')
        return Response.json({ targets: [{ url: upload, fields: { signature: 'test', overwrite: 'false' } }] });
      if (String(url) === source) {
        downloads++;
        assert.equal(init.redirect, 'error');
        return new Response(large, { headers: { 'content-type': 'image/png', 'content-length': String(large.length) } });
      }
      assert.equal(String(url), upload, 'only storage and the existing source may be contacted');
      uploads++;
      if (networkFailure) throw new Error('network unavailable');
      const file = init.body.get('file');
      if (typeof file === 'string') {
        assert.equal(file, source);
        return Response.json({ error: { message: 'File size too large. Maximum is 10485760.' } }, { status: 400 });
      }
      assert.ok(file.size <= MAX_STORED_IMAGE_BYTES);
      assert.equal((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).width, width);
      return Response.json({ secure_url: 'https://assets.example.test/persisted.webp' });
    };
    assert.equal((await uploadImage(source)).secure_url, 'https://assets.example.test/persisted.webp');
    assert.equal(downloads, 1);
    assert.equal(uploads, 2);
    networkFailure = true;
    await assert.rejects(uploadImage(source), /network unavailable/);
    assert.equal(downloads, 1, 'network failures must not trigger compression or redownload');
    assert.equal(uploads, 3);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
