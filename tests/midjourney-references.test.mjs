import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import {buildMidjourneyImaginePayload, midjourneyEditPayload} from '../lib/midjourney.ts';
import {createProviderImageTask} from '../lib/imageTaskProvider.ts';
import {generateStoryboardImage} from '../lib/imageGenerator.ts';

const actor = 'https://example.com/Luna.png';
const style = 'https://example.com/approved-style.png';
const base = {prompt: 'Luna reads a letter beside an archive window.', aspectRatio: '9:16', taskMode: 'story-shot'};

test('V6.1 binds identity with cref and style with sref, without an unsupported HD flag', () => {
  const body = buildMidjourneyImaginePayload({...base, references: {version: '6.1', characterReferenceUrl: actor, characterWeight: 0, styleReferenceUrl: style, styleWeight: 0}});
  assert.equal(body.cref, actor); assert.equal(body.cw, 0);
  assert.equal(body.sref, style); assert.equal(body.sw, 0);
  assert.equal(body.hd, undefined); assert.equal(body.image_urls, undefined);
});

test('V7 uses one Omni identity and retains both style and personalization', () => {
  const body = buildMidjourneyImaginePayload({...base, personalizationProfile: 'sample', references: {version: '7', characterReferenceUrl: actor, omniWeight: 150, styleReferenceUrl: style}});
  assert.equal(body.extra, `--profile sample --oref ${actor} --ow 150`);
  assert.equal(body.sref, style); assert.equal(body.sw, 100);
  assert.equal(body.cref, undefined); assert.equal(body.hd, undefined);
});

test('V8.2 edits retain four content references plus independent sref through final HTTP submission', async () => {
  const cast = ['Luna','Victoria','Silt','Rill'].map((name, i) => ({id: `c${i}`, name, description: `${name} has unique hair and clothing.`, imageUrl: `https://example.com/${name}.png`}));
  const board = {id:'shot1',sceneNumber:1,characters:cast.map(c=>c.name),objects:[],prompt:'The four actors gather around the table.',action:'Luna unfolds a letter.'};
  const originalPost = axios.post;
  let sent;
  axios.post = async (url, body) => {sent={url,body};return {data:{data:[{task_id:'paid-reference-test'}]}};};
  try {
    const task = await generateStoryboardImage(board,cast,'test',[],'9:16','midjourney',{},undefined,undefined,[],'cinematic-natural',undefined,{},'',{styleReferenceUrl:style,styleWeight:80});
    assert.equal(task,'midjourney:paid-reference-test');
    assert.match(sent.url,/\/generations\/edits$/);
    assert.deepEqual(Object.keys(sent.body).sort(), ['image_urls','prompt','raw','size','sref','sw','version']);
    assert.deepEqual(sent.body.image_urls,cast.map(c=>c.imageUrl));
    assert.equal(sent.body.sref,style); assert.equal(sent.body.sw,80); assert.equal(sent.body.raw,true);
    assert.doesNotMatch(sent.body.prompt,/approved-style\.png|high-budget live-action feature/);
    assert.match(sent.body.prompt,/Exactly 4 distinct characters/);
    for (const c of cast) assert.match(sent.body.prompt,new RegExp(`Character ${c.name}`));
  } finally {axios.post=originalPost;}
});

test('style-only and V6/V7 identity requests stay on Imagine; character cards use V8.2 edits', async () => {
  const originalPost = axios.post;
  const submitted=[];
  axios.post=async (url,body)=>{submitted.push({url,body});return {data:{task_id:'test-task'}};};
  try {
    await createProviderImageTask(base.prompt,[style],'test','midjourney','9:16',undefined,{}, {midjourneyReferenceMode:'style',midjourneyTaskMode:'story-shot'});
    for(const version of ['6.1','7']) await createProviderImageTask(base.prompt,[],'test','midjourney','9:16',undefined,{}, {midjourneyTaskMode:'story-shot',midjourneyReferences:{version,characterReferenceUrl:actor,styleReferenceUrl:style}});
    await createProviderImageTask(base.prompt,[actor],'test','midjourney','9:16',undefined,{}, {midjourneyReferenceMode:'character',midjourneyTaskMode:'character-sheet'});
    for (const s of submitted.slice(0,3)) assert.match(s.url,/\/midjourney\/generations$/);
    assert.equal(submitted[0].body.sref,style);assert.equal(submitted[0].body.image_urls,undefined);
    assert.deepEqual(Object.keys(submitted[0].body).sort(), ['prompt','raw','size','sref','sw','version']);
    assert.match(submitted[3].url,/\/generations\/edits$/);
  } finally {axios.post=originalPost;}
});

test('invalid reference contracts fail before buying a task, never discard an actor', () => {
  for(const references of [{version:'8.1'}, {styleReferenceUrl:style,styleWeight:1001}, {styleReferenceUrl:style,styleWeight:NaN}, {version:'6.1',characterReferenceUrl:actor,characterWeight:-1}, {version:'7',characterReferenceUrl:actor,omniWeight:0}, {version:'8.2',characterReferenceUrl:actor,characterWeight:100}, {version:'6.1',characterReferenceUrl:actor,omniWeight:100}, {characterReferenceUrl:actor+' --no coat'}]) {
    assert.throws(()=>buildMidjourneyImaginePayload({...base,references}));
  }
  assert.throws(()=>buildMidjourneyImaginePayload({...base,imageUrls:[actor,style],referenceMode:'character',references:{version:'6.1'}}),/单独指定/);
  assert.throws(()=>buildMidjourneyImaginePayload({...base,imageUrls:['a','b','c','d','e']}),/不能静默/);
  assert.throws(()=>buildMidjourneyImaginePayload({...base,imageUrls:['a','b','c','d'],references:{characterReferenceUrl:actor}}),/最多4/);
});

test('style URLs never consume content slots or become identity images, including legacy style mode', () => {
  const body=buildMidjourneyImaginePayload({...base,imageUrls:[style],referenceMode:'style',references:{characterReferenceUrl:actor}});
  assert.deepEqual(body.image_urls,[actor]);assert.equal(body.sref,style);
  const edited=midjourneyEditPayload(body);
  assert.equal(edited.sref,style);assert.equal(edited.sw,100);
  assert.deepEqual(edited.image_urls,[actor]);
});
