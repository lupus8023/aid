import test from 'node:test';
import assert from 'node:assert/strict';
import { directorFieldRepairs, buildDirectorFieldRepairPrompt, applyDirectorFieldRepairProgress, applyDirectorFieldRepairs, selectDirectorFieldRepairChunk } from '../lib/pipeline/directorRepair.ts';
import { validateDirectorShots } from '../lib/pipeline/storyDirector.ts';
import { recoverGeneration } from '../lib/pipeline/generationDraft.ts';

const originalDirection = {
 action: 'Luna folds the note and tucks it low while turning back toward Inkfin; Tilda and Silt hold at the doorway.',
 camera: 'Stay in a medium corridor-side view and let the composition open toward the exit as Luna shifts her weight away from the table, keeping the threshold and the people behind her visible.',
 detail: 'The shark seal remains briefly exposed at her fingers.',
 ending: 'Luna remains half-turned in the corridor with the note secured low, Tilda and Silt paused behind her, and Inkfin still framed by hanging scrolls inside.',
};
const direction = {...originalDirection,action:'Luna holds the note. '.repeat(14).trim(),detail:'The seal stays visible. '.repeat(5).trim()};
const beats=[16,17,18].map(index=>({index,characters:['Luna','Inkfin','Tilda','Silt'],objects:[],action:'Luna secures the note and faces the exit.',speech:[{character:'Luna',exactLine:'We leave at dawn.'}]}));
const valid={...direction,camera:'A fixed medium view holds the doorway.',ending:'Luna remains half-turned toward Inkfin.'};
const shots=beats.map((b,i)=>({index:b.index,description:'Luna holds the folded note.',prompt:'A medium view of the doorway.',characterCostume:{Luna:'blue coat'},videoDirection:structuredClone(i===2?direction:valid)}));
const reply={repairs:[
 {path:'shots[2].videoDirection.camera',value:'Hold a medium corridor view; open the frame toward the exit as Luna shifts away, retaining the doorway and group.'},
 {path:'shots[2].videoDirection.ending',value:'Half-turned Luna holds the note low; Tilda and Silt wait behind her, with Inkfin framed by scrolls.'},
]};

test('repairs an over-budget draft without rewriting the batch',()=>{
 assert.equal(direction.camera.length,184);assert.equal(direction.ending.length,152);
 const issues=directorFieldRepairs(shots,beats);
 assert.deepEqual(issues.map(i=>[i.shotNumber,i.path,i.limit]),[[18,'shots[2].videoDirection.camera',180],[18,'shots[2].videoDirection.ending',140]]);
 assert.match(buildDirectorFieldRepairPrompt(shots,beats,issues),/zero-based batch positions/);
 const repaired=applyDirectorFieldRepairs(shots,reply,issues);
 assert.deepEqual(repaired.slice(0,2),shots.slice(0,2));assert.equal(repaired[2].videoDirection.action,direction.action);assert.equal(repaired[2].videoDirection.detail,direction.detail);
 assert.equal(repaired[2].prompt,shots[2].prompt);assert.deepEqual(repaired[2].characterCostume,shots[2].characterCostume);
 assert.equal(shots[2].videoDirection.camera.length,184);
 assert.doesNotThrow(()=>validateDirectorShots(repaired,beats,'array','en',beats[0].characters,true));
 assert.deepEqual(directorFieldRepairs(repaired,beats),[]);
});

test('the original shot-18 184/152-character fields need no repair when the whole brief fits',()=>{
 assert.deepEqual(directorFieldRepairs([{videoDirection:originalDirection}],beats.slice(0,1)),[]);
 assert.doesNotThrow(()=>validateDirectorShots([{description:'Luna folds the note.',prompt:'Luna at the doorway.',videoDirection:originalDirection}],beats.slice(0,1),'array','en',beats[0].characters,true));
});

