import assert from 'node:assert/strict';
import test from 'node:test';
import { ensurePhotographicAnchor } from '../lib/series/photographicAnchor.ts';
const unused=async()=>assert.fail('must not buy or re-review a completed image');

test('a CG opinion retains the completed photo and never purchases another candidate',async()=>{
 const anchor={};let generated=0,reviews=0;
 const operations={label:'Luna',save:async()=>{},generate:async()=>{generated++;return 'completed';},review:async()=>{reviews++;return {photographic:false,issues:['subjective CG impression']};}};
 assert.equal(await ensurePhotographicAnchor(anchor,operations),'completed');
 assert.equal(await ensurePhotographicAnchor(anchor,operations),'completed');
 assert.equal(generated,1);assert.equal(reviews,1);assert.equal(anchor.review.photographic,false);
});
test('an unavailable quality advisory does not block production or regenerate the picture',async()=>{
 const anchor={imageUrl:'paid-image'};
 assert.equal(await ensurePhotographicAnchor(anchor,{label:'Luna',save:async()=>{},generate:unused,review:async()=>{throw Error('review offline');}}),'paid-image');
 assert.equal(anchor.review.photographic,null);
 assert.equal(await ensurePhotographicAnchor(anchor,{label:'Luna',save:async()=>{},generate:unused,review:unused}),'paid-image');
});
test('previous quality failures remain visible in history but cannot block an existing candidate',async()=>{
 const anchor={imageUrl:'candidate-3',review:{photographic:false,issues:['CG']},rejected:[1,2,3].map(n=>({imageUrl:`candidate-${n}`,issues:['CG']}))};
 assert.equal(await ensurePhotographicAnchor(anchor,{label:'Silt',save:async()=>{},generate:unused,review:unused}),'candidate-3');
 assert.equal(anchor.rejected.length,3);assert.equal(anchor.review.photographic,false);
});
test('a later provider refusal can retain its record while a previously completed candidate is reused',async()=>{
 const anchor={imageTaskId:'refused-third',imageIssue:{kind:'review',message:'provider refusal'},rejected:[{imageUrl:'completed-second',imageTaskId:'paid-second',issues:['glossy skin']}]};
 assert.equal(await ensurePhotographicAnchor(anchor,{label:'Oscar',save:async()=>{},generate:unused,review:unused}),'completed-second');
 assert.equal(anchor.imageTaskId,'refused-third');assert.equal(anchor.imageIssue.kind,'review');assert.equal(anchor.reusedCandidateTaskId,'paid-second');
});
test('a pending paid task still finishes normally instead of buying or discarding it for an old candidate',async()=>{
 const anchor={imageTaskId:'pending-third',rejected:[{imageUrl:'old',issues:['CG']}]};let resumed=0;
 assert.equal(await ensurePhotographicAnchor(anchor,{label:'Aster',save:async()=>{},generate:async()=>{assert.equal(anchor.imageTaskId,'pending-third');resumed++;return 'pending-result';},review:async()=>({photographic:true,issues:[]})}),'pending-result');
 assert.equal(resumed,1);
});
