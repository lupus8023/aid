import assert from 'node:assert/strict';
import test from 'node:test';
import {copiedDialogueShotNumbers, checkDialogueOwnership} from '../lib/series/scriptRepair.ts';
import {repairEpisodeDialogue} from '../lib/series/productionDialogueRepair.ts';
const line=(characterId,text)=>({characterId,text,emotion:'calm'});
const shot=(number,dialogue)=>({number,seconds:7,locationId:'hall',characterIds:dialogue.map(d=>d.characterId),visual:'A formal announcement',action:'Read the nomination',purpose:'Nominate Luna',sound:'room tone',dialogue});
const script=[shot(1,[line('Luna',"Great. I'm a candidate."),line('Tilda','You were always one.')]),shot(2,[line('Rill',"Great. I'm a candidate."),line('Victoria','Always one.')]),shot(3,[line('Luna','What happens next?')])];
const repaired=structuredClone(script);repaired[1].dialogue=[line('Rill','Luna is formally nominated.'),line('Victoria','Without my consent.')];

test('detects copied exchanges reassigned to other characters without rejecting one shared phrase',()=>{
 assert.deepEqual(copiedDialogueShotNumbers(script),[2]);
 assert.throws(()=>checkDialogueOwnership(script,'en'),e=>e.issues.length===2&&e.issues.every(i=>i.shotNumber===2&&i.reason==='ownership'&&i.originalText));
 assert.deepEqual(copiedDialogueShotNumbers(repaired),[]);
 const sameSpeakers=structuredClone(script);sameSpeakers[1].dialogue=sameSpeakers[0].dialogue;
 assert.deepEqual(copiedDialogueShotNumbers(sameSpeakers),[]);
 const one=structuredClone(script);one[1].dialogue=[line('Rill',"Great. I'm a candidate.")];assert.deepEqual(copiedDialogueShotNumbers(one),[]);
});

test('late automated dialogue correction retains images/voices and unrelated paid clips',()=>{
 const project={name:'Test',language:'en',locations:[{id:'hall',name:'Hall'}],characters:['Luna','Tilda','Rill','Victoria'].map(id=>({id,name:id,voiceId:'voice-'+id}))};
 const boards=script.map(s=>({id:'scene-'+s.number,sceneNumber:s.number,imageUrl:'image-'+s.number,status:'completed',speech:s.dialogue.map(d=>({character:d.characterId,voiceId:'voice-'+d.characterId,exactLine:d.text})),videoTaskId:'paid-'+s.number,videoStatus:'completed',videoSegmentId:s.number===1?'independent':'shared-2-3',videoPrompt:'old words'}));
 const episode={version:1,number:1,title:'Title',script,deliveries:[],production:{id:'keep-project-id',storyboards:boards,voiceReferences:{Luna:'keep-voice'},storyPlan:{sequences:[{beats:boards.map(b=>({...b,index:b.sceneNumber}))}]}}};
 const original=structuredClone(episode),next=repairEpisodeDialogue(project,episode,repaired);
 assert.deepEqual(episode,original); assert.equal(next.version,1);assert.equal(next.production.id,episode.production.id);
 assert.deepEqual(next.production.storyboards.map(b=>b.imageUrl),boards.map(b=>b.imageUrl));assert.deepEqual(next.production.voiceReferences,episode.production.voiceReferences);
 assert.equal(next.production.storyboards[0].videoTaskId,'paid-1');assert.equal(next.production.storyboards[1].videoTaskId,undefined);assert.equal(next.production.storyboards[2].videoTaskId,undefined);
 assert.equal(next.production.storyboards[1].speech[0].voiceId,'voice-Rill');assert.equal(next.production.storyboards[1].speech[0].exactLine,'Luna is formally nominated.');
 assert.equal(next.production.storyPlan.sequences[0].beats[1].speech[0].exactLine,'Luna is formally nominated.');
 assert.deepEqual(next.dialogueRepairs[0].shots,[2]);
 const wrong=structuredClone(repaired);wrong[0].action='rewrite correct shot';assert.throws(()=>repairEpisodeDialogue(project,episode,wrong),/只能修改/);
 assert.throws(()=>repairEpisodeDialogue(project,{...episode,deliveries:[{episodeVersion:1}]},repaired),/已交付/);
});

test('ownership repair rejects synonym-only changes that retain the wrong first-person claim', async()=>{
 const {applyDialogueRepairs}=await import('../lib/series/scriptRepair.ts');let issues;
 try{checkDialogueOwnership(script,'en')}catch(e){issues=e.issues}
 assert.throws(()=>applyDialogueRepairs({shots:script},{repairs:[{path:issues[0].path,value:"So, I'm a candidate."},{path:issues[1].path,value:'Always, somehow.'}]},issues),/真实含义|第一人称/);
});

test('repairs frozen segment speech and recovers an older partial repair before H3 submission', async()=>{
 const {createVideoSegmentPlan,resolveVideoSegmentGroups}=await import('../lib/videoSegments.ts');
 const {buildVideoSegmentPrompt}=await import('../lib/videoGenerator.ts');
 const {synchronizeEpisodeDialogue}=await import('../lib/series/productionDialogueRepair.ts');
 const project={name:'Test',language:'en',locations:[{id:'hall',name:'Hall'}],characters:['Luna','Tilda','Rill','Victoria'].map(id=>({id,name:id,voiceId:'voice-'+id}))};
 const boards=script.map(s=>({id:'scene-'+s.number,sceneNumber:s.number,durationHint:7,action:s.action,characters:s.characterIds,description:s.visual,prompt:s.visual,imageUrl:'image-'+s.number,status:'completed',speech:s.dialogue.map(d=>({speakerId:d.characterId,character:d.characterId,voiceId:'voice-'+d.characterId,exactLine:d.text,source:'user_exact',volume:'normal',lipSync:true})),videoTaskId:'paid-'+s.number,videoStatus:'completed'}));
 const plan=createVideoSegmentPlan(boards,boards.map(b=>[b]));
 const episode={version:1,number:1,title:'Title',script,deliveries:[],production:{id:'keep',storyboards:boards,videoSegmentPlan:plan}};
 const next=repairEpisodeDialogue(project,episode,repaired);
 assert.equal(next.production.videoSegmentPlan.segments[1].speech[0].exactLine,'Luna is formally nominated.');
 assert.deepEqual(next.production.videoSegmentPlan.segments[0],plan.segments[0]);
 const group=resolveVideoSegmentGroups(next.production.storyboards,next.production.videoSegmentPlan)[1];
 const prompt=buildVideoSegmentPrompt(group,[],{duration:7,language:'en',referenceAudioNames:['Rill','Victoria']});
 assert.match(prompt,/Luna is formally nominated\./); assert.doesNotMatch(prompt,/I'm a candidate/);
 assert.equal(synchronizeEpisodeDialogue(project,next),undefined);
 const partial=structuredClone(next);partial.production.videoSegmentPlan=plan;partial.production.storyboards[1].videoTaskId='paid-with-obsolete-dialogue';
 const recovered=synchronizeEpisodeDialogue(project,partial);
 assert.equal(recovered.production.videoSegmentPlan.segments[1].speech[0].exactLine,'Luna is formally nominated.');
 assert.equal(recovered.production.storyboards[1].videoTaskId,undefined);assert.equal(recovered.production.storyboards[0].videoTaskId,'paid-1');
 assert.deepEqual(recovered.production.storyboards.map(b=>b.imageUrl),boards.map(b=>b.imageUrl));
 assert.equal(synchronizeEpisodeDialogue(project,recovered),undefined);
});
