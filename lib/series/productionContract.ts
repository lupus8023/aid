import type { Storyboard } from "@/types";
import type { StoryPlan, Beat, Sequence, WriterCharacter } from '@/lib/pipeline/types';
import { MAX_H3_SPEECH_TURNS, validateSpeechContract } from '@/lib/speechAudioContract';
import { auditStoryDelivery } from '@/lib/storyDeliveryAudit';

export interface SeriesProductionContract {
  shotCount: 18;
  voices: Record<string, string | undefined>;
  dialogue: Array<{ character: string; text: string }>;
  story?: { title: string; theme: string; logline: string; opening: string; goal: string; conflict: string; choice: string; resolution: string; hook: string };
  shots?: Array<{
    number: number; seconds: number; characters: string[];
    action: string; visual: string; purpose: string;
    locationId?: string; sceneStyle?: string; sceneImageUrl?: string;
    sound?: string;
    dialogue: Array<{ character: string; text: string; emotion: string }>;
  }>;
}

// A series already has an approved, timed screenplay. Adapt its structure to
// the director's input without asking a second writer to rewrite its dialogue.
export function buildApprovedSeriesPlan(contract: SeriesProductionContract, sourceBrief: string, characters: WriterCharacter[]): StoryPlan {
  const shots = contract.shots;
  if (contract.shotCount !== 18 || shots?.length !== 18) throw new Error('连续剧定稿必须包含完整18镜');
  const duration = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  if (!Number.isFinite(duration) || duration < 115 || duration > 125) throw new Error('连续剧定稿总时长需为115–125秒');
  const cast = new Map(characters.map(c => [c.name, c]));
  shots.forEach((shot, index) => {
    if (shot.number !== index + 1 || !Number.isFinite(shot.seconds) || shot.seconds < 2 || shot.seconds > 15 || !shot.action || !shot.visual || !shot.purpose || !shot.locationId)
      throw new Error(`连续剧定稿镜头${index + 1}缺少制作信息或顺序无效`);
    if (shot.characters.some(name => !cast.has(name) || !(name in contract.voices))) throw new Error('定稿包含未登记角色');
    if (shot.dialogue.length > MAX_H3_SPEECH_TURNS || shot.dialogue.some(d => !d.text?.trim() || !shot.characters.includes(d.character) || !contract.voices[d.character] || cast.get(d.character)?.voiceId !== contract.voices[d.character]))
      throw new Error(`连续剧定稿镜头${shot.number}台词或音色无效`);
  });
  if (JSON.stringify(shots.flatMap(s => s.dialogue.map(({ character, text }) => ({ character, text })))) !== JSON.stringify(contract.dialogue))
    throw new Error('连续剧逐镜台词与全片定稿不一致');
  const story = contract.story;
  if (!story || ['opening', 'goal', 'conflict', 'choice', 'resolution', 'hook'].some(key => !String(story[key as keyof typeof story] || '').trim()))
    throw new Error('连续剧分集叙事合同缺少开场、目标、冲突、选择、回报或结尾钩子');
  const sequences: Sequence[] = [];
  for (const shot of shots) {
    let sequence = sequences.at(-1);
    if (!sequence || sequence.locationId !== shot.locationId) {
      sequence = { id: `series-seq-${sequences.length + 1}`, locationId: shot.locationId!, sceneStyle: shot.sceneStyle || '', sceneGoal: shot.purpose, beats: [] };
      sequences.push(sequence);
    }
    const previous = shots[shot.number - 2], next = shots[shot.number];
    const beat: Beat = {
      index: shot.number, sourceShotRefs: [shot.number], sequenceId: sequence.id, locationId: sequence.locationId,
      shotSize: '', cameraMove: '', angle: '', action: shot.action, performance: [], characters: [...shot.characters], objects: [],
      dialogueLines: [], dialogueTurns: [], speech: [],
      audioPlan: { backgroundHuman: 'none', environment: shot.sound ? [shot.sound] : [], foley: [], music: 'none', silenceBefore: 0, silenceAfter: 0 },
      clipType: shot.dialogue.length ? 'dialogue' : 'action', dramaticPurpose: shot.purpose,
      cause: previous?.action || story?.opening || shot.action, conflict: story?.conflict || '', choice: shot.action,
      consequence: shot.purpose, characterChange: '', nextCause: next?.action || story?.resolution || shot.purpose,
      informationGain: shot.purpose, dialoguePurpose: shot.dialogue.length ? 'approved_dialogue' : 'visual_only',
      dialogueUnitId: `${sequence.id}-exchange`, dialogueContext: shot.visual,
      montageRole: shot.number === 18 ? 'payoff' : shot.number === 1 ? 'setup' : 'development',
      editBridge: next?.visual || story?.hook || shot.visual, audienceQuestion: story?.hook || '',
      durationHint: shot.seconds, transition: 'cut', continuityFrom: previous?.locationId === shot.locationId ? previous.number : undefined,
      sceneStyle: shot.sceneStyle || '', promptDraft: shot.visual,
    };
    sequence.beats.push(beat);
  }
  const plan: StoryPlan = {
    id: `series-plan-${crypto.randomUUID()}`, targetShotCount: 18, targetDurationSeconds: 120, estimatedDurationSeconds: duration,
    sourceBrief, title: story?.title || 'Approved series episode', theme: story?.theme || '', logline: story?.logline || '',
    seriesEpisode: { opening: story.opening, goal: story.goal, conflict: story.conflict, choice: story.choice, resolution: story.resolution, hook: story.hook },
    protagonist: characters[0]?.name || '', externalWant: story?.goal || '', internalNeed: '', stakes: story?.conflict || '',
    obstacle: story?.conflict || '', finalChoice: story?.choice || '', consequence: story?.resolution || '', change: '',
    storyAnchor: story?.goal || '', visualMotif: '', emotionalArc: '', centralDramaticQuestion: story?.hook || '',
    audiencePromise: story?.resolution || '', montageStrategy: 'Preserve the approved shot order and motivate cuts through actions and reactions.',
    characters: characters.map(c => ({ name: c.name, want: '', obstacle: '', arc: '', subtext: '', gender: c.gender, ageGroup: c.ageGroup, voiceId: c.voiceId, voiceProfile: c.voiceProfile, voiceSource: c.voiceSource, voiceLocked: true })),
    sequences,
  };
  const result = bindSeriesPlan(contract, plan);
  const plannedBeats = result.sequences.flatMap(s => s.beats);
  validateSeriesProduction(contract, plannedBeats);
  const preflight: Storyboard[] = plannedBeats.map(beat => ({ ...beat, id: `scene-${beat.index}`, sceneNumber: beat.index, description: beat.action, prompt: beat.promptDraft, status: 'pending', continuityFrom: beat.continuityFrom ? `scene-${beat.continuityFrom}` : undefined }));
  const errors = auditStoryDelivery(result, preflight).errors;
  for (const board of preflight) {
    const error = validateSpeechContract([board]);
    if (error) errors.push(`镜头${board.sceneNumber}：${error}`);
  }
  if (errors.length) throw new Error(`连续剧制作预检失败：${errors.join('；')}`);
  return result;
}

