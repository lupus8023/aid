import type { StoryPlan } from '@/lib/pipeline/types';
import type { Storyboard } from '@/types';
import { storyboardSpeech } from '@/lib/speechAudioContract';

export interface StoryDeliveryAudit {
  errors: string[];
  warnings: string[];
  metrics: {
    plannedShots: number;
    storyboardShots: number;
    dialogueLines: number;
    dialogueContracts: number;
    dialogueContractsDelivered: number;
    dialogueUnits: number;
    lockedDialogueLines: number;
    storyMilestones: number;
    groupedSegments: number;
    multiShotSegments: number;
  };
}

function speechSignature(character: string, exactLine: string): string {
  return `${String(character || '').trim()}\u0000${String(exactLine || '').replace(/\s+/g, ' ').trim()}`;
}

/**
 * Match a semantic turn to its delivered speech identity before comparing its
 * fields. storyboardSpeech may quarantine one invalid line; positional access
 * would then blame every later, otherwise valid turn for the single omission.
 * The occurrence index remains authoritative when the same speaker/function
 * repeats, while exact locked text is the strongest available identity.
 */
function alignDeliveredTurns(expectedTurns: any[], deliveredLines: ReturnType<typeof storyboardSpeech>) {
  const unused = new Set(deliveredLines.map((_, index) => index));
  return expectedTurns.map((turn, expectedIndex) => {
    const candidates = [...unused]
      .filter(index => deliveredLines[index].character === turn.speaker)
      .map(index => {
        const line = deliveredLines[index];
        let score = 0;
        if (turn.exactLine && String(line.exactLine || '') === String(turn.exactLine)) score += 100;
        if (turn.function && String(line.storyFunction || '') === String(turn.function)) score += 20;
        if (turn.contentGoal && String(line.contentGoal || '') === String(turn.contentGoal)) score += 10;
        score -= Math.abs(index - expectedIndex);
        return { index, line, score };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const match = candidates[0];
    if (!match) return { line: undefined, deliveredIndex: -1 };
    unused.delete(match.index);
    return { line: match.line, deliveredIndex: match.index };
  });
}

/**
 * Verifies that the Story engine delivered the same causal story and exact
 * spoken-line sequence through screenplay, storyboard and segment planning.
 * This is deliberately deterministic: a later visual model may improve how a
 * beat looks, but it may never silently delete or reorder what the writer
 * decided the audience must understand and hear.
 */
export function auditStoryDelivery(
  storyPlan: StoryPlan | undefined,
  storyboards: Storyboard[],
  groups: Storyboard[][] = [],
): StoryDeliveryAudit {
  const errors: string[] = [];
  const warnings: string[] = [];
  const beats = storyPlan?.sequences.flatMap(sequence => sequence.beats) || [];

  if (storyPlan && beats.length !== storyboards.length) {
    errors.push(`剧本 ${beats.length} 镜，但分镜交付 ${storyboards.length} 镜`);
  }
  storyboards.forEach((storyboard, index) => {
    if (storyboard.sceneNumber !== index + 1) errors.push(`分镜顺序不连续：位置 ${index + 1} 实际为镜头 ${storyboard.sceneNumber}`);
    if (!String(storyboard.action || '').trim()) errors.push(`镜头 ${storyboard.sceneNumber} 缺少可执行动作`);
    const beat = beats[index];
    if (!beat) return;
    for (const [field, label] of [
      ['dramaticPurpose', '戏剧目的'],
      ['cause', '直接原因'],
      ['consequence', '可见后果'],
      ['informationGain', '信息增量'],
      ['audienceQuestion', '观众问题'],
      ['montageRole', '蒙太奇功能'],
      ['editBridge', '剪辑交棒'],
    ] as const) {
      if (!String(storyboard[field] || '').trim()) errors.push(`镜头 ${storyboard.sceneNumber} 丢失${label}`);
    }
    if (String(storyboard.action || '').trim() !== String(beat.action || '').trim()) {
      errors.push(`镜头 ${storyboard.sceneNumber} 的权威动作在导演阶段被改写`);
    }
    if (String(storyboard.dialogueUnitId || '') !== String(beat.dialogueUnitId || '')) {
      errors.push(`镜头 ${storyboard.sceneNumber} 的对白单元标识丢失`);
    }
    const expectedTurns = beat.dialogueTurns || [];
    const deliveredTurns = storyboard.dialogueTurns || [];
    if (JSON.stringify(deliveredTurns) !== JSON.stringify(expectedTurns)) {
      errors.push(`镜头 ${storyboard.sceneNumber} 的逐轮台词语义合同在导演阶段丢失或被改写`);
    }
    const deliveredLines = storyboardSpeech(storyboard);
    const alignedLines = alignDeliveredTurns(expectedTurns, deliveredLines);
    expectedTurns.forEach((turn, turnIndex) => {
      const { line, deliveredIndex } = alignedLines[turnIndex];
      if (!line) {
        errors.push(`镜头 ${storyboard.sceneNumber} 缺少第 ${turnIndex + 1} 轮语义合同对应的逐字台词`);
        return;
      }
      if (deliveredLines.length === expectedTurns.length && deliveredIndex !== turnIndex) {
        errors.push(`镜头 ${storyboard.sceneNumber} 第 ${turnIndex + 1} 轮台词发生缺失、插入或调序（实际位于第 ${deliveredIndex + 1} 条）`);
      }
      if (line.character !== turn.speaker || String(line.storyFunction || '') !== turn.function) {
        errors.push(`镜头 ${storyboard.sceneNumber} 第 ${turnIndex + 1} 轮的说话者或叙事功能偏离故事骨架`);
      }
      if (String(line.contentGoal || '') !== turn.contentGoal) {
        errors.push(`镜头 ${storyboard.sceneNumber} 第 ${turnIndex + 1} 轮丢失“${turn.contentGoal}”语义任务`);
      }
      if (turn.exactLine && String(line.exactLine || '') !== turn.exactLine) {
        errors.push(`镜头 ${storyboard.sceneNumber} 第 ${turnIndex + 1} 轮没有逐字交付全片锁定台词`);
      }
      if (turn.meaningEvidence && !String(line.exactLine || '').toLocaleLowerCase().includes(turn.meaningEvidence.toLocaleLowerCase())) {
        errors.push(`镜头 ${storyboard.sceneNumber} 第 ${turnIndex + 1} 轮的实际台词没有包含语义证据“${turn.meaningEvidence}”`);
      }
      if (!String(line.listenerState || '').trim()) {
        warnings.push(`镜头 ${storyboard.sceneNumber} 第 ${turnIndex + 1} 轮没有可见的听者反应，台词可能无法推动下一镜`);
      }
    });
  });

  if (storyPlan) {
    const expectedMilestones = ['opening', 'inciting_incident', 'first_threshold', 'midpoint_reversal', 'crisis_choice', 'climax_proof', 'resolution'];
    const milestones = storyPlan.structure || [];
    if (storyPlan.seriesEpisode) {
      const expectedShots = Number(storyPlan.targetShotCount);
      if (!Number.isInteger(expectedShots) || expectedShots < 1 || beats.length !== expectedShots || ['opening', 'goal', 'conflict', 'choice', 'resolution', 'hook'].some(key =>
        !String(storyPlan.seriesEpisode?.[key as keyof NonNullable<StoryPlan['seriesEpisode']>] || '').trim()))
        errors.push(`连续剧分集缺少完整${Number.isInteger(expectedShots) && expectedShots > 0 ? expectedShots : '计划'}镜或开场、目标、冲突、选择、回报、钩子合同`);
    } else if (milestones.length !== expectedMilestones.length
      || expectedMilestones.some(name => milestones.filter(item => item.name === name).length !== 1)) {
      errors.push('全片缺少完整的七个叙事里程碑');
    }
    let priorMilestoneShot = 0;
    milestones.forEach(milestone => {
      if (!beats.some(beat => beat.index === milestone.shotIndex)) {
        errors.push(`叙事里程碑 ${milestone.name} 指向不存在的镜头 ${milestone.shotIndex}`);
      }
      if (milestone.shotIndex < priorMilestoneShot) errors.push(`叙事里程碑 ${milestone.name} 顺序倒置`);
      priorMilestoneShot = milestone.shotIndex;
    });
    const expectedSpeech = beats.flatMap(beat => beat.speech || []).map(line => (
      speechSignature(line.character, line.exactLine)
    ));
    const deliveredSpeech = storyboards.flatMap(storyboardSpeech).map(line => (
      speechSignature(line.character, line.exactLine)
    ));
    const max = Math.max(expectedSpeech.length, deliveredSpeech.length);
    for (let index = 0; index < max; index += 1) {
      if (expectedSpeech[index] === deliveredSpeech[index]) continue;
      const expected = expectedSpeech[index]?.replace('\u0000', ': “') + (expectedSpeech[index] ? '”' : '无');
      const actual = deliveredSpeech[index]?.replace('\u0000', ': “') + (deliveredSpeech[index] ? '”' : '无');
      errors.push(`第 ${index + 1} 条对白交付不一致：剧本=${expected}，分镜=${actual}`);
      break;
    }
    beats.filter(beat => beat.dialogueObligation === 'required' && !(beat.speech || []).length)
      .forEach(beat => errors.push(`镜头 ${beat.index} 标记为必要对白但剧本没有逐字台词`));
  } else {
    warnings.push('旧项目没有结构化 StoryPlan，只能校验分镜与视频分段覆盖关系');
  }

  const dialogueUnits = new Map<string, typeof beats>();
  beats.forEach(beat => {
    if (!beat.dialogueUnitId) return;
    dialogueUnits.set(beat.dialogueUnitId, [...(dialogueUnits.get(beat.dialogueUnitId) || []), beat]);
  });
  dialogueUnits.forEach((unitBeats, unitId) => {
    const functions = unitBeats.flatMap(beat => beat.dialogueTurns || []).map(turn => turn.function.toLowerCase());
    if (functions.some(value => /^(?:question|challenge)$/.test(value))
      && !functions.some(value => /^(?:answer|refusal|decision)$/.test(value))) {
      warnings.push(`对白单元 ${unitId} 提出了问题/挑战，但没有在同一单元交付回答、拒绝或决定`);
    }
  });

  if (groups.length) {
    const expectedIds = storyboards.map(storyboard => storyboard.id);
    const deliveredIds = groups.flatMap(group => group.map(storyboard => storyboard.id));
    if (expectedIds.join('|') !== deliveredIds.join('|')) {
      errors.push('视频分段没有按原顺序完整覆盖全部分镜，或存在重复/遗漏');
    }
    if (new Set(deliveredIds).size !== deliveredIds.length) errors.push('同一分镜被重复分配到多个视频片段');
  }

  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    metrics: {
      plannedShots: beats.length,
      storyboardShots: storyboards.length,
      dialogueLines: storyboards.flatMap(storyboardSpeech).length,
      dialogueContracts: beats.reduce((total, beat) => total + (beat.dialogueTurns || []).length, 0),
      dialogueContractsDelivered: storyboards.reduce((total, storyboard) => total + (storyboard.dialogueTurns || []).length, 0),
      dialogueUnits: new Set(beats.map(beat => beat.dialogueUnitId).filter(Boolean)).size,
      lockedDialogueLines: beats.flatMap(beat => beat.dialogueTurns || []).filter(turn => turn.exactLine).length,
      storyMilestones: storyPlan?.structure?.length || 0,
      groupedSegments: groups.length,
      multiShotSegments: groups.filter(group => group.length > 1).length,
    },
  };
}
