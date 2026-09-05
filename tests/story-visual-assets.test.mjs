import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { readFile } from 'node:fs/promises';
import { prepareStoryAssets } from '../lib/storyAssetPreparation.ts';
import { createStoryImageRequestPreparer } from '../lib/storyImageRequest.ts';
import { buildVisualAssetPrompt, parseVisualAssets, understandVisualAssets } from '../lib/pipeline/visualAssets.ts';
import { bindStoryboardReferences, currentVisualIdentity, requireReferenceCapacity, visualAssetSourceKey } from '../lib/storyVisualAssets.ts';
import { buildGridPrompt, GridPromptCapacityError } from '../lib/gridSplitter.ts';
import { generateStoryboardImage } from '../lib/imageGenerator.ts';
import { visibleImageCast } from '../lib/series/imageCastContract.ts';
import { storyCastKey } from '../lib/pipeline/storyCastAdaptation.ts';

const cast = [{ id:'queen', name:'沈贵妃', aliases:['贵妃'], description:'Selected adult woman', imageUrl:'https://example.com/queen.png' }];
const objects = [{ id:'packet', name:'金色面膜', description:'外包装', imageUrl:'https://example.com/packet.png' }, { id:'sheet', name:'面膜质感', description:'膜体', imageUrl:'https://example.com/sheet.png' }];
const shot = { id:'s1', sceneNumber:1, status:'pending', characters:['贵妃'], objects:['金色面膜','面膜质感'], prompt:'[贵妃](old red costume) lifts [面膜质感](gray mesh) out of [金色面膜](packet).', description:'贵妃拿出膜片' };
const identities = entries => Object.fromEntries(entries.map(a => [a.id, { version:1, sourceKey:a.sourceKey, kind:a.kind === 'character' ? 'character' : a.id.endsWith('packet') ? 'packaging' : 'product', appearance:a.kind === 'character' ? 'Distinct face, pale green silk robe.' : a.id.endsWith('packet') ? 'Sealed GOLD_FOIL_PACKET with heat-sealed edges.' : 'BLACK_GRAY_MESH translucent soft face sheet, eye and mouth cutouts.', scale:'face-sized sheet / hand-sized packet', states:'Sheet folds and fits; packet contains the sheet.' }]));

test('original understanding sends selected costume and product photos once; cache invalidates only changed sources', async () => {
  let calls = 0, submitted;
  const prepareImages = createStoryImageRequestPreparer(async () => { throw new Error('Unexpected upload'); });
  const request = async body => { calls++; submitted=JSON.parse(body); return Response.json({ identities:identities(submitted.assets) }); };
  const base = { characters:cast, objects, costumeImages:{沈贵妃:'https://example.com/costume.png'}, apiKey:'test-only', prepareImages, request };
  const first = await prepareStoryAssets(base);
  assert.equal(calls,1);
  assert.deepEqual(submitted.assets.map(a=>a.imageUrl), ['https://example.com/costume.png',objects[0].imageUrl,objects[1].imageUrl]);
  assert.equal(first.characters[0].imageUrl,cast[0].imageUrl,'do not replace the original with a costume or generated image');
  await prepareStoryAssets({...base,...first});
  assert.equal(calls,1);
  const modified = {...first,objects:first.objects.map(o=>o.id==='sheet'?{...o,imageUrl:'https://example.com/new-sheet.png'}:o)};
  await prepareStoryAssets({...base,...modified});
  assert.equal(calls,2);
  assert.deepEqual(submitted.assets.map(a=>a.id),['object:sheet']);
  assert.ok(currentVisualIdentity(first.objects[0]));
  assert.equal(currentVisualIdentity({...first.objects[0],description:'New physical specification'}),undefined);
  assert.equal(visualAssetSourceKey({ ...objects[0], imageUrl:'blob:before-reload', imageBase64:'data:image/png;base64,test' }), visualAssetSourceKey({ ...objects[0], imageUrl:'data:image/png;base64,test' }), 'blob recreation must not invalidate identical original bytes');
});

