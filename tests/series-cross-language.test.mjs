import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findSeriesVoices } from '../lib/series/voices.ts';
import { voiceReferenceSample } from '../lib/voiceReference.ts';
import { checkVoiceTranscript, verifyFishVoiceLanguage } from '../lib/voiceLanguageCheck.ts';
import { createVoiceReferenceService } from '../lib/voiceReferenceGeneration.ts';
import { partitionSeriesJobs, seriesRetryBlocker } from '../lib/series/jobHistory.ts';

test('an empty English library falls back to licensed cross-language voices, never arbitrary public voices', async () => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async url => {
    const q = new URL(url).searchParams; calls.push(q);
    if (q.has('self') || q.has('language')) return Response.json({ items: [], has_more: false });
    assert.equal(q.get('licensed'), 'true');
    return Response.json({ items: [
      { _id: 'male-ja', title: 'male warm', languages: ['ja'], licensed: true, state: 'trained' },
      { _id: 'female-ja', title: 'female warm', languages: ['ja'], licensed: true, state: 'trained' },
      { _id: 'unlicensed', title: 'male', languages: ['en'], licensed: false },
    ], has_more: false });
  };
  try {
    const result = await findSeriesVoices({ name: 'He Jin', gender: 'male', voiceBrief: 'warm' }, 'en', 'fixture', []);
    assert.deepEqual(result.candidates.map(c => c.voiceId), ['male-ja']);
    assert.equal(result.candidates[0].requiresLanguageCheck, true);
    assert.equal(result.candidates[0].source, 'licensed');
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = previous; }
});

test('native-language candidates rank before cross-language keyword matches', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async url => {
    const q = new URL(url).searchParams;
    return Response.json({ items: q.has('self') ? [] : [
      { _id: 'native', title: 'male', languages: ['en'], licensed: true },
      { _id: 'cross', title: 'male warm deep calm raspy bright', languages: ['ja'], licensed: true },
    ], has_more: false });
  };
  try {
    const result = await findSeriesVoices({ name: 'He Jin', gender: 'male', voiceBrief: 'warm deep calm raspy bright' }, 'en', 'fixture', []);
    assert.equal(result.candidates[0].voiceId, 'native'); assert.equal(result.candidates[0].requiresLanguageCheck, false);
  } finally { globalThis.fetch = previous; }
});

test('transcript validation rejects wrong language, empty output, severe omissions and extra speech', () => {
  for (const language of ['en', 'zh']) {
    assert.equal(checkVoiceTranscript(voiceReferenceSample(language), language, language).passed, true);
    assert.equal(checkVoiceTranscript('', language).passed, false);
    assert.equal(checkVoiceTranscript('Hello world', language, 'en').passed, false);
    assert.equal(checkVoiceTranscript(voiceReferenceSample(language).repeat(3), language).passed, false);
    assert.equal(checkVoiceTranscript(voiceReferenceSample(language), language, 'ja').passed, false);
  }
  assert.equal(checkVoiceTranscript(voiceReferenceSample('en').replace(/[.,]/g, '').toUpperCase(), 'en').matchScore, 1);
});

test('ASR detects the actual spoken language instead of receiving a forced language hint', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.fish.audio/v1/asr'); assert.equal(init.body.has('language'), false);
    assert.equal(init.body.get('audio').size, 2048);
    return Response.json({ text: voiceReferenceSample('en'), language_code: 'en' });
  };
  try { assert.equal((await verifyFishVoiceLanguage(Buffer.alloc(2048), 'en', 'fixture')).passed, true); }
  finally { globalThis.fetch = previous; }
});

test('a saved old-version sample is verified without resynthesis; ASR outages resume from audio across restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aid-cross-language-'));
  let syntheses = 0, uploads = 0, checks = 0;
  const input = { voiceId: 'voice', fishAudioKey: 'fixture', language: 'en', strictVoice: true };
  const deps = { root, ready: async () => {},
    synthesize: async () => { syntheses++; return { buffer: Buffer.alloc(2048), voiceId: 'voice' }; },
    upload: async () => { uploads++; return { secure_url: 'https://assets.test/voice.mp3', duration: 12 }; },
    verify: async () => { checks++; if (checks === 1) throw new Error('ASR offline'); return checkVoiceTranscript(voiceReferenceSample('en'), 'en', 'en'); },
  };
  try {
    await createVoiceReferenceService(deps)(input);
    await assert.rejects(createVoiceReferenceService(deps)({ ...input, verifyLanguage: true }), e => e.code === 'VOICE_VERIFICATION_FAILED');
    const result = await createVoiceReferenceService(deps)({ ...input, verifyLanguage: true });
    assert.equal(result.languageCheck.passed, true);
    await createVoiceReferenceService(deps)({ ...input, verifyLanguage: true });
    assert.equal(syntheses, 1); assert.equal(uploads, 1); assert.equal(checks, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('wrong-language samples remain rejected after restart without another synthesis or upload', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aid-cross-rejected-'));
  let syntheses = 0, checks = 0;
  const deps = { root, ready: async () => {},
    synthesize: async () => { syntheses++; return { buffer: Buffer.alloc(2048), voiceId: 'bad' }; },
    upload: async () => { throw new Error('must not publish unverified sample'); },
    verify: async () => { checks++; return checkVoiceTranscript('こんにちは', 'en', 'ja'); },
  };
  try {
    for (let i = 0; i < 2; i++) await assert.rejects(createVoiceReferenceService(deps)({ voiceId: 'bad', fishAudioKey: 'fixture', language: 'en', strictVoice: true, verifyLanguage: true }), e => e.code === 'VOICE_UNAVAILABLE');
    assert.equal(syntheses, 1); assert.equal(checks, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent verified/unverified requests cannot bypass language verification or duplicate synthesis', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aid-cross-parallel-'));
  let syntheses = 0, checks = 0;
  const service = createVoiceReferenceService({ root, ready: async () => {},
    synthesize: async () => { syntheses++; return { buffer: Buffer.alloc(2048), voiceId: 'voice' }; },
    upload: async () => ({ secure_url: 'https://assets.test/voice.mp3' }),
    verify: async () => { checks++; return checkVoiceTranscript(voiceReferenceSample('en'), 'en'); },
  });
  const input = { voiceId: 'voice', fishAudioKey: 'fixture', language: 'en', strictVoice: true };
  try {
    const [, verified] = await Promise.all([service(input), service({ ...input, verifyLanguage: true })]);
    assert.equal(verified.languageCheck.passed, true); assert.equal(syntheses, 1); assert.equal(checks, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('obsolete failures are history; active work stays visible and duplicate/stale retries are rejected', () => {
  const old = { id: 'old', seriesId: 's', kind: 'prepare', status: 'failed', updatedAt: '2026-08-30T01:00:00Z' };
  const latest = { ...old, id: 'latest', updatedAt: '2026-08-30T02:00:00Z' };
  const develop = { ...old, id: 'develop', kind: 'develop' };
  const jobs = [old, latest, develop];
  const groups = partitionSeriesJobs(jobs);
  assert.deepEqual(groups.history.map(j => j.id), ['old']);
  assert.deepEqual(groups.current.map(j => j.id), ['latest', 'develop']);
  assert.match(seriesRetryBlocker(old, jobs), /历史任务/);
  assert.equal(seriesRetryBlocker(latest, jobs), '');
  old.status = 'queued';
  assert.equal(partitionSeriesJobs(jobs).history.length, 0, 'never hide active duplicates');
  assert.match(seriesRetryBlocker(latest, jobs), /已有排队/);
  assert.equal(old.status, 'queued', 'history projection does not mutate jobs');
});
