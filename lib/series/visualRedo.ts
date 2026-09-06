import type { ProjectData } from '@/hooks/useProject';
import type { Storyboard } from '@/types';
import { buildEpisodeProject, seriesId, seriesObjectReferenceMode } from './domain';
import type { SeriesCharacter, SeriesEpisode, SeriesProject } from './types';

const generatedImageKeys = [
  'imageTaskId',
  'imageSubmissionKey',
  'imageIssue',
  'imageFailures',
] as const;

function isApprovedCharacterReference(character: SeriesCharacter): boolean {
  return character.imageSource === 'user'
    || character.imageSource === 'library'
    || Boolean(character.casting);
}

function clearGeneratedCharacterImage(character: SeriesCharacter): boolean {
  if (character.appearance === 'voice_only' || isApprovedCharacterReference(character)) return false;
  const hadImage = Boolean(
    character.bibleUrl
    || character.imageUrl
    || character.photographicAnchor
    || character.imageTaskId
    || character.imageSubmissionKey,
  );
  character.bibleUrl = undefined;
  character.imageUrl = '';
  character.imageBase64 = undefined;
  character.visualIdentity = undefined;
  character.visualMaster = undefined;
  character.photographicAnchor = undefined;
  character.photographicCardReview = undefined;
  character.photographicSheetUrl = undefined;
  for (const key of generatedImageKeys) delete character[key];
  character.imageSource = 'auto';
  character.locked = false;
  character.version++;
  return hadImage;
}

/** Keep authored shot intent and reusable dialogue audio, but discard every
 * image/video artifact so Story restarts at prompt and image generation. */
export function clearStoryboardMedia(storyboard: Storyboard): Storyboard {
  return {
    ...storyboard,
    imageUrl: undefined,
    gridSourceUrl: undefined,
    status: 'pending',
    taskId: undefined,
    imageTaskMode: undefined,
    imageGridSize: undefined,
    imageCandidateUrls: undefined,
    imagePromptOverride: undefined,
    imageFailureReason: undefined,
    imageFailureHistory: undefined,
    imageRetryCount: undefined,
    imageCastRepairAttempts: undefined,
    imageCastRepairPrompt: undefined,
    imageCastReviewWarning: undefined,
    videoUrl: undefined,
    videoSourceUrl: undefined,
    videoCacheKey: undefined,
    videoCacheStatus: undefined,
    videoCachedAt: undefined,
    videoSegmentId: undefined,
    videoSegmentStoryboardIds: undefined,
    videoGenerationSignature: undefined,
    videoStatus: 'pending',
    videoTaskId: undefined,
    videoProviderUsed: undefined,
    videoSeed: undefined,
    videoContinuityChainId: undefined,
    videoContinuitySegmentIndex: undefined,
    videoEndingAudit: undefined,
    videoEndingRepairAttempts: undefined,
    videoEndingWarning: undefined,
    videoDuplicateAudit: undefined,
    videoDuplicateRepairAttempts: undefined,
    videoDuplicateRepairPrompt: undefined,
    videoDuplicateHistory: undefined,
    videoEndingHistory: undefined,
    videoPrompt: undefined,
    videoPromptOverride: false,
    videoDuration: undefined,
  };
}

export interface SeriesVisualRedoSummary {
  characters: number;
  locations: number;
  objects: number;
  episodes: number;
}

/** Reset visual production without changing the bible, episode prose, shot
 * screenplay, director storyboards, voices or historical deliveries. */
export function resetSeriesVisualProduction(project: SeriesProject): SeriesVisualRedoSummary {
  const incomplete = project.episodes.filter(episode =>
    !episode.script?.length
    || !episode.production?.storyboards?.length
    || episode.production.storyboards.length !== episode.script.length,
  );
  if (incomplete.length) {
    throw new Error(`一键重做需要先完成全部分镜文本；第${incomplete.map(episode => episode.number).join('、')}集尚无完整可复用分镜`);
  }

  project.visualHistory ||= [];
  project.visualHistory.push({
    changedAt: new Date().toISOString(),
    reason: 'manual_visual_redo',
    styleReference: project.styleReference,
    characters: structuredClone(project.characters),
    locations: structuredClone(project.locations),
    objects: structuredClone(project.objects),
    productions: project.episodes.map(episode => ({
      episodeId: episode.id,
      version: episode.version,
      production: structuredClone(episode.production!),
    })),
  });

  let characters = 0;
  for (const character of project.characters) {
    if (clearGeneratedCharacterImage(character)) characters++;
  }

  let locations = 0;
  for (const location of project.locations) {
    if (location.imageUrl || location.imageTaskId || location.imageSubmissionKey) locations++;
    location.imageUrl = undefined;
    for (const key of generatedImageKeys) delete location[key];
  }

  let objects = 0;
  for (const object of project.objects || []) {
    if (seriesObjectReferenceMode(object) !== 'auto') continue;
    if (object.imageUrl || object.imageTaskId || object.imageSubmissionKey) objects++;
    object.imageUrl = '';
    object.imageBase64 = undefined;
    object.visualIdentity = undefined;
    for (const key of generatedImageKeys) delete object[key];
  }

  for (const episode of project.episodes) {
    const production = episode.production!;
    const visualPromptRewriteId = seriesId('visual-prompt-rewrite');
    episode.production = {
      ...production,
      storyboards: production.storyboards.map(storyboard => clearStoryboardMedia({
        ...storyboard,
        visualPromptRewriteId,
      })),
      costumeImages: {},
      sceneImages: [],
      videoSegmentPlan: undefined,
      pipelineState: undefined,
      updatedAt: new Date().toISOString(),
    };
    episode.version++;
    episode.visualRedoPending = true;
  }

  return { characters, locations, objects, episodes: project.episodes.length };
}

/** Rebind newly generated masters into the retained Story director result
 * immediately before the storyboard images are generated. */
export function refreshVisualRedoProduction(project: SeriesProject, episode: SeriesEpisode): ProjectData {
  if (!episode.production) throw new Error('没有可复用的分镜制作稿');
  const retainedStoryboards = episode.production.storyboards.map(clearStoryboardMedia);
  const current = buildEpisodeProject(project, episode);
  return {
    ...episode.production,
    name: current.name,
    characters: current.characters,
    objects: current.objects,
    storyContent: current.storyContent,
    language: current.language,
    targetShotCount: current.targetShotCount,
    aspectRatio: current.aspectRatio,
    visualStyle: current.visualStyle,
    styleReference: current.styleReference,
    voiceReferences: current.voiceReferences,
    costumeImages: current.costumeImages,
    sceneImages: current.sceneImages,
    storyboards: retainedStoryboards,
    videoSegmentPlan: undefined,
    pipelineState: undefined,
    updatedAt: new Date().toISOString(),
  };
}
