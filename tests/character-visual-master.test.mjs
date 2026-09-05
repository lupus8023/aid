import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { readFile } from 'node:fs/promises';
import { buildCharacterMasterPrompt, buildGptCharacterMasterPrompt, HISTORICAL_CINEMA_AESTHETIC, buildCharacterExtensionPrompt, makeCharacterVisualMaster, resolveCharacterStoryboardModel } from '../lib/characterVisualMaster.ts';
import { buildMidjourneyImaginePayload } from '../lib/midjourney.ts';
import { characterFromDesignRecord } from '../lib/characterLibrary.ts';
import { seriesCastLibrary, applyLibraryActor, selectLibraryImage } from '../lib/series/casting.ts';
import { buildGridPrompt } from '../lib/gridSplitter.ts';
import { generateStoryboardImage } from '../lib/imageGenerator.ts';
import { createImageReferenceUploader, createStoryImageRequestPreparer } from '../lib/storyImageRequest.ts';

const masterUrl = 'https://example.com/mj-original.png';
const extensionUrl = 'https://example.com/gpt-extension.png';
const visualMaster = { ...makeCharacterVisualMaster(masterUrl, 'midjourney', 'soft even studio lighting'), extensionUrl };

test('GPT cinema preset teaches physical image structure without hardcoding the sample character', () => {
  const plain = buildGptCharacterMasterPrompt({ name: 'Pei', description: 'An elderly man in blue silk' });
  assert.doesNotMatch(plain, /historical cinema|dark areas|warm motivated/);
  const styled = buildGptCharacterMasterPrompt({ name: 'Pei', description: 'An elderly man in blue silk', aestheticDirection: HISTORICAL_CINEMA_AESTHETIC });
  for (const section of ['PHOTOGRAPHIC OUTPUT', 'COMPOSITION AND CAMERA', 'LIGHTING AND COLOR', 'SKIN AND MATERIALS', 'IMAGE CHARACTER']) assert.ok(styled.includes(section));
  assert.match(styled, /An elderly man in blue silk/);
  assert.doesNotMatch(styled, /young adult East Asian noblewoman|phoenix crown|85mm|105mm/);
  assert.doesNotMatch(buildCharacterExtensionPrompt('Pei'), /SKIN AND MATERIALS|PHOTOGRAPHIC OUTPUT/);
});

test('MJ master keeps complete aesthetic prose and does not impose fitting-photo style or raw', () => {
  const description = 'life-action fantasy movie scene\nancient Chinese style, detailed realistic skin texture';
  const prompt = buildCharacterMasterPrompt({ name: 'Moon', description, aestheticDirection: 'Soft even studio lighting, gentle shadows.', costumeDesc: 'intricate gold and Chinese gem-flower jewelry' });
  const body = buildMidjourneyImaginePayload({ prompt, aspectRatio: '9:16', taskMode: 'character-master', imageUrls: [masterUrl] });
  assert.ok(body.prompt.includes(description));
  assert.match(body.prompt, /Soft even studio lighting, gentle shadows/);
  assert.match(body.prompt, /intricate gold and Chinese gem-flower jewelry/);
  assert.doesNotMatch(body.prompt, /neutral studio|plain neutral background|restrained expression|restrained color/);
  assert.equal(body.raw, undefined);
  assert.deepEqual(body.image_urls, [masterUrl]);
});

test('GPT extension binds one master and inherits its look without neutralizing it', () => {
  const prompt = buildCharacterExtensionPrompt('Moon');
  assert.match(prompt, /image 1 as the sole approved visual master/);
  assert.match(prompt, /Exactly two columns and two rows/);
  assert.match(prompt, /Do not restyle/);
  assert.doesNotMatch(prompt, /neutral studio|grey background|PHOTOGRAPHIC OUTPUT|8K|PBR/);
});

test('library and series casting keep the original primary; derivation stays optional', () => {
  const record = { id: 'moon', name: 'Moon', description: 'white hanfu', conceptUrl: masterUrl, bibleUrl: extensionUrl, visualMaster };
  const character = characterFromDesignRecord(record);
  assert.equal(character.imageUrl, masterUrl);
  assert.deepEqual(character.visualMaster, visualMaster);
  const [entry] = seriesCastLibrary([], [record]);
  assert.equal(entry.imageCandidates[0], masterUrl);
  const selected = selectLibraryImage(entry, masterUrl);
  const production = applyLibraryActor({ id: 'c1', name: 'Moon', aliases: [], description: '', imageUrl: '' }, selected);
  assert.equal(production.imageUrl, masterUrl);
  assert.equal(production.bibleUrl, masterUrl);
  assert.equal(production.visualMaster.extensionUrl, extensionUrl);
  assert.equal(selectLibraryImage(entry, extensionUrl).visualMaster, undefined);
  assert.equal(resolveCharacterStoryboardModel('midjourney', [character]), 'gpt-image-2');
  assert.equal(resolveCharacterStoryboardModel('gpt-image-2-official', [character]), 'gpt-image-2-official');
  assert.equal(resolveCharacterStoryboardModel('midjourney', [{ name: 'legacy' }]), 'midjourney');
});