test('vision call actually carries original images and is not a per-shot QC/retry loop', async () => {
  const old = axios.post; let calls = 0, body;
  const assets = objects.map(o=>({...o,kind:'object',sourceKey:visualAssetSourceKey(o)}));
  axios.post = async (_url,input) => { calls++; body=input; return {data:{choices:[{message:{content:JSON.stringify({assets:assets.map(a=>({id:a.id,kind:'product',appearance:'Gray gauze, not the gold packaging.',scale:'',states:'Flexible sheet.'}))})}}]}}; };
  try {
    const result=await understandVisualAssets(assets,{apiKey:'test',scriptProvider:'apimart',scriptModel:'gpt-4o'});
    assert.equal(calls,1);
    assert.deepEqual(body.messages[0].content.filter(c=>c.type==='image_url').map(c=>c.image_url.url),objects.map(o=>o.imageUrl));
    assert.equal(result.sheet.sourceKey,assets[1].sourceKey);
    assert.match(buildVisualAssetPrompt(assets),/Input names are user labels, not evidence for color or material/);
    assert.throws(()=>parseVisualAssets('{"assets":[]}',assets),/缺少/);
  } finally { axios.post=old; }
});

test('old aliases, silent identity tags and stable IDs resolve to one original reference each', () => {
  assert.deepEqual(visibleImageCast(shot,cast).map(c=>c.id),['queen']);
  assert.equal(visibleImageCast({...shot,characters:[]},cast).length,1);
  const bound=bindStoryboardReferences(shot,cast,objects);
  assert.deepEqual(bound.characters,['沈贵妃']);
  assert.deepEqual(bound.referenceBindings,{characterIds:['queen'],objectIds:['packet','sheet'],characterNames:['沈贵妃'],objectNames:['金色面膜','面膜质感']});
  const renamed=cast.map(c=>({...c,name:'皇后萧明仪',aliases:[]}));
  assert.deepEqual(visibleImageCast(bound,renamed).map(c=>c.id),['queen']);
  assert.equal(visibleImageCast({...bound,characters:[],prompt:''},cast).length,0,'a manual removal invalidates old bindings');
  assert.equal(visibleImageCast({...shot,prompt:''},[...cast,{...cast[0],id:'other',name:'其他贵妃'}]).length,0,'ambiguous aliases must not choose an arbitrary actor');
});

test('grounded appearance does not invalidate casting decisions or rewrite saved screenplay stages', () => {
  assert.equal(storyCastKey(cast),storyCastKey(cast.map(c=>({...c,visualDescription:'Pale green silk robe.'}))));
});

