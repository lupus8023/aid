import type { SeriesEpisode, SeriesProject, SeriesShot } from './types';
import { episodeScreenplay } from './domain';
import { checkScriptDialogue, copiedDialogueShotNumbers } from './scriptRepair';
import type { Storyboard } from '@/types';
import { authorSegmentSpeech } from '@/lib/videoSegments';

export function repairEpisodeDialogue(project: SeriesProject, episode: SeriesEpisode, repaired: SeriesShot[]): SeriesEpisode {
  if (!episode.script || episode.deliveries.some(d => d.episodeVersion === episode.version)) throw new Error('已交付或没有剧本的分集不能自动替换台词');
  const allowed = new Set(copiedDialogueShotNumbers(episode.script));
  const structure = (shots: SeriesShot[]) => JSON.stringify(shots.map(s => ({ ...s, dialogue: s.dialogue.map(d => ({ ...d, text: '' })) })));
  if (!allowed.size || structure(episode.script) !== structure(repaired)) throw new Error('自动修稿只能修改串镜台词，不得改变镜头、角色、动作或时长');
  checkScriptDialogue(repaired, project.language);
  const changed = repaired.filter((s, i) => JSON.stringify(s.dialogue) !== JSON.stringify(episode.script![i].dialogue)).map(s => s.number);
  if (changed.some(n => !allowed.has(n))) throw new Error('自动修稿改动了未授权的正确台词');
  const next = structuredClone(episode);
  next.script = repaired;
  updateProductionDialogue(project, next, repaired, changed);
  next.dialogueRepairs = [...(next.dialogueRepairs || []), { at: new Date().toISOString(), shots: changed, reason: '自动纠正邻镜台词串到不同角色', before: episode.script.filter(s => changed.includes(s.number)).map(s => ({ number: s.number, dialogue: s.dialogue })), after: repaired.filter(s => changed.includes(s.number)).map(s => ({ number: s.number, dialogue: s.dialogue })) }];
  return next;
}

function updateProductionDialogue(project: SeriesProject, next: SeriesEpisode, repaired: SeriesShot[], changed: number[]): void {
  const production = next.production;
  const patchSpeech = <T extends { speech?: Storyboard['speech'] }>(item: T, number: number): T => {
    const shot = repaired[number - 1];
    if (!item.speech || item.speech.length !== shot.dialogue.length) throw new Error(`第${number}镜台词轮次与制作断点不一致`);
    const speech = item.speech.map((line, i) => {
      const d = shot.dialogue[i], character = project.characters.find(c => c.id === d.characterId)!;
      if (line.character !== character.name || line.voiceId !== character.voiceId) throw new Error(`第${number}镜音色或说话人偏离定稿`);
      return { ...line, exactLine: d.text, contentGoal: d.text, respondsTo: i ? shot.dialogue[i - 1].text : line.respondsTo };
    });
    const result = { ...item, speech } as T & { dialogueLines?: any[]; dialogueTurns?: any[] };
    if (result.dialogueLines) result.dialogueLines = shot.dialogue.map(d => ({ character: project.characters.find(c => c.id === d.characterId)!.name, text: d.text }));
    if (result.dialogueTurns) result.dialogueTurns = result.dialogueTurns.map((turn, i) => ({ ...turn, exactLine: shot.dialogue[i].text, contentGoal: shot.dialogue[i].text, respondsTo: i ? shot.dialogue[i - 1].text : turn.respondsTo }));
    return result;
  };
  if (production) {
    production.storyContent = episodeScreenplay(project, next);
    if (production.storyPlan) {
      production.storyPlan.sourceBrief = production.storyContent;
      for (const seq of production.storyPlan.sequences) seq.beats = seq.beats.map(b => changed.includes(b.index) ? patchSpeech(b, b.index) : b);
    }
    const affectedIds = new Set(production.storyboards.filter(b => changed.includes(b.sceneNumber)).map(b => b.id));
    for (const segment of production.videoSegmentPlan?.segments || []) {
      if (!segment.storyboardIds.some(id => affectedIds.has(id))) continue;
      for (const id of segment.storyboardIds) affectedIds.add(id);
    }
    const groups = new Set(production.storyboards.filter(b => changed.includes(b.sceneNumber)).map(b => b.videoSegmentId).filter(Boolean));
    production.storyboards = production.storyboards.map(b => {
      const result = changed.includes(b.sceneNumber) ? patchSpeech(b, b.sceneNumber) : b;
      if (!affectedIds.has(b.id) && !(b.videoSegmentId && groups.has(b.videoSegmentId))) return result;
      return { ...result, videoStatus: 'pending', videoTaskId: undefined, videoUrl: undefined, videoSourceUrl: undefined, videoCacheKey: undefined, videoCacheStatus: undefined, videoCachedAt: undefined, videoSegmentId: undefined, videoSegmentStoryboardIds: undefined, videoGenerationSignature: undefined, videoPrompt: undefined, videoPromptOverride: false };
    });
    if (production.videoSegmentPlan) {
      production.videoSegmentPlan.segments = production.videoSegmentPlan.segments.map(segment => segment.storyboardIds.some(id => affectedIds.has(id))
        ? { ...segment, speech: authorSegmentSpeech(segment.storyboardIds.map(id => production.storyboards.find(b => b.id === id)!)) } : segment);
      production.videoSegmentPlan.updatedAt = new Date().toISOString();
    }
  }
}

/** Series screenplay is authoritative at every production layer, including the
 * frozen segment speech used by the H3 compiler. Recover older partial repairs
 * before another paid submission rather than trusting the visible storyboard. */
export function synchronizeEpisodeDialogue(project: SeriesProject, episode: SeriesEpisode): SeriesEpisode | undefined {
  if (!episode.script || !episode.production || episode.deliveries.some(d => d.episodeVersion === episode.version)) return;
  const boards = episode.production.storyboards;
  if (!boards.length) return;
  const identity = (speech: NonNullable<Storyboard['speech']>) => JSON.stringify(speech.map(l => [l.character, l.voiceId, l.exactLine]));
  const changed = new Set<number>();
  for (const board of boards) {
    const shot = episode.script.find(s => s.number === board.sceneNumber);
    if (!shot) throw new Error('制作镜头不在当前分集剧本中');
    const expected = shot.dialogue.map(d => { const c = project.characters.find(c => c.id === d.characterId)!; return { character: c.name, voiceId: c.voiceId, exactLine: d.text }; });
    if (identity(board.speech || []) !== identity(expected as NonNullable<Storyboard['speech']>)) changed.add(board.sceneNumber);
  }
  for (const segment of episode.production.videoSegmentPlan?.segments || []) {
    const group = segment.storyboardIds.map(id => boards.find(b => b.id === id)!);
    if (group.some(b => !b)) throw new Error('视频分段引用了不存在的镜头');
    if (identity(segment.speech) !== identity(authorSegmentSpeech(group))) group.forEach(b => changed.add(b.sceneNumber));
  }
  if (!changed.size) return;
  const next = structuredClone(episode);
  updateProductionDialogue(project, next, next.script!, [...changed]);
  next.productionDialogueRepairs = [...(next.productionDialogueRepairs || []), { at: new Date().toISOString(), shots: [...changed] }];
  return next;
}
