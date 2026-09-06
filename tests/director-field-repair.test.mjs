import test from 'node:test';
import assert from 'node:assert/strict';
import { directorFieldRepairs, buildDirectorFieldRepairPrompt, DirectorFieldRepairError, applyDeterministicDirectorFieldRepairFallback, applyDirectorFieldRepairProgress, applyDirectorFieldRepairs, selectDirectorFieldRepairChunk } from '../lib/pipeline/directorRepair.ts';
import { validateDirectorShots } from '../lib/pipeline/storyDirector.ts';
import { recoverGeneration } from '../lib/pipeline/generationDraft.ts';

const sized = (seed, length) => seed.repeat(Math.ceil(length / seed.length)).slice(0, length - 1) + '。';
const originalDirection = {
 action: 'Luna折好纸条并收入袖口，转身看向Inkfin；Tilda与Silt停在门边。',
 camera: sized('镜头保持走廊侧面的中景，跟随Luna向出口移动，门槛与身后众人始终留在画面内。', 184),
 detail: '鲨鱼印章在Luna指间短暂露出。',
 ending: sized('Luna半转身站在走廊中，纸条收在低处，Tilda与Silt停在身后，Inkfin仍在室内卷轴之间。', 152),
};
const direction = {...originalDirection,action:sized('Luna握住纸条并转向出口。',300),detail:sized('鲨鱼印章仍露在Luna指间。',140)};
const beats=[16,17,18].map(index=>({index,characters:['Luna','Inkfin','Tilda','Silt'],objects:[],action:'Luna secures the note and faces the exit.',speech:[{character:'Luna',exactLine:'We leave at dawn.'}]}));
const valid={...direction,camera:'固定中景保持门口构图。',ending:'Luna半转身面向Inkfin。'};
const shots=beats.map((b,i)=>({index:b.index,description:'Luna拿着折好的纸条。',prompt:'门口的中景画面。',characterCostume:{Luna:'blue coat'},videoDirection:structuredClone(i===2?direction:valid)}));
const reply={repairs:[
 {path:'shots[2].videoDirection.camera',value:'镜头保持走廊中景，随Luna离开桌边移向出口，并让门口与众人留在画面内。'},
 {path:'shots[2].videoDirection.ending',value:'Luna半转身把纸条收在低处，Tilda与Silt停在身后，Inkfin留在卷轴之间。'},
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

test('rejects wrong episode-vs-batch paths, duplicate patches and overflow',()=>{
 const issues=directorFieldRepairs(shots,beats);
 for(const first of [
  {...reply.repairs[0],path:'shots[18].videoDirection.camera'},
  {...reply.repairs[0],path:reply.repairs[1].path},
  {...reply.repairs[0],value:direction.camera},
 ])assert.throws(()=>applyDirectorFieldRepairs(shots,{repairs:[first,reply.repairs[1]]},issues));
 assert.throws(()=>applyDirectorFieldRepairs(shots,{repairs:[...reply.repairs,{path:'shots[0].prompt',value:'Rewrite all.'}]},issues));
});

test('collects non-Chinese prose and voice contamination independently of neighboring length errors',()=>{
 const invalid=structuredClone(shots);invalid[0].videoDirection.action='Luna whispers as she folds the note.';invalid[1].videoDirection.ending='Luna开口说道台词。';
 const issues=directorFieldRepairs(invalid,beats);
 assert.deepEqual(issues.map(i=>i.path),['shots[0].videoDirection.action','shots[1].videoDirection.ending','shots[2].videoDirection.camera','shots[2].videoDirection.ending']);
 const total=structuredClone(shots.slice(0,1));total[0].videoDirection={action:sized('动作继续。',300),camera:sized('镜头跟随。',180),detail:sized('纸条弯曲。',140),ending:sized('人物停下。',140)};
 const budget=directorFieldRepairs(total,beats.slice(0,1));assert.equal(budget.length,4);assert.ok(budget.reduce((sum,i)=>sum+i.limit,0)<=720);
});

test('repairs Chinese speech contamination in small checkpointed chunks',()=>{
 const invalid=Array.from({length:6},(_,index)=>({videoDirection:{...valid,action:`角色${index + 1}开口说道台词。`}}));
 const sixBeats=Array.from({length:6},(_,index)=>({...beats[0],index:index + 1}));
 const issues=directorFieldRepairs(invalid,sixBeats);
 assert.equal(issues.length,6);
 assert.deepEqual(selectDirectorFieldRepairChunk(issues).map(issue=>issue.path),issues.slice(0,6).map(issue=>issue.path));
 const prompt=buildDirectorFieldRepairPrompt(invalid,sixBeats,issues.slice(0,1),undefined,'zh');
 assert.match(prompt,/完整、简洁中文句子/);
 assert.match(prompt,/registeredEntityNames/);
 assert.match(prompt,/引号中的台词/);
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
   path:issue.path,value:`角色${issue.index + 1}从桌边转身走向门口。`,
  }))},issues,true));
 }});
 assert.equal(calls,1);assert.equal(saves,1);
 assert.deepEqual(repaired.map(shot=>shot.marker),invalid.map(shot=>shot.marker));
 assert.ok(repaired.every(shot=>/走向门口。$/u.test(shot.videoDirection.action)));
});

