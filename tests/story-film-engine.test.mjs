import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeStoryPlan } from '../lib/pipeline/storyWriter.ts';
import { validateSpeechLanguage } from '../lib/speechAudioContract.ts';
import { sanitizeGeneratedSpeechText } from '../lib/speechAudioContract.ts';

test('speech sanitizer removes performance prose but keeps the quoted spoken words', () => {
  assert.equal(sanitizeGeneratedSpeechText('先短暂停顿，再以坚定语气说'), '');
  assert.equal(
    sanitizeGeneratedSpeechText('先短暂停顿，再以坚定语气说：“女娲娘娘，请借我力量！”'),
    '女娲娘娘，请借我力量！',
  );
  assert.equal(sanitizeGeneratedSpeechText('（坚定）我们现在出发。'), '我们现在出发。');
});

test('sanitizer creates one authoritative, visible and voice-bound speech line per beat', () => {
  const raw = {
    title: '门外',
    protagonist: 'A',
    externalWant: '拿到钥匙',
    internalNeed: '信任 B',
    stakes: '永远离不开房间',
    obstacle: 'A 不肯求助',
    finalChoice: '把钥匙孔让给 B',
    consequence: '门被打开',
    change: 'A 接受合作',
    storyAnchor: '生锈钥匙',
    characters: [{ name: 'A', want: '离开', obstacle: '不信任', arc: '封闭到合作', subtext: '害怕被拒绝' }],
    sequences: [{
      id: 'seq-1', locationId: 'room', sceneStyle: 'cold room', beats: [{
        characters: ['A', 'B'], objects: [], action: 'A 把钥匙递给 B',
        speech: [
          { character: 'A', exactLine: '你来试。', source: 'user_exact' },
          { character: 'B', exactLine: '好。', source: 'story_required' },
        ],
        audioPlan: { backgroundHuman: 'anything', environment: ['wind'], foley: ['key contact'], music: '' },
      }, {
        characters: ['B'], objects: [], action: 'B 接过钥匙',
        speech: [{ character: 'B', exactLine: '用户并没有写这句。', source: 'user_exact' }],
      }],
    }],
  };
  const plan = sanitizeStoryPlan(raw, ['A', 'B'], [], 'A 说：“你来试。”', 9, { A: 'voice-a', B: 'voice-b' });
  const [first, second] = plan.sequences[0].beats;
  assert.equal(first.speech.length, 1);
  assert.equal(first.speech[0].character, 'A');
  assert.equal(first.speech[0].speakerId, 'S01');
  assert.equal(first.speech[0].voiceId, 'voice-a');
  assert.deepEqual(first.dialogueLines, [{ character: 'A', text: '你来试。' }]);
  assert.equal(first.audioPlan.backgroundHuman, 'none');
  assert.equal(second.speech.length, 0);
  assert.deepEqual(second.dialogueLines, []);
});

test('sanitizer preserves the story spine and causal beat fields', () => {
  const raw = {
    title: '选择', protagonist: 'A', externalWant: '赢', internalNeed: '承认错误', stakes: '失去伙伴',
    obstacle: '自尊', finalChoice: '道歉', consequence: '伙伴留下', change: '从独断到合作', storyAnchor: '裂开的奖杯',
    characters: [{ name: 'A', want: '赢', obstacle: '自尊', arc: '独断到合作', subtext: '害怕失败' }],
    sequences: [{ id: 's', locationId: 'room', beats: [{ characters: ['A'], objects: [], action: 'A 放下奖杯', dramaticPurpose: '让 A 首次放弃胜负', cause: '伙伴要离开', conflict: '道歉等于承认失败', choice: 'A 放下奖杯', consequence: '伙伴停步', characterChange: 'A 开始选择关系', nextCause: '伙伴回头' }] }],
  };
  const plan = sanitizeStoryPlan(raw, ['A'], [], '', 9);
  assert.equal(plan.internalNeed, '承认错误');
  assert.equal(plan.finalChoice, '道歉');
  assert.equal(plan.sequences[0].beats[0].nextCause, '伙伴回头');
  assert.equal(plan.sequences[0].beats[0].dramaticPurpose, '让 A 首次放弃胜负');
});

test('video speech validation catches a generated Chinese line in an English project', () => {
  const storyboards = [{
    id: 'shot-1', sceneNumber: 1, characters: ['A'], objects: [], imageUrl: 'https://example.com/a.jpg',
    dialogueLines: [{ character: 'A', text: '这不是英文。' }],
  }];
  assert.match(validateSpeechLanguage(storyboards, 'en'), /镜头 1/);
  assert.equal(validateSpeechLanguage(storyboards, 'zh'), undefined);
});
