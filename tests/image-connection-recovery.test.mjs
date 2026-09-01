import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createImageTask } from '../lib/apimart.ts';
import { isRequestDefinitelyNotSent, ProviderRequestNotSentError } from '../lib/providerConnection.ts';

const disconnected = () => Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), {code:'ECONNRESET'});
test('only proven pre-request failures may reconnect', () => {
  assert.equal(isRequestDefinitelyNotSent(disconnected()),true);
  for (const error of [
    Object.assign(new Error('socket hang up'),{code:'ECONNRESET'}),
    Object.assign(new Error('timeout waiting for response'),{code:'ECONNABORTED'}),
    Object.assign(disconnected(),{response:{status:503}}),
    Object.assign(disconnected(),{request:{_redirectCount:1}}),
    new Error('Client network socket disconnected before secure TLS connection was established'),
  ]) assert.equal(isRequestDefinitelyNotSent(error),false);
});
test('TLS handshake failure recovers the same payload and purchases one image', async () => {
  const original=axios.post, calls=[];
  axios.post=async(url,body,config)=>{
    calls.push({url,body,config});
    if(calls.length===1)throw disconnected();
    return {data:{data:[{task_id:'accepted-once'}]}};
  };
  try {
    assert.equal(await createImageTask('same frame',[],'fixture','gpt-image-2','9:16'),'accepted-once');
    assert.equal(calls.length,2);
    assert.deepEqual(calls[0].body,calls[1].body);
    assert.equal(calls[0].config.maxRedirects,0);
  } finally {axios.post=original;}
});
test('a lost response is never replayed even without a task ID', async () => {
  const original=axios.post;let calls=0;
  axios.post=async()=>{calls++;throw Object.assign(new Error('socket hang up'),{code:'ECONNRESET'});};
  try {
    await assert.rejects(createImageTask('frame',[],'fixture','gpt-image-2'),/socket hang up/);
    assert.equal(calls,1);
  } finally {axios.post=original;}
});
test('exhausted connection attempts retain proof that no image was submitted', async () => {
  const original=axios.post;let calls=0;
  axios.post=async()=>{calls++;throw disconnected();};
  try {
    await assert.rejects(createImageTask('frame',[],'fixture','gpt-image-2'),ProviderRequestNotSentError);
    assert.equal(calls,3);
  } finally {axios.post=original;}
});