test('checkpoints valid repairs when a provider omits or corrupts sibling entries',()=>{
 const invalid=structuredClone(shots);invalid[0].videoDirection.action='角色开口说道台词。';invalid[1].videoDirection.action='另一角色大喊对白。';
 const issues=directorFieldRepairs(invalid,beats);
 const progress=applyDirectorFieldRepairProgress(invalid,{repairs:[
  {path:issues[0].path,value:'Luna从桌边转身走向门口。'},
  {path:issues[1].path,value:'still invalid without punctuation'},
 ]},issues,beats);
 assert.deepEqual(progress.applied,[issues[0].path]);
 assert.equal(progress.shots[0].videoDirection.action,'Luna从桌边转身走向门口。');
 assert.equal(progress.shots[1].videoDirection.action,invalid[1].videoDirection.action);
 assert.ok(progress.rejected.includes(issues[1].path));
});

test('rejects repaired prose that still contains English outside registered entity names',()=>{
 const localBeats=[{...beats[0],characters:['萧贵妃'],objects:['铜镜']}];
 const invalid=[{videoDirection:{action:'萧贵妃 turns beside 铜镜.',camera:'镜头保持正面中景。',detail:'纸条短暂露在指间。',ending:'她收回手后保持不动。'}}];
 const issues=directorFieldRepairs(invalid,localBeats);
 const rejected=applyDirectorFieldRepairProgress(invalid,{repairs:[{
  path:issues[0].path,value:'萧贵妃 places the note beside 铜镜.',
 }]},issues,localBeats);
 assert.deepEqual(rejected.applied,[]);
 assert.deepEqual(rejected.rejected,[issues[0].path]);
 const accepted=applyDirectorFieldRepairProgress(invalid,{repairs:[{
  path:issues[0].path,value:'萧贵妃把折好的纸条放在铜镜旁，然后收回手。',
 }]},issues,localBeats);
 assert.deepEqual(accepted.applied,[issues[0].path]);
 assert.equal(accepted.shots[0].videoDirection.action,'萧贵妃把折好的纸条放在铜镜旁，然后收回手。');
});

test('one overflowing field does not force rewriting valid camera geometry when its repair frees enough budget',()=>{
 const original={action:sized('动作延续。',260),camera:sized('镜头平移。',160),detail:sized('纸条弯曲。',195),ending:sized('人物停下。',120)};
 const issues=directorFieldRepairs([{videoDirection:original}],beats.slice(0,1));
 assert.deepEqual(issues.map(i=>[i.field,i.limit]),[['detail',140]]);
});

