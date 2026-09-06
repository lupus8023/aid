import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { directStoryboard } from '../lib/pipeline/storyDirector.ts';

const names=['沈贵妃','裴大人','宫女'];
const input={
 storyPlan:{title:'Field recovery',sequences:[{id:'chamber',beats:[8,9,10,11,12].map(index=>({
  index,sequenceId:'chamber',characters:['沈贵妃'],objects:[],speech:[{character:'沈贵妃',exactLine:'原句不可改。'}],
  action:'沈贵妃收回手，宫女在旁托住袋子。',durationHint:4,transition:'cut',
 }))}]},
 characters:names.map(name=>({name,description:'Registered adult character.'})),objects:[],
 apiKey:'',dmxApiKey:'fixture-only',scriptProvider:'dmx',scriptModel:'gpt-4o',aspectRatio:'9:16',language:'zh',
};
const approved=Array.from({length:5},(_,i)=>({
 index:i+8,description:'贵妃收回手，宫女在旁托着袋子。',prompt:'[沈贵妃](red robe) and [宫女](green robe) beside a couch.',
 characterCostume:{沈贵妃:'红衣'},videoDirection:{
  action:'[沈贵妃]收回手，[宫女]在旁托住袋子。',
  camera:'镜头保持卧榻正面的中景。',detail:'她的衣袖垂在卧榻旁。',ending:'她的手停在卧榻扶手上。',
 },
}));

async function isolatedDirector(run) {
 const root=await mkdtemp(path.join(tmpdir(),'aid-director-recovery-'));
 const oldRoot=process.env.AID_COMPANION_DATA_DIR,post=axios.post,timer=globalThis.setTimeout;
 process.env.AID_COMPANION_DATA_DIR=root;
 globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms>=1500&&ms<=10000?0:ms,...args);
 try { await run(root); }
 finally {
  axios.post=post;globalThis.setTimeout=timer;
  if(oldRoot===undefined)delete process.env.AID_COMPANION_DATA_DIR;else process.env.AID_COMPANION_DATA_DIR=oldRoot;
  await rm(root,{recursive:true,force:true});
 }
}

const response=content=>({status:200,headers:{'content-type':'application/json'},data:{choices:[{message:{content:JSON.stringify(content)},finish_reason:'stop'}]}});

test('director adapts a stalled batch to single-field repair, keeps screenplay and reuses the saved result',async()=>{
 await isolatedDirector(async root=>{
  const invalid=structuredClone(approved);
  invalid[0].videoDirection.action='沈贵妃开口说出原句。';
  invalid[2].videoDirection.action='宫女大喊对白。';
  const before=structuredClone(input);
  const prompts=[];
  axios.post=async(url,body)=>{
   assert.match(url,/dmxapi\.cn\/v1\/chat\/completions$/);
   const prompt=body.messages[0].content;prompts.push(prompt);
   if(prompts.length===1)return response(invalid);
   if(prompts.length===2){
    assert.match(prompt,/shots\[0\]\.videoDirection.action/);
    assert.match(prompt,/shots\[2\]\.videoDirection.action/);
    return response({repairs:[0,2].map(index=>({path:`shots[${index}].videoDirection.action`,value:'沈贵妃 walks toward the 铜镜.'}))});
   }
   assert.fail('must not regenerate the batch or call a media provider');
  };
  const result=await directStoryboard(input);
  assert.equal(prompts.length,2);
  assert.deepEqual(input,before,'locked screenplay must not be mutated');
  for(let i=0;i<result.length;i++){
   const expectedDirection=structuredClone(approved[i].videoDirection);
   if(i===0||i===2)expectedDirection.action=input.storyPlan.sequences[0].beats[i].action;
   assert.deepEqual(result[i].videoDirection,expectedDirection);
   assert.equal(result[i].prompt,approved[i].prompt);
   assert.equal(result[i].description,approved[i].description);
   assert.deepEqual(result[i].characterCostume,approved[i].characterCostume);
   assert.equal(result[i].action,input.storyPlan.sequences[0].beats[i].action);
   assert.equal(result[i].speech[0].exactLine,'原句不可改。');
   assert.equal(result[i].videoDuration,4);
  }
  const [file]=await readdir(path.join(root,'pipeline-drafts'));
  const retained=JSON.parse(await readFile(path.join(root,'pipeline-drafts',file),'utf8'));
  assert.deepEqual(retained.map(shot=>shot.videoDirection),result.map(shot=>shot.videoDirection),'checkpoint contains all valid fields, not just the latest patch');
  assert.deepEqual(await directStoryboard(input),result);
  assert.equal(prompts.length,2,'a resumed successful draft makes no new model request');
 });
});

test('explicit provider refusal stops adaptive repair without resubmission or loss of the retained batch',async()=>{
 await isolatedDirector(async root=>{
  const invalid=structuredClone(approved);invalid[0].videoDirection.action='沈贵妃开口说出原句。';
  let calls=0;
  axios.post=async()=>{
   calls++;
   if(calls===1)return response(invalid);
   return {status:200,headers:{},data:{choices:[{message:{refusal:'content_filter'},finish_reason:'content_filter'}]}};
  };
  await assert.rejects(directStoryboard(input),/拒绝继续输出/);
  assert.equal(calls,2,'do not spend the eight-retry budget on explicit refusals');
  const [file]=await readdir(path.join(root,'pipeline-drafts'));
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'pipeline-drafts',file),'utf8')),invalid);
 });
});