test('paid grid recovery bypasses new prompt/reference budgets and cannot fall back to another paid image', async () => {
  const page = await readFile(new URL('../app/story/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /if \(!options.resumeTaskId\) requireReferenceCapacity/);
  assert.match(page, /rawGridPrompt = options.resumeTaskId \? '' : buildGridPrompt/);
  assert.match(page, /if \(!options.resumeTaskId && \(error instanceof GridPromptCapacityError/);
  assert.match(page, /filter\(name => !characterIdentityIndex\(groupCharacters\).resolve\(name\)\)/);
});

test('project save/export keeps original-understanding cache and prop aliases across reload', async () => {
  const source = await readFile(new URL('../hooks/useProject.ts', import.meta.url), 'utf8');
  assert.match(source, /visualIdentity: char.visualIdentity/);
  assert.match(source, /visualIdentity: obj.visualIdentity/);
  assert.match(source, /aliases: obj.aliases/);
});

test('complete four-panel actions, material and wardrobe reach the final provider payload', async () => {
  const labels=['OBJECT IDENTITY: packet [ID packet] — GOLD_FOIL_PACKET, sealed laminate, hand-sized.', 'OBJECT IDENTITY: sheet [ID sheet] — BLACK_GRAY_MESH, translucent, flexible, facial cutouts.', 'CHARACTER IDENTITY: 沈贵妃 [ID queen] — PALE_GREEN_SILK_ROBE; same identity alias 贵妃.'];
  const panels=Array.from({length:4},(_,i)=>`Shot ${i+1}: ${'She steadily lifts her hands. '.repeat(10)} END_ACTION_${i+1}: unfold the gray mesh and hold it beside the face without changing its size. Only 沈贵妃 appears in this frame, one instance of each.`);
  const prompt=buildGridPrompt('hall','PALE_GREEN_SILK_ROBE',panels,'9:16',labels,[1,2,3,4],'cinematic-natural',undefined,'gpt-image-2');
  const old=axios.post; let calls=0,submitted;
  axios.post=async(_url,body)=>{calls++;submitted=body;return{data:{data:[{task_id:'test-grid-only'}]}}};
  try {
    const references=['https://example.com/packet.png','https://example.com/sheet.png','https://example.com/queen.png'];
    await generateStoryboardImage({...shot,prompt},cast,'test',[], '9:16','gpt-image-2',{},undefined,references,labels,'cinematic-natural');
    assert.equal(calls,1);
    assert.deepEqual(submitted.image_urls,references);
    for(const label of labels)assert.ok(submitted.prompt.includes(label));
    for(let i=1;i<=4;i++)assert.ok(submitted.prompt.includes(`END_ACTION_${i}`));
    assert.match(submitted.prompt,/exactly two columns and two rows/);
    assert.match(submitted.prompt,/Packaging is not its contents/);
    assert.throws(()=>buildGridPrompt('hall','',Array(4).fill('must preserve this action '.repeat(300)),'9:16'),GridPromptCapacityError);
  } finally {axios.post=old;}
});

test('reference capacity cannot silently remove actors/environment for a style image', async () => {
  assert.throws(()=>requireReferenceCapacity(16,16,1),/未丢弃参考图/);
  const old=axios.post; let calls=0;
  axios.post=async()=>{calls++;throw new Error('No paid request allowed');};
  try {
    const prompt=buildGridPrompt('hall','',Array(4).fill('An empty hall.'),'9:16');
    await assert.rejects(generateStoryboardImage({...shot,prompt},cast,'test',[], '9:16','gpt-image-2',{},undefined,Array.from({length:16},(_,i)=>`https://example.com/${i}.png`),[],'cinematic-natural',undefined,{},'',{}, {imageUrl:'https://example.com/style.png'}),/未丢弃参考图/);
    assert.equal(calls,0);
  } finally {axios.post=old;}
});

test('Story wires grounding before writing/new generation but skips it for retained paid tasks', async () => {
  const source=await readFile(new URL('../app/story/page.tsx',import.meta.url),'utf8');
  assert.match(source,/if \(!options.resumeTaskId\) await ensureStoryVisualAssets\(\)/);
  assert.match(source,/if \(!taskId\) \{\s+await ensureStoryVisualAssets\(\)/);
  assert.doesNotMatch(source,/objectReferences, \.\.\.characterReferences, \.\.\.sceneReference\]\.slice/);
  const middleware=await readFile(new URL('../middleware.ts',import.meta.url),'utf8');
  assert.ok(middleware.includes("'/api/prepare-story-assets'"));
});

test('Story and Series keep product originals in image generation and never send them to H3', async () => {
  const story=await readFile(new URL('../app/story/page.tsx',import.meta.url),'utf8');
  const videoRoute=await readFile(new URL('../app/api/generate-video/route.ts',import.meta.url),'utf8');
  assert.match(story,/const objectReferences = groupObjects/,'GPT-Image-2 still receives the selected object references');
  assert.doesNotMatch(story,/objectReferences:\s*portableObjectReferences/);
  assert.doesNotMatch(story,/道具原图`, true/);
  assert.doesNotMatch(videoRoute,/objectReferences\s*=\s*\[\]/);
  assert.doesNotMatch(videoRoute,/identityImages:/);
  assert.match(videoRoute,/firstFrame,\s+auxiliaryImages,/,'H3 receives only integrated storyboard or explicit continuity frames');
});
