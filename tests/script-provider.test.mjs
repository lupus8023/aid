import assert from 'node:assert/strict';
import test from 'node:test';
import { scriptProviderOrder } from '../lib/pipeline/scriptProvider.ts';

test('auto mode prefers DMX and falls back to APIMart', () => {
  assert.deepEqual(scriptProviderOrder('auto', true, true), ['dmx', 'apimart']);
  assert.deepEqual(scriptProviderOrder('auto', false, true), ['apimart']);
  assert.deepEqual(scriptProviderOrder('auto', true, false), ['dmx']);
});

test('explicit script providers never switch silently', () => {
  assert.deepEqual(scriptProviderOrder('dmx', true, true), ['dmx']);
  assert.deepEqual(scriptProviderOrder('apimart', true, true), ['apimart']);
  assert.deepEqual(scriptProviderOrder('dmx', false, true), []);
  assert.deepEqual(scriptProviderOrder('apimart', true, false), []);
});
