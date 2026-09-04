import assert from 'node:assert/strict';
import test from 'node:test';

import { assertProviderAccepted, extractProviderText, isProviderContentRejection, isResponsesPreferredModel, ProviderModelRefusalError, providerPayloadSummary } from '../lib/pipeline/providerPayload.ts';

test('provider refusal metadata takes precedence over partially generated text', () => {
  for (const payload of [
    { choices: [{ finish_reason: 'content_filter', message: { content: '{"shots":[' } }] },
    { choices: [{ message: { content: '{"shots":[', refusal: 'Cannot continue' } }] },
    { result: { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"shots":[' }, { type: 'refusal', refusal: 'Cannot continue' }] }] } },
  ]) assert.throws(() => assertProviderAccepted(payload), error =>
    error instanceof ProviderModelRefusalError && error.partialText === '{"shots":[' && isProviderContentRejection(error));
  assert.doesNotThrow(() => assertProviderAccepted({ choices: [{ finish_reason: 'length', message: { content: '{"shots":[' } }] }));
});

test('extracts standard and array Chat Completions content', () => {
  assert.equal(extractProviderText({ choices: [{ message: { content: '{"ok":true}' } }] }), '{"ok":true}');
  assert.equal(extractProviderText({
    choices: [{ message: { content: [{ type: 'text', text: 'part 1' }, { type: 'output_text', text: 'part 2' }] } }],
  }), 'part 1\npart 2');
});

test('extracts Responses API output and wrapped provider payloads', () => {
  const response = {
    object: 'response',
    output: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private reasoning' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '[{"index":1}]' }] },
    ],
  };
  assert.equal(extractProviderText(response), '[{"index":1}]');
  assert.equal(extractProviderText({ data: response }), '[{"index":1}]');
});

test('does not mistake reasoning or tool calls for final screenplay text', () => {
  assert.equal(extractProviderText({ choices: [{ message: { content: null, reasoning_content: 'draft', tool_calls: [{}] } }] }), '');
  assert.equal(extractProviderText({ output: [{ type: 'reasoning', summary: [{ text: 'draft' }] }] }), '');
});

test('reports only safe response structure and routes GPT-5 models to Responses API', () => {
  const summary = providerPayloadSummary({
    model: 'gpt-5.4',
    choices: [{ finish_reason: 'length', message: { content: 'SECRET', refusal: null } }],
  });
  assert.match(summary, /gpt-5\.4/);
  assert.match(summary, /length/);
  assert.doesNotMatch(summary, /SECRET/);
  assert.equal(isResponsesPreferredModel('gpt-5.4'), true);
  assert.equal(isResponsesPreferredModel('gpt-5-mini'), true);
  assert.equal(isResponsesPreferredModel('gpt-4o'), false);
});
