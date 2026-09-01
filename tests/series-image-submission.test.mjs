import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { submitImageOnce } from '../lib/series/imageSubmission.ts';
import { ProviderRequestNotSentError } from '../lib/providerConnection.ts';

const key='image-01234567-89ab-cdef';
async function fixture(run) {
 const directory=await mkdtemp(path.join(os.tmpdir(),'aid-image-receipt-'));
 try { await run(directory); } finally { await rm(directory,{recursive:true,force:true}); }
}
test('concurrent workers and a new request recover one durable paid submission',()=>fixture(async directory=>{
 let purchases=0;
 const input={prompt:'private-prompt',apiKey:'private-test-secret',images:['a','b']};
 const submit=async()=>{purchases++;await new Promise(r=>setTimeout(r,20));return 'provider-paid-id';};
 const options={directory,key,input,submit};
 assert.deepEqual(await Promise.all([submitImageOnce(options),submitImageOnce(options)]),['provider-paid-id','provider-paid-id']);
 assert.equal(await submitImageOnce({...options,input:{images:['a','b'],apiKey:'private-test-secret',prompt:'private-prompt'}}),'provider-paid-id');
 assert.equal(purchases,1);
 const raw=await readFile(path.join(directory,(await readdir(directory))[0]),'utf8');
 assert.ok(!raw.includes('private-test-secret'));assert.ok(!raw.includes('private-prompt'));
 await assert.rejects(submitImageOnce({...options,input:{...input,prompt:'different'}}),/内容不一致/);
 assert.equal(purchases,1);
}));
test('ambiguous upstream responses survive retries without another purchase',()=>fixture(async directory=>{
 let purchases=0;
 const options={directory,key,input:{prompt:'same'},submit:async()=>{purchases++;throw Error('response lost');}};
 await assert.rejects(submitImageOnce(options),/response lost/);
 await assert.rejects(submitImageOnce(options),/不重复计费/);
 assert.equal(purchases,1);
}));
test('interrupted server reservation is retained instead of silently expiring and buying again',()=>fixture(async directory=>{
 let purchases=0;
 const options={directory,key,input:{prompt:'same'},submit:async()=>{purchases++;return 'paid';}};
 await submitImageOnce(options);
 const file=path.join(directory,(await readdir(directory))[0]);
 const receipt=JSON.parse(await readFile(file));delete receipt.taskId;receipt.state='pending';receipt.createdAt='2000-01-01';
 await writeFile(file,JSON.stringify(receipt));
 await assert.rejects(submitImageOnce({...options,waitMs:10}),/不重复计费/);
 assert.equal(purchases,1);
}));
test('provider moderation survives a browser reload with no new purchase',()=>fixture(async directory=>{
 let purchases=0;
 const options={directory,key,input:{prompt:'same'},submit:async()=>{purchases++;throw Error('content moderation');}};
 await assert.rejects(submitImageOnce(options),/moderation/);
 await assert.rejects(submitImageOnce(options),/内容审核/);
 assert.equal(purchases,1);
}));
test('proven unsent reservation recovers once across concurrent workers',()=>fixture(async directory=>{
 let attempts=0,purchases=0;
 const options={directory,key,input:{prompt:'same'},submit:async()=>{
  attempts++;
  if(attempts===1)throw new ProviderRequestNotSentError('TLS connection never established');
  purchases++;await new Promise(r=>setTimeout(r,20));return 'one-paid-task';
 }};
 await assert.rejects(submitImageOnce(options),ProviderRequestNotSentError);
 const [file]=await readdir(directory);
 assert.equal(JSON.parse(await readFile(path.join(directory,file))).state,'not_sent');
 assert.deepEqual(await Promise.all([submitImageOnce(options),submitImageOnce(options)]),['one-paid-task','one-paid-task']);
 assert.equal(purchases,1);assert.equal(attempts,2);
 assert.equal(await submitImageOnce(options),'one-paid-task');assert.equal(purchases,1);
}));
test('a response lost during recovery cannot reconnect again',()=>fixture(async directory=>{
 let calls=0;
 const options={directory,key,input:{prompt:'same'},submit:async()=>{
  if(++calls===1)throw new ProviderRequestNotSentError('TLS failure');
  throw Error('response lost after provider accepted');
 }};
 await assert.rejects(submitImageOnce(options));
 await assert.rejects(submitImageOnce(options),/response lost/);
 await assert.rejects(submitImageOnce(options),/不重复计费/);
 assert.equal(calls,2);
}));