// The series screenplay is structured and already validated. Re-parsing the
// rendered "台词：Name：“text”" document is not an authority for exact speech.
// Retain directing metadata, but bind each unchanged source shot to its actual
// action, duration, cast and ordered lines before calling the visual director.
export function bindSeriesPlan(contract: SeriesProductionContract, plan: StoryPlan): StoryPlan {
  if (!contract.shots) return plan; // older contracts still receive final validation
  const beats = plan.sequences.flatMap(s => s.beats);
  if (beats.length !== contract.shots.length || beats.some((b, i) => b.index !== i + 1 ||
    (b.sourceShotRefs?.length && (b.sourceShotRefs.length !== 1 || b.sourceShotRefs[0] !== i + 1))))
    throw new Error('连续剧详细规划改变了定稿镜头顺序，不能绑定台词');
  const result = structuredClone(plan);
  for (const beat of result.sequences.flatMap(s => s.beats)) {
    const shot = contract.shots[beat.index - 1];
    if (shot.number !== beat.index || shot.characters.some(name => !(name in contract.voices)))
      throw new Error('定稿镜头编号或人物无效');
    beat.action = shot.action;
    beat.promptDraft = shot.visual;
    beat.dramaticPurpose = shot.purpose;
    beat.durationHint = shot.seconds;
    beat.characters = [...shot.characters];
    beat.dialogueLines = shot.dialogue.map(({ character, text }) => ({ character, text }));
    beat.dialogueTurns = shot.dialogue.map((d, index) => ({
      speaker: d.character, exactLine: d.text, function: 'approved_dialogue',
      contentGoal: d.text, respondsTo: index ? shot.dialogue[index - 1].text : shot.purpose,
    }));
    beat.speech = shot.dialogue.map((d, index) => {
      if (!shot.characters.includes(d.character) || !contract.voices[d.character])
        throw new Error(`定稿角色“${d.character}”缺少本镜登记或音色`);
      return {
        speakerId: `speaker-${Object.keys(contract.voices).indexOf(d.character) + 1}`,
        character: d.character, voiceId: contract.voices[d.character], exactLine: d.text,
        emotion: d.emotion, delivery: d.emotion, volume: 'normal', lipSync: true,
        source: 'user_exact', storyFunction: 'approved_dialogue', contentGoal: d.text,
        respondsTo: beat.dialogueTurns[index].respondsTo,
      };
    });
    beat.dialogueObligation = shot.dialogue.length ? 'required' : 'visual';
    beat.dialoguePurpose = shot.dialogue.length ? 'approved_dialogue' : 'visual_only';
    beat.performance = beat.performance.filter(cue => shot.characters.includes(cue.character));
  }
  result.estimatedDurationSeconds = contract.shots.reduce((sum, s) => sum + s.seconds, 0);
  return result;
}

// A second directing pass is allowed to stage the approved episode, but must
// not silently rewrite its dialogue, invent speakers or recast its actors.
export function validateSeriesProduction(
  contract: SeriesProductionContract,
  storyboards: Array<Pick<Storyboard, 'speech'>>,
): void {
  if (storyboards.length !== contract.shotCount)
    throw new Error("连续剧导演结果偏离已定稿的18镜");
  const canonical = (value: string) => value.replace(/\s+/g, "");
  const expected = new Map<string, string>();
  for (const line of contract.dialogue)
    expected.set(
      line.character,
      (expected.get(line.character) || "") + canonical(line.text),
    );
  const actual = new Map<string, string>();
  for (const shot of storyboards) {
    for (const line of shot.speech || []) {
      if (!(line.character in contract.voices))
        throw new Error(`导演新增了未定稿的发声角色“${line.character}”`);
      if (line.voiceId !== contract.voices[line.character])
        throw new Error(`角色“${line.character}”的声音偏离全剧定稿`);
      actual.set(
        line.character,
        (actual.get(line.character) || "") + canonical(line.exactLine),
      );
    }
  }
  for (const name of new Set([...expected.keys(), ...actual.keys()])) {
    if ((expected.get(name) || "") !== (actual.get(name) || ""))
      throw new Error(
        `导演改写、遗漏或重复了“${name}”的定稿台词；已停止进入付费画面制作`,
      );
  }
}
