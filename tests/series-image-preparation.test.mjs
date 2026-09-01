import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSeriesImage, SeriesImagePreparationError } from '../lib/series/imagePreparation.ts';
const ops = extra => ({label:'角色卡', wait:async()=>{}, save:async()=>{}, aborted:()=>false, persist:async url=>url, ...extra});

test('MJ moderation keeps its paid task and refuses repeat submissions across worker retries', async () => {
 const asset={imageTaskId:'paid-1'};let submits=0,polls=0;
 const operations=ops({submit:async()=>{submits++;return 'wrong';},poll:async()=>{polls++;return {status:'failed',error:'upstream code=9: Prompt图片未通过审核'};}});
 await assert.rejects(prepareSeriesImage(asset,operations), SeriesImagePreparationError);
 await assert.rejects(prepareSeriesImage(asset,operations), SeriesImagePreparationError);
 assert.equal(asset.imageTaskId,'paid-1');assert.equal(asset.imageIssue.kind,'review');assert.equal(submits,0);assert.equal(polls,2);assert.equal(asset.imageFailures.length,1);
});
test('temporary terminal failures retry at most three times and persist the budget', async () => {
 const asset={};let submits=0;
 const operations=ops({submit:async()=>`paid-${++submits}`,poll:async()=>({status:'failed',error:'upstream timeout'})});
 await assert.rejects(prepareSeriesImage(asset,operations),SeriesImagePreparationError);
 await assert.rejects(prepareSeriesImage(asset,operations),SeriesImagePreparationError);
 assert.equal(submits,3);assert.equal(asset.imageFailures.length,3);
});
test('a status outage resumes the original task without a second purchase', async () => {
 const asset={imageTaskId:'paid'};let polls=0;
 const operations=ops({submit:async()=>{throw Error('duplicate purchase');},poll:async()=>{polls++;throw Error('gateway unavailable');}});
 await assert.rejects(prepareSeriesImage(asset,operations),/状态查询连续失败/);
 assert.equal(polls,6);assert.equal(asset.imageTaskId,'paid');assert.equal(asset.imageIssue.kind,'pending');
 assert.equal(await prepareSeriesImage(asset,ops({...operations,poll:async()=>({status:'completed',imageUrl:'image'})})),'image');
 assert.equal(asset.imageIssue,undefined);
});
test('submission moderation is remembered even if no provider task id was returned', async () => {
 const asset={};let submits=0;
 const operations=ops({submit:async()=>{submits++;throw Error('content moderation');},poll:async()=>{throw Error('not submitted');}});
 await assert.rejects(prepareSeriesImage(asset,operations),SeriesImagePreparationError);
 await assert.rejects(prepareSeriesImage(asset,operations),SeriesImagePreparationError);
 assert.equal(submits,1);
});
test('nonretryable unknown failures are not disguised as transient outages', async () => {
 const asset={imageTaskId:'paid'};
 await assert.rejects(prepareSeriesImage(asset,ops({poll:async()=>({status:'failed',error:'invalid parameter'})})),SeriesImagePreparationError);
 assert.equal(asset.imageTaskId,'paid');assert.equal(asset.imageIssue.kind,'failed');
});

test('a lost paid submission response cannot automatically buy another task', async () => {
 const asset={};let submits=0;
 const operations=ops({submit:async()=>{submits++;throw Error('network response lost');}});
 await assert.rejects(prepareSeriesImage(asset,operations),/提交结果未确认/);
 await assert.rejects(prepareSeriesImage(asset,operations),/提交结果未确认/);
 assert.equal(submits,1);assert.equal(asset.imageIssue.kind,'uncertain');
});
test('a saved idempotency key recovers a lost browser response from the server receipt', async () => {
 const asset={imageSubmissionKey:'saved-key',imageIssue:{kind:'uncertain',message:'response lost'}};
 let recovered=0;
 const result=await prepareSeriesImage(asset,ops({submit:async()=>assert.fail('must not purchase'),recoverSubmission:async()=>{recovered++;return 'original-paid';},poll:async id=>{assert.equal(id,'original-paid');return {status:'completed',imageUrl:'original-image'};}}));
 assert.equal(result,'original-image');assert.equal(recovered,1);assert.equal(asset.imageIssue,undefined);
});
test('storage failures retry saving the same completed task, never regenerating', async () => {
 const asset={imageTaskId:'paid'};let saves=0;
 const operations=ops({poll:async()=>({status:'completed',imageUrl:'provider-image'}),persist:async()=>{saves++;throw Error('storage 503');}});
 await assert.rejects(prepareSeriesImage(asset,operations),/保存失败/);
 assert.equal(saves,3);assert.equal(asset.imageTaskId,'paid');assert.equal(asset.imageIssue.kind,'pending');
 assert.equal(await prepareSeriesImage(asset,ops({...operations,persist:async()=> 'stored-image'})),'stored-image');
});

test('a provider-confirmed completed task can recover after review without another submission', async () => {
 const history=[{taskId:'reviewed',message:'Prompt图片未通过审核',at:'before',retryable:false}];
 const asset={imageTaskId:'reviewed',imageIssue:{kind:'review',message:'Prompt图片未通过审核'},imageFailures:history};
 let submitted=0;
 const url=await prepareSeriesImage(asset,ops({submit:async()=>{submitted++;return 'wrong';},poll:async taskId=>{assert.equal(taskId,'reviewed');return {status:'completed',imageUrl:'approved-result'};}}));
 assert.equal(url,'approved-result');assert.equal(asset.imageIssue,undefined);assert.equal(submitted,0);assert.deepEqual(asset.imageFailures,history);
});
test('a pending or unqueryable reviewed task stays blocked and cannot be resubmitted', async () => {
 for (const poll of [async()=>({status:'pending'}),async()=>({status:'completed'}),async()=>{throw Error('outage');}]) {
  const asset={imageTaskId:'refused',imageIssue:{kind:'review',message:'Prompt图片未通过审核'}};
  await assert.rejects(prepareSeriesImage(asset,ops({submit:async()=>{assert.fail('must not submit');},poll})),SeriesImagePreparationError);
  assert.equal(asset.imageIssue.kind,'review');assert.equal(asset.imageTaskId,'refused');
 }
});
test('a storage outage after provider review retains the original task for another read-only recovery', async () => {
 const asset={imageTaskId:'reviewed',imageIssue:{kind:'review',message:'Prompt图片未通过审核'}};
 const operations=ops({poll:async()=>({status:'completed',imageUrl:'approved-result'}),persist:async()=>{throw Error('503');}});
 await assert.rejects(prepareSeriesImage(asset,operations),/保存失败/);
 assert.equal(asset.imageIssue.kind,'review');
 assert.equal(await prepareSeriesImage(asset,ops({...operations,persist:async url=>url})),'approved-result');
});
