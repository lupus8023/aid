import assert from 'node:assert/strict';
import test from 'node:test';
import {recordSeriesInterruption,seriesCheckpointAdvanced} from '../lib/series/interruption.ts';

test('a long production with many successful launches still recovers a single connection loss',()=>{
 const job={attempts:12,status:'running',lease:'current'};
 recordSeriesInterruption(job,false);
 assert.equal(job.status,'queued');assert.equal(job.consecutiveInterruptions,1);assert.equal(job.lease,undefined);
});
test('a paused project never becomes failed just because it has been started many times',()=>{
 const job={attempts:20,consecutiveInterruptions:2,status:'running',lease:'current'};
 recordSeriesInterruption(job,true);
 assert.equal(job.status,'paused');assert.equal(job.consecutiveInterruptions,2);assert.equal(job.error,undefined);
});
test('three interruptions without media or script progress still stop an unhealthy worker',()=>{
 const job={attempts:1,status:'running'};
 for(let i=0;i<3;i++)recordSeriesInterruption(job,false);
 assert.equal(job.status,'failed');assert.match(job.error,/没有新增进度/);
});
test('revision, pause or property ordering does not disguise a stalled checkpoint as progress',()=>{
 const p={id:'series',revision:1,updatedAt:'before',paused:false,characters:[{id:'c1',imageTaskId:'paid'}],episodes:[]};
 const q={episodes:[],characters:[{imageTaskId:'paid',id:'c1'}],paused:true,updatedAt:'after',revision:8,id:'series'};
 assert.equal(seriesCheckpointAdvanced(p,q),false);
 q.characters[0].bibleUrl='stored-image';
 assert.equal(seriesCheckpointAdvanced(p,q),true);
});