test('rejects wrong episode-vs-batch paths, duplicate patches, overflow and clipped prefixes',()=>{
 const issues=directorFieldRepairs(shots,beats);
 for(const first of [
  {...reply.repairs[0],path:'shots[18].videoDirection.camera'},
  {...reply.repairs[0],path:reply.repairs[1].path},
  {...reply.repairs[0],value:direction.camera},
  {...reply.repairs[0],value:direction.camera.slice(0,100)+'.'},
 ])assert.throws(()=>applyDirectorFieldRepairs(shots,{repairs:[first,reply.repairs[1]]},issues));
 assert.throws(()=>applyDirectorFieldRepairs(shots,{repairs:[...reply.repairs,{path:'shots[0].prompt',value:'Rewrite all.'}]},issues));
});

test('collects English and Chinese voice contamination independently of neighboring length errors',()=>{
 const invalid=structuredClone(shots);invalid[0].videoDirection.action='Luna whispers as she folds the note.';invalid[1].videoDirection.ending='Luna 开口说道台词。';
 const issues=directorFieldRepairs(invalid,beats);
 assert.deepEqual(issues.map(i=>i.path),['shots[0].videoDirection.action','shots[1].videoDirection.ending','shots[2].videoDirection.camera','shots[2].videoDirection.ending']);
 const total=structuredClone(shots.slice(0,1));total[0].videoDirection={action:'x'.repeat(300),camera:'x'.repeat(180),detail:'x'.repeat(140),ending:'x'.repeat(140)};
 const budget=directorFieldRepairs(total,beats.slice(0,1));assert.equal(budget.length,4);assert.ok(budget.reduce((sum,i)=>sum+i.limit,0)<=720);
});

test('repairs Chinese speech contamination in small checkpointed chunks',()=>{
 const invalid=Array.from({length:6},(_,index)=>({videoDirection:{...valid,action:`角色${index + 1}开口说道台词。`}}));
 const sixBeats=Array.from({length:6},(_,index)=>({...beats[0],index:index + 1}));
 const issues=directorFieldRepairs(invalid,sixBeats);
 assert.equal(issues.length,6);
 assert.deepEqual(selectDirectorFieldRepairChunk(issues).map(issue=>issue.path),issues.slice(0,6).map(issue=>issue.path));
 const prompt=buildDirectorFieldRepairPrompt(invalid,sixBeats,issues.slice(0,1),undefined,'zh');
 assert.match(prompt,/complete concise English sentence/i);
 assert.match(prompt,/registeredEntityNames/);
 assert.match(prompt,/quoted Chinese words/);
 assert.match(buildDirectorFieldRepairPrompt(invalid,sixBeats,issues.slice(0,1),new Error('不得截取原句前半段'),'zh'),/rewrite the sentence with different wording/i);
});

test('six contaminated action fields recover in one bounded patch without regenerating valid storyboard data',async()=>{
 const sixBeats=Array.from({length:6},(_,index)=>({...beats[0],index:index + 1}));
 const invalid=Array.from({length:6},(_,index)=>({
  index:index + 1,description:'Luna turns away from the table.',prompt:'Luna beside a table near the doorway.',marker:`keep-${index}`,
  videoDirection:{...valid,action:`角色${index + 1}开口说道台词。`},
 }));
 let raw=JSON.stringify(invalid),calls=0,saves=0;
 const draft={read:async()=>raw,save:async value=>{raw=value;saves++;}};
 const parse=value=>{const parsed=JSON.parse(value);validateDirectorShots(parsed,sixBeats,'array','en',sixBeats[0].characters,true);return parsed;};
 const repaired=await recoverGeneration({draft,parse,attempts:8,generate:async previous=>{
  calls++;
  const retained=JSON.parse(previous);
  const issues=selectDirectorFieldRepairChunk(directorFieldRepairs(retained,sixBeats));
  return JSON.stringify(applyDirectorFieldRepairs(retained,{repairs:issues.map(issue=>({
   path:issue.path,value:`Character ${issue.index + 1} turns from the table and walks toward the doorway.`,
  }))},issues,true));
 }});
 assert.equal(calls,1);assert.equal(saves,1);
 assert.deepEqual(repaired.map(shot=>shot.marker),invalid.map(shot=>shot.marker));
 assert.ok(repaired.every(shot=>/walks toward the doorway\.$/u.test(shot.videoDirection.action)));
});