test('field repair permits a complete clause while keeping all unaffected fields verbatim',()=>{
 const d={action:sized('动作延续。',300),camera:sized('镜头平移。',180),detail:sized('纸条弯曲。',140),ending:sized('账本平放在桌面，破损开口留在食指旁边，其他人物仍停在原来的位置。',160)};
 const input=[{videoDirection:d}];const issues=directorFieldRepairs(input,beats.slice(0,1));
 assert.deepEqual(issues.map(i=>i.field),['ending']);
 const repaired=applyDirectorFieldRepairs(input,{repairs:[{path:issues[0].path,value:'账本平放在桌面。'}]},issues);
 assert.equal(repaired[0].videoDirection.ending,'账本平放在桌面。');
 assert.equal(repaired[0].videoDirection.camera,d.camera);
});

test('physical openings are not dialogue and a rejected speech repair has a deterministic camera fallback',()=>{
 const physical=[{videoDirection:{...valid,camera:'低机位跟随沙发移到车尾开口，最后让车尾开口与品牌标志处于同一画面。'}}];
 const localBeat={...beats[0],shotSize:'中景',angle:'低机位平视略仰',cameraMove:'横移'};
 assert.deepEqual(directorFieldRepairs(physical,[localBeat]),[]);
 const invalid=[{marker:'keep',videoDirection:{...valid,camera:'镜头推近沈贵妃，她开口说道原句。'}}];
 const issues=directorFieldRepairs(invalid,[{...localBeat,characters:['沈贵妃'],speech:[{character:'沈贵妃',exactLine:'原句。'}]}],['沈贵妃']);
 const fallback=applyDeterministicDirectorFieldRepairFallback(invalid,issues,[localBeat],['沈贵妃']);
 assert.deepEqual(fallback.applied,['shots[0].videoDirection.camera']);
 assert.equal(fallback.shots[0].marker,'keep');
 assert.equal(fallback.shots[0].videoDirection.camera,'镜头推近沈贵妃。');
 assert.deepEqual(fallback.shots[0].videoDirection.action,invalid[0].videoDirection.action);
 const vocativeBeat={...localBeat,characters:['裴大人','沈贵妃'],speech:[{character:'沈贵妃',exactLine:'裴大人。'}]};
 const vocative=[{videoDirection:{...valid,camera:'镜头跟随裴大人低头，沈贵妃开口说道“裴大人”。'}}];
 const vocativeIssues=directorFieldRepairs(vocative,[vocativeBeat],['裴大人','沈贵妃']);
 const vocativeFallback=applyDeterministicDirectorFieldRepairFallback(vocative,vocativeIssues,[vocativeBeat],['裴大人','沈贵妃']);
 assert.equal(vocativeFallback.shots[0].videoDirection.camera,'镜头跟随裴大人低头。');
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

test('repair and final validation share the project registry for silent background characters and props', () => {
 const registry=['沈贵妃','裴大人','宫女','金色面膜'];
 const localBeats=[{index:8,characters:['沈贵妃'],objects:[],action:'沈贵妃俯身，裴大人坐直。',speech:[]}];
 const input=[{description:'贵妃俯身，裴大人坐直，宫女在一旁托着面膜。',prompt:'[宫女](green robe) stands beside the couch.',videoDirection:{
  action:'[沈贵妃]俯身靠近；[裴大人]挺直后背，[宫女]在旁托住[金色面膜]。',
  camera:'镜头在面部高度保持正面中景。',detail:'她的衣袖垂在他的脸侧。',ending:'他在她的注视下保持坐直。',
 }}];
 assert.doesNotThrow(()=>validateDirectorShots(input,localBeats,'array','zh',registry,true));
 assert.deepEqual(directorFieldRepairs(input,localBeats,registry),[], 'do not invent a language failure after final validation accepted the same names');
 const invalid=structuredClone(input);invalid[0].videoDirection.action+=' she turns.';
 const issues=directorFieldRepairs(invalid,localBeats,registry);
 const repaired=applyDirectorFieldRepairProgress(invalid,{value:input[0].videoDirection.action},issues,localBeats,registry);
 assert.deepEqual(repaired.applied,[issues[0].path]);
 assert.deepEqual(repaired.shots,input);
 assert.match(buildDirectorFieldRepairPrompt(invalid,localBeats,issues,undefined,'zh',registry),/宫女/);
 const unknown=structuredClone(input);unknown[0].videoDirection.action='[UnknownGuard]从卧榻旁退开。';
 assert.equal(directorFieldRepairs(unknown,[{...localBeats[0],characters:['UnknownGuard']}],registry).length,1,'an unknown beat name must not expand the project registry');
});

test('missing motion object is filled field by field without regenerating the approved storyboard', () => {
 const input=[{description:'Luna turns toward the exit.',prompt:'Luna beside the doorway.',marker:'keep'}];
 const issues=directorFieldRepairs(input,beats.slice(0,1));
 assert.deepEqual(issues.map(issue=>issue.field),['action','camera','detail','ending']);
 const values={action:'Luna从桌边转身走向出口。',camera:'镜头从走廊保持中景。',detail:'',ending:'Luna抵达门口。'};
 const result=applyDirectorFieldRepairProgress(input,{repairs:issues.map(issue=>({path:issue.path,value:values[issue.field]}))},issues,beats.slice(0,1));
 assert.equal(result.applied.length,4);
 assert.deepEqual(result.shots,[{...input[0],videoDirection:values}]);
 assert.equal(input[0].videoDirection,undefined);
 assert.doesNotThrow(()=>validateDirectorShots(result.shots,beats.slice(0,1),'array','en',beats[0].characters,true));
});

test('equivalent patch envelopes bind only requested fields, never episode-number guesses', () => {
 const input=[{videoDirection:{...valid,action:'Luna 开口说道原句。'}}];
 const issues=directorFieldRepairs(input,beats.slice(0,1));
 const value='Luna折好纸条并转向Inkfin。';
 const entry={path:issues[0].path,value};
 for(const reply of [[entry],{data:{repairs:[entry]}},{result:{output:{value}}},{[entry.path]:value},entry]) {
  const result=applyDirectorFieldRepairProgress(input,reply,issues,beats.slice(0,1));
  assert.deepEqual(result.applied,[entry.path]);
  assert.equal(result.shots[0].videoDirection.action,value);
 }
 const wrong=applyDirectorFieldRepairProgress(input,{path:'shots[16].videoDirection.action',value},issues,beats.slice(0,1));
 assert.deepEqual(wrong.applied,[]);
 assert.match(wrong.failures[0].reason,/批内索引/);
 const injected=applyDirectorFieldRepairProgress(input,{value,prompt:'Rewrite the story',speech:[]},issues,beats.slice(0,1));
 assert.equal(injected.shots[0].prompt,undefined);
});

test('a rejected replacement feeds its actual reason and candidate back to the next single-field prompt', () => {
 const input=[{videoDirection:{...valid,action:'Luna 开口说道原句。'}}];
 const issues=directorFieldRepairs(input,beats.slice(0,1));
 const failed=applyDirectorFieldRepairProgress(input,{value:'Luna开口说道原句。'},issues,beats.slice(0,1));
 assert.deepEqual(failed.applied,[]);
 assert.match(failed.failures[0].reason,/台词或声音指令/);
 const error=new DirectorFieldRepairError(failed.failures);
 const prompt=buildDirectorFieldRepairPrompt(input,beats.slice(0,1),issues,error,'zh');
 assert.match(error.message,/台词或声音指令/);
 assert.match(prompt,/Return JSON \{"value"/);
 assert.match(prompt,/Luna开口说道原句/);
 assert.match(prompt,/台词或声音指令/);
});

test('an unchanged over-budget response is not counted as progress', () => {
 const input=[{videoDirection:{action:sized('Luna转身离开。',300),camera:sized('镜头保持中景。',180),detail:sized('纸条垂在低处。',140),ending:sized('Luna抵达门口。',140)}}];
 const issues=directorFieldRepairs(input,beats.slice(0,1));
 const reply={repairs:issues.map(issue=>({path:issue.path,value:issue.original.trim()}))};
 const result=applyDirectorFieldRepairProgress(input,reply,issues,beats.slice(0,1));
 assert.deepEqual(result.applied,[]);
 assert.ok(result.failures.every(failure=>/未改变/.test(failure.reason)));
});
