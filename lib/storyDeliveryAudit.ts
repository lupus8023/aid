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
    dialogueUnits: number;
    groupedSegments: number;
    multiShotSegments: number;
  };
}

function speechSignature(character: string, exactLine: string): string {
  return `${String(character || '').trim()}\u0000${String(exactLine || '').replace(/\s+/g, ' ').trim()}`;
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
    ] as const) {
      if (!String(storyboard[field] || '').trim()) errors.push(`镜头 ${storyboard.sceneNumber} 丢失${label}`);
    }
    if (String(storyboard.action || '').trim() !== String(beat.action || '').trim()) {
      errors.push(`镜头 ${storyboard.sceneNumber} 的权威动作在导演阶段被改写`);
    }
    if (String(storyboard.dialogueUnitId || '') !== String(beat.dialogueUnitId || '')) {
      errors.push(`镜头 ${storyboard.sceneNumber} 的对白单元标识丢失`);
    }
  });

  if (storyPlan) {
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
      dialogueUnits: new Set(beats.map(beat => beat.dialogueUnitId).filter(Boolean)).size,
      groupedSegments: groups.length,
      multiShotSegments: groups.filter(group => group.length > 1).length,
    },
  };
}
