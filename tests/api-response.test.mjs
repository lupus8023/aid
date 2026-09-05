import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiResponseError, isRequestTooLargeError, readApiJson } from '../lib/apiResponse.ts';

test('an HTML image-upload error retains status without misdirecting users to change screenplay providers', async () => {
  await assert.rejects(readApiJson(new Response('<html>server error</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }), '参考图上传失败'), error => {
    assert.equal(error.status, 500);
    assert.match(error.message, /参考图上传失败/);
    assert.doesNotMatch(error.message, /切换剧本 API/);
    return true;
  });
});

test('413 is terminal regardless of gateway response body format', async () => {
  for (const [body, contentType] of [
    ['', 'application/json'], ['<html>too large</html>', 'text/html'],
    ['Request Entity Too Large', 'text/plain'], [JSON.stringify({ error: 'Too big' }), 'application/json'],
  ]) {
    await assert.rejects(readApiJson(new Response(body, { status: 413, headers: { 'Content-Type': contentType } }), '四宫格任务创建失败'), error => {
      assert.ok(error instanceof ApiResponseError);
      assert.equal(error.status, 413);
      assert.equal(isRequestTooLargeError(error), true);
      assert.match(error.message, /不会自动重试/);
      assert.equal(isRequestTooLargeError(new Error(`批次 1–4：${error.message}`)), true);
      return true;
    });
  }
  assert.equal(isRequestTooLargeError(new Error('HTTP 503 temporarily unavailable')), false);
  assert.equal(isRequestTooLargeError(new Error('task_413abcdef is pending')), false);
});

test('reads the final JSON data event from a keep-alive screenplay stream', async () => {
  const response = new Response(': connected\n\n: keep-alive\n\ndata: {"storyPlan":{"title":"Film"}}\n\n', {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
  const data = await readApiJson(response, '剧本规划失败');
  assert.equal(data.storyPlan.title, 'Film');
});

test('surfaces a streamed screenplay task failure with its original context', async () => {
  const response = new Response('data: {"error":"DMXAPI timeout"}\n\n', {
    headers: { 'Content-Type': 'text/event-stream' },
  });
  await assert.rejects(() => readApiJson(response, '剧本规划失败'), /剧本规划失败：DMXAPI timeout/);
});

test('task polling can read terminal failures without swallowing ordinary or streamed API errors', async () => {
  const body = JSON.stringify({ status: 'failed', error: 'Prompt图片未通过审核' });
  const data = await readApiJson(new Response(body), '查询', { taskStatus: true });
  assert.equal(data.status, 'failed');
  assert.match(data.error, /未通过审核/);
  await assert.rejects(readApiJson(new Response(body), '普通请求'), /未通过审核/);
  await assert.rejects(readApiJson(new Response(`data: ${body}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }), '流', { taskStatus: true }), /未通过审核/);
  await assert.rejects(readApiJson(new Response(body, { status: 500 }), '查询', { taskStatus: true }), /未通过审核/);
});