test('checkpoints valid repairs when a provider omits or corrupts sibling entries',()=>{
 const invalid=structuredClone(shots);invalid[0].videoDirection.action='角色开口说道台词。';invalid[1].videoDirection.action='另一角色大喊对白。';
 const issues=directorFieldRepairs(invalid,beats);
 const progress=applyDirectorFieldRepairProgress(invalid,{repairs:[
  {path:issues[0].path,value:'Luna turns away from the table and walks toward the doorway.'},
  {path:issues[1].path,value:'still invalid without punctuation'},
 ]},issues,beats);
 assert.deepEqual(progress.applied,[issues[0].path]);
 assert.equal(progress.shots[0].videoDirection.action,'Luna turns away from the table and walks toward the doorway.');
 assert.equal(progress.shots[1].videoDirection.action,invalid[1].videoDirection.action);
 assert.ok(progress.rejected.includes(issues[1].path));
});

test('rejects repaired prose that still contains Chinese outside registered entity names',()=>{
 const localBeats=[{...beats[0],characters:['萧贵妃'],objects:['铜镜']}];
 const invalid=[{videoDirection:{...valid,action:'萧贵妃把“体面”放到铜镜旁。'}}];
 const issues=directorFieldRepairs(invalid,localBeats);
 const rejected=applyDirectorFieldRepairProgress(invalid,{repairs:[{
  path:issues[0].path,value:'萧贵妃 places “体面” beside 铜镜.',
 }]},issues,localBeats);
 assert.deepEqual(rejected.applied,[]);
 assert.deepEqual(rejected.rejected,[issues[0].path]);
 const accepted=applyDirectorFieldRepairProgress(invalid,{repairs:[{
  path:issues[0].path,value:'萧贵妃 places a folded note beside 铜镜 and withdraws her hand.',
 }]},issues,localBeats);
 assert.deepEqual(accepted.applied,[issues[0].path]);
 assert.equal(accepted.shots[0].videoDirection.action,'萧贵妃 places a folded note beside 铜镜 and withdraws her hand.');
});

test('one overflowing field does not force rewriting valid camera geometry when its repair frees enough budget',()=>{
 const original={action:'a'.repeat(260),camera:'c'.repeat(160),detail:'d'.repeat(195),ending:'e'.repeat(120)};
 const issues=directorFieldRepairs([{videoDirection:original}],beats.slice(0,1));
 assert.deepEqual(issues.map(i=>[i.field,i.limit]),[['detail',140]]);
});

test('field repair permits a complete clause while keeping all unaffected fields verbatim',()=>{
 const d={action:'a'.repeat(300),camera:'c'.repeat(180),detail:'d'.repeat(140),ending:'The ledger lies flat, with the torn opening exposed in the same place beside the index finger and the other people still remaining in their prior positions.'};
 const input=[{videoDirection:d}];const issues=directorFieldRepairs(input,beats.slice(0,1));
 assert.deepEqual(issues.map(i=>i.field),['ending']);
 const repaired=applyDirectorFieldRepairs(input,{repairs:[{path:issues[0].path,value:'The ledger lies flat.'}]},issues);
 assert.equal(repaired[0].videoDirection.ending,'The ledger lies flat.');
 assert.equal(repaired[0].videoDirection.camera,d.camera);
});

test('retained invalid batch recovers with a field patch, survives transport failure and reuses the saved result',async()=>{
 let raw=JSON.stringify(shots),calls=0,saves=0;
 const draft={read:async()=>raw,save:async value=>{raw=value;saves++;}};
 const parse=raw=>{const data=JSON.parse(raw);validateDirectorShots(data,beats,'array','en',beats[0].characters,true);return data;};
 const repaired=await recoverGeneration({draft,parse,attempts:3,generate:async previous=>{
  calls++;assert.equal(previous,JSON.stringify(shots));if(calls===1)throw Error('transport unavailable');
  const retained=JSON.parse(previous);return JSON.stringify(applyDirectorFieldRepairs(retained,reply,directorFieldRepairs(retained,beats)));
 }});
 assert.equal(calls,2);assert.equal(saves,1);assert.deepEqual(repaired.slice(0,2),shots.slice(0,2));
 assert.deepEqual(await recoverGeneration({draft,parse,attempts:1,generate:async()=>assert.fail('must reuse')}),repaired);
});