test('shared role uploader keeps bytes and reuses successful uploads after a later failure', async () => {
  const png = 'data:image/png;base64,b3JpZ2luYWwtZGV0YWls';
  let calls = 0;
  const request = async (url, options) => {
    if (url === png) return new Response(Buffer.from('original-detail'), { headers: { 'Content-Type': 'image/png' } });
    assert.equal(url, '/api/upload-image'); calls++;
    assert.equal(options.headers, undefined);
    assert.equal(await options.body.get('image').text(), 'original-detail');
    return Response.json({ url: masterUrl });
  };
  const upload = createImageReferenceUploader(request, true);
  assert.equal(await upload(png), masterUrl);
  await assert.rejects(upload('data:bad'), /参考图/);
  assert.equal(await upload(png), masterUrl);
  assert.equal(calls, 1);
});

test('Story serialization retains master metadata without adding bytes or MJ aesthetic prose', async () => {
  const prepared = JSON.parse(await createStoryImageRequestPreparer(async () => { throw new Error('no network'); })({
    storyboard: { id: 's1', sceneNumber: 1, characters: ['Moon'], objects: [], prompt: 'Moon raises a cup', description: 'raise cup', status: 'pending' },
    characters: [{ id: 'moon', name: 'Moon', description: 'hanfu', imageUrl: masterUrl, visualMaster }], objects: [],
    apiKey: 'test', imageModel: 'midjourney', aspectRatio: '9:16',
  }));
  assert.equal(prepared.imageModel, 'gpt-image-2');
  assert.equal(prepared.characters[0].visualMaster.imageUrl, masterUrl);
  assert.equal(prepared.characters[0].visualMaster.prompt, undefined);
});

test('single and four-cell storyboard requests inherit look and preserve product, action and reference order', async () => {
  const old = axios.post; const submissions = [];
  axios.post = async (_url, body) => { submissions.push(body); return { data: { data: [{ task_id: 'image-only-test' }] } }; };
  try {
    const cast = [{ id: 'moon', name: 'Moon', description: 'white hanfu', imageUrl: masterUrl, visualMaster }];
    const objects = [{ id: 'mask', name: 'mask', description: 'wet black gauze, face-sized, not gold foil', imageUrl: 'https://example.com/mask.png' }];
    const board = { id: 's1', sceneNumber: 1, characters: ['Moon'], objects: ['mask'], prompt: 'Moon pinches the wet black gauze mask with two fingers.', action: 'Two fingers lift the drooping mask.', shotSize: 'close-up', angle: 'slightly below her hands', status: 'pending' };
    await generateStoryboardImage(board, cast, 'test', objects, '9:16', 'midjourney');
    const labels = ['OBJECT IDENTITY: mask, wet black gauze', 'CHARACTER IDENTITY: Moon'];
    const prompt = buildGridPrompt('palace window', 'Moon', [board.prompt, board.prompt, board.prompt, board.prompt], '9:16', labels, [1,2,3,4], 'follow-reference', 'follow-reference', 'gpt-image-2');
    await generateStoryboardImage({ ...board, prompt }, cast, 'test', objects, '9:16', 'gpt-image-2', {}, undefined, [objects[0].imageUrl, masterUrl], labels);
    assert.equal(submissions.length, 2, 'no QC or regeneration calls');
    for (const body of submissions) {
      assert.equal(body.model, 'gpt-image-2');
      assert.deepEqual(body.image_urls, [objects[0].imageUrl, masterUrl]);
      assert.match(body.prompt, /CHARACTER DESIGN AUTHORITY/);
      assert.match(body.prompt, /pinches the wet black gauze mask with two fingers/);
      assert.doesNotMatch(body.prompt, /PHOTOGRAPHIC OUTPUT|PHOTOGRAPHIC SURFACE|ignore.*rendering style|not CG shading|Favor a believable observed moment/);
    }
    assert.match(submissions[1].prompt, /exactly two columns and two rows/);
  } finally { axios.post = old; }
});

test('role-design source uses original upload, direct save, native MJ candidates and resumable task IDs', async () => {
  const source = await readFile(new URL('../app/character-design/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /createImageReferenceUploader/);
  assert.doesNotMatch(source, /compressImage|toDataURL|canvas\.toBlob/);
  assert.match(source, /result\.candidateUrls/);
  assert.match(source, /原图直接入库/);
  assert.match(source, /已入库/);
  assert.match(source, /继续查询（不重新生成）/);
});
