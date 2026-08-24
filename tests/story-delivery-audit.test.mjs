import assert from 'node:assert/strict';
import test from 'node:test';

import { auditStoryDelivery } from '../lib/storyDeliveryAudit.ts';
import { buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';
import { estimateVideoSegmentSeconds, suggestVideoSegments } from '../lib/videoSegments.ts';

const dialogueByShot = new Map([
  [2, [{ character: 'Officer', exactLine: 'The southern gate is buckling.', voiceId: 'voice-officer' }]],
  [3, [{ character: 'Lanxi', exactLine: 'When will the palace survive without my hands?', voiceId: 'voice-lanxi' }]],
  [8, [{ character: 'A-Luo', exactLine: 'If you collapse here, who will protect them?', voiceId: 'voice-aluo' }]],
  [12, [{ character: 'Lanxi', exactLine: 'I fear I was useful, not loved.', voiceId: 'voice-lanxi' }]],
  [16, [{ character: 'Turtle', exactLine: 'You matter even when the current moves without you.', voiceId: 'voice-turtle' }]],
  [18, [{ character: 'Lanxi', exactLine: 'Today, let it come on its own.', voiceId: 'voice-lanxi' }]],
]);

function speechFor(index) {
  return (dialogueByShot.get(index) || []).map((line, lineIndex) => ({
    speakerId: `S${lineIndex + 1}`,
    ...line,
    emotion: 'restrained', delivery: 'natural', volume: 'normal', lipSync: true,
    storyFunction: index === 18 ? 'payoff' : 'story_progression', respondsTo: '', source: 'user_exact',
  }));
}

function coherentFixture() {
  const beats = Array.from({ length: 18 }, (_, offset) => {
    const index = offset + 1;
    const speech = speechFor(index);
    return {
      index, sequenceId: index <= 9 ? 'pressure' : 'release', locationId: index <= 9 ? 'palace' : 'shore',
      action: `Lanxi performs causal action ${index}, changing the visible state before the next beat.`,
      characters: speech.length ? [...new Set(speech.map(line => line.character))] : ['Lanxi'], objects: [],
      speech, dialogueLines: speech.map(line => ({ character: line.character, text: line.exactLine })),
      audioPlan: { backgroundHuman: 'none', environment: ['tide ambience'], foley: ['water contact'], music: 'none', silenceBefore: 0.45, silenceAfter: 0.55 },
      clipType: speech.length ? 'dialogue' : 'action', durationHint: speech.length ? 5 : 2.8,
      dramaticPurpose: `Change the dramatic situation at beat ${index}`,
      cause: index === 1 ? 'The tide destabilizes.' : `The consequence of beat ${index - 1} arrives.`,
      conflict: `Lanxi must choose how to answer pressure ${index}.`, choice: `Lanxi makes choice ${index}.`,
      consequence: `A visible consequence ${index} changes the next beat.`, characterChange: `Lanxi changes at beat ${index}.`,
      nextCause: index === 18 ? 'Terminal story state.' : `The consequence triggers beat ${index + 1}.`,
      informationGain: `The audience learns story fact ${index}.`, dialoguePurpose: speech.length ? 'story_progression' : 'visual_only',
      dialogueUnitId: speech.length ? `dialogue-${index}` : '', dialogueObligation: speech.length ? 'required' : 'visual', dialogueContext: '',
      montageRole: index === 1 ? 'setup' : index === 18 ? 'resolution' : index < 10 ? 'escalation' : 'consequence',
      editBridge: index === 18 ? 'terminal image' : `The visible consequence of beat ${index} triggers beat ${index + 1} and changes what the audience expects.`,
      audienceQuestion: index === 18 ? 'How will Lanxi live freely?' : `What will beat ${index + 1} change?`,
      stateBefore: {}, stateAfter: {}, transition: 'cut',
    };
  });
  const plan = {
    title: 'Ebb Tide Day', theme: 'Worth without control', logline: '', protagonist: 'Lanxi',
    externalWant: 'Protect the palace', internalNeed: 'Release control', stakes: 'Lose herself', obstacle: 'Fear',
    finalChoice: 'Let the tide move freely', consequence: 'The palace survives', change: 'Control becomes trust', storyAnchor: 'tide wheel',
    characters: [], requirements: [], sourceBrief: '', targetShotCount: 18, targetDurationSeconds: 90, estimatedDurationSeconds: 70,
    centralDramaticQuestion: 'Can Lanxi matter without controlling the sea?', audiencePromise: '', dialogueArc: '', montageStrategy: '',
    structure: [
      ['opening', 1], ['inciting_incident', 3], ['first_threshold', 5], ['midpoint_reversal', 9],
      ['crisis_choice', 13], ['climax_proof', 17], ['resolution', 18],
    ].map(([name, shotIndex]) => ({ name, shotIndex, event: `${name} visible event`, audienceShift: `${name} audience shift` })),
    sequences: [{ id: 'all', locationId: 'world', sceneStyle: '', sceneGoal: '', dramaticQuestion: '', turningPoint: '', exitHook: '', audienceEntry: '', audienceExit: '', beats }],
  };
  const storyboards = beats.map(beat => ({
    ...beat, id: `scene-${beat.index}`, sceneNumber: beat.index, description: beat.action, prompt: beat.action,
    imageUrl: `https://example.com/${beat.index}.jpg`, status: 'completed', aspectRatio: '16:9',
  }));
  return { plan, storyboards };
}

test('delivers an 18-shot causal story and exact dialogue sequence through grouped H3 prompts', () => {
  const { plan, storyboards } = coherentFixture();
  const groups = suggestVideoSegments(storyboards);
  const audit = auditStoryDelivery(plan, storyboards, groups);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.metrics.plannedShots, 18);
  assert.equal(audit.metrics.dialogueLines, dialogueByShot.size);
  assert.ok(audit.metrics.multiShotSegments > 0);

  const prompts = groups.map(group => buildVideoSegmentPrompt(group, [], {
    duration: estimateVideoSegmentSeconds(group), language: 'en',
    hasVoiceReferences: group.some(storyboard => storyboard.speech.length),
    referenceAudioNames: [...new Set(group.flatMap(storyboard => storyboard.speech.map(line => line.character)))],
  }));
  const joined = prompts.join('\n');
  storyboards.forEach(storyboard => assert.equal((joined.match(new RegExp(storyboard.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1));
  [...dialogueByShot.values()].flat().forEach(line => assert.equal((joined.match(new RegExp(line.exactLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1));
  assert.ok(prompts.every(prompt => prompt.length <= 7000));
  assert.ok(groups.every(group => estimateVideoSegmentSeconds(group) <= 15));
});

test('blocks a director response that silently drops or reorders a screenplay line', () => {
  const { plan, storyboards } = coherentFixture();
  const broken = storyboards.map(storyboard => storyboard.sceneNumber === 12 ? { ...storyboard, speech: [], dialogueLines: [] } : storyboard);
  assert.match(auditStoryDelivery(plan, broken).errors.join('\n'), /第 4 条对白交付不一致/);
});

test('blocks segment plans that omit or duplicate a storyboard', () => {
  const { plan, storyboards } = coherentFixture();
  const groups = [storyboards.slice(0, 9), storyboards.slice(10), [storyboards[10]]];
  assert.match(auditStoryDelivery(plan, storyboards, groups).errors.join('\n'), /没有按原顺序完整覆盖|重复分配/);
});

test('blocks dialogue that loses its planned semantic content goal', () => {
  const { plan, storyboards } = coherentFixture();
  const beat = plan.sequences[0].beats[1];
  beat.dialogueTurns = [{ speaker: 'Officer', function: 'reveal', contentGoal: 'report that the southern gate is buckling', respondsTo: '' }];
  beat.speech[0].storyFunction = 'reveal';
  beat.speech[0].contentGoal = beat.dialogueTurns[0].contentGoal;
  beat.speech[0].listenerState = 'Lanxi redirects her attention toward the southern gate.';
  storyboards[1] = {
    ...storyboards[1],
    dialogueTurns: beat.dialogueTurns,
    speech: [{ ...beat.speech[0], contentGoal: '' }],
  };
  assert.match(auditStoryDelivery(plan, storyboards).errors.join('\n'), /丢失“report that the southern gate is buckling”语义任务/);
});

test('blocks a shortened spoken line even when its semantic metadata still claims the full goal', () => {
  const { plan, storyboards } = coherentFixture();
  const beat = plan.sequences[0].beats[1];
  beat.dialogueTurns = [{
    speaker: 'Officer', function: 'reveal', contentGoal: 'report that the southern gate is buckling', respondsTo: '',
    exactLine: 'The southern gate is buckling.', meaningEvidence: 'southern gate is buckling',
  }];
  beat.speech[0].storyFunction = 'reveal';
  beat.speech[0].contentGoal = beat.dialogueTurns[0].contentGoal;
  storyboards[1] = {
    ...storyboards[1],
    dialogueTurns: beat.dialogueTurns,
    speech: [{ ...beat.speech[0], exactLine: 'The gate.' }],
  };
  const errors = auditStoryDelivery(plan, storyboards).errors.join('\n');
  assert.match(errors, /没有逐字交付全片锁定台词/);
  assert.match(errors, /没有包含语义证据/);
});
