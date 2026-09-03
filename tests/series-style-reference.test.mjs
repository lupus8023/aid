import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import {normalizeImageStyleReference, withImageStyleReference} from '../lib/imageStyleReference.ts';
import {setSeriesStyleReference} from '../lib/series/styleReference.ts';
import {createProviderImageTask} from '../lib/imageTaskProvider.ts';
import {generateStoryboardImage} from '../lib/imageGenerator.ts';
import {applySeriesVideoStyle, buildVideoSegmentPrompt} from '../lib/videoGenerator.ts';
import {buildEpisodeProject} from '../lib/series/domain.ts';

const style={imageUrl:'https://example.com/series-look.png',description:'Warm highlights, blue-green ambient fill, restrained contrast.'};

test('style change archives paid tasks and media, preserving scripts, voices and historical deliveries',()=>{
  const project={characters:[{id:'c1',imageUrl:'identity.png',bibleUrl:'old.png',locked:true,version:1,appearance:'on_screen',voiceId:'voice',voiceReferenceUrl:'voice.mp3',photographicAnchor:{imageTaskId:'paid-original',imageUrl:'anchor.png'}}],locations:[{id:'l1',imageUrl:'old-scene.png',imageTaskId:'paid-location'}],episodes:[{id:'ep-1',version:1,script:[{number:1}],production:{id:'old-production'},deliveries:[{id:'old-film'}]}]};
  const before=structuredClone(project);
  assert.equal(setSeriesStyleReference(project,style),true);
  assert.deepEqual(project.visualHistory[0].characters,before.characters);
  assert.equal(project.visualHistory[0].productions[0].production.id,'old-production');
  assert.equal(project.characters[0].imageUrl,'identity.png');
  assert.equal(project.characters[0].voiceId,'voice');
  assert.equal(project.characters[0].bibleUrl,undefined);
  assert.equal(project.characters[0].photographicAnchor,undefined);
  assert.equal(project.locations[0].imageTaskId,undefined);
  assert.deepEqual(project.episodes[0].script,before.episodes[0].script);
  assert.deepEqual(project.episodes[0].deliveries,before.episodes[0].deliveries);
  assert.equal(project.episodes[0].production,undefined);
  assert.equal(project.episodes[0].version,2);
  assert.equal(setSeriesStyleReference(project,style),false);
  assert.equal(project.visualHistory.length,1);
  assert.equal(setSeriesStyleReference(project,null),true);
  assert.equal(project.styleReference,undefined);
});

test('style references cannot be inline scripts, credentialed URLs or silently dropped at capacity',()=>{
  for(const imageUrl of ['javascript:alert(1)','file:///tmp/picture.png','https://user:pass@example.com/a.png']) assert.throws(()=>normalizeImageStyleReference({imageUrl}));
  assert.throws(()=>withImageStyleReference('goal',['identity'],style,1),/保留一个名额/);
  const result=withImageStyleReference('goal',['identity'],style,2);
  assert.deepEqual(result.images,['identity',style.imageUrl]);
  assert.match(result.prompt,/Reference image 2 is STYLE ONLY/);
  assert.match(result.prompt,/cultural\/art-direction atmosphere/);
  assert.match(result.prompt,/Do not copy.*person/);
  assert.match(result.prompt,/authored shot size, camera movement, time of day/);
});

test('final GPT card, scene, shot and grid requests carry one distinct style input without recasting',async()=>{
  const original=axios.post;const sent=[];
  axios.post=async(url,body)=>{sent.push({url,body});return {data:{data:[{task_id:'style-test'}]}};};
  try {
    for(const images of [[],['https://example.com/identity.png']]) await createProviderImageTask('A wardrobe or location photograph.',images,'test','gpt-image-2','9:16',undefined,{}, {styleReference:style});
    const cast=[{name:'Aster',description:'An adult navigator with black curls.',imageUrl:'https://example.com/identity.png'}];
    for(const grid of [false,true]) await generateStoryboardImage({id:'s1',sceneNumber:1,characters:['Aster'],prompt:grid?'UNIQUE STORYBOARD BATCH: 1\nGRID STYLE BIBLE (authoritative): same cast\nPanel 1: Aster reads.':'Aster reads.'},cast,'test',[],'9:16','gpt-image-2',{},undefined,grid?[cast[0].imageUrl]:undefined,grid?['Aster IDENTITY ONLY']:[], 'cinematic-natural',undefined,{},'',{},style);
    for(const {body} of sent){assert.equal(body.model,'gpt-image-2');assert.equal(body.image_urls.at(-1),style.imageUrl);assert.match(body.prompt,new RegExp(`Reference image ${body.image_urls.length} is STYLE ONLY`));}
    assert.deepEqual(sent[2].body.image_urls,[cast[0].imageUrl,style.imageUrl]);
    assert.match(sent[2].body.prompt,/NAMED CAST \(1\): Aster/);
    assert.match(sent[2].body.prompt,/Do not inherit its artistic medium or rendering method/);
  }finally{axios.post=original;}
});

test('MJ series style uses sref without consuming a content reference slot',async()=>{
  const original=axios.post;let sent;
  axios.post=async(_url,body)=>{sent=body;return {data:{task_id:'mj-style-test'}};};
  try{
    const images=['a','b','c','d'].map(id=>`https://example.com/${id}.png`);
    await createProviderImageTask('Four distinct adults.',images,'test','midjourney','1:1',undefined,{}, {midjourneyTaskMode:'story-shot',styleReference:style});
    assert.deepEqual(sent.image_urls,images);assert.equal(sent.sref,style.imageUrl);
  }finally{axios.post=original;}
});

test('episode production snapshot retains its series style',()=>{
  const p={id:'series',name:'Test',styleReference:style,characters:[],objects:[],locations:[],language:'en',aspectRatio:'9:16',visualStyle:'cinematic-natural'};
  const e={id:'ep-1',number:1,version:2,title:'First',script:[],characterIds:[],locationIds:[]};
  assert.deepEqual(buildEpisodeProject(p,e).styleReference,style);
});

test('video style is stable across retries and preserves dialogue and final-only quiet ending',()=>{
  const board={id:'s18',sceneNumber:18,characters:['Aster'],prompt:'Aster lowers a letter.',description:'Aster lowers a letter.',durationHint:6,speech:[{character:'Aster',exactLine:'We are home.'}]};
  const prompt=buildVideoSegmentPrompt([board],[],{styleReference:style,duration:6,isFilmEnding:true});
  assert.match(prompt,/Use the approved series look:/);
  assert.match(prompt,/Warm highlights, blue-green ambient fill/);
  assert.match(prompt,/<d>\[English] We are home\.<\/d>|<d>\[Chinese] We are home\.<\/d>/);
  assert.match(prompt,/only the final shot's 00:05\.000–00:06\.000/);
  const twice=applySeriesVideoStyle(prompt,style);
  assert.equal((twice.match(/Use the approved series look:/g)||[]).length,1);
  assert.ok(twice.length<=7000);
});
