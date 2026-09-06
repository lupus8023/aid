'use client';
import type { ImageStyleReference } from '@/lib/imageStyleReference';

import { useState, useEffect, useRef } from 'react';
import DevToolsLayout from '@/components/DevToolsLayout';
import Toolbar from '@/components/Toolbar';
import StatusBar from '@/components/StatusBar';
import StepIndicator from '@/components/StepIndicator';
import Step1 from '@/components/Step1';
import { scriptGenerationPhaseLabel, type ScriptGenerationPhase } from '@/components/ScriptThinkingPanel';
import Step2 from '@/components/Step2';
import Step3, { type VoiceCastPatch } from '@/components/Step3';
import Step4 from '@/components/Step4';
import Step5 from '@/components/Step5';
import Step6 from '@/components/Step6';
import type { VideoEditorExportResult } from '@/components/video-editor/VideoEditor';
import SettingsModal from '@/components/SettingsModal';
import CanvasMode from '@/components/CanvasMode';
import { CapturePreset, Character, ObjectItem, ProjectProductionTiming, Storyboard, VisualStyle } from '@/types';
import { StoryPlan } from '@/lib/pipeline/types';
import { useProject } from '@/hooks/useProject';
import { useSettings } from '@/hooks/useSettings';
import { comfyUIApiUrl, companionVersionAtLeast, downloadComfyUIVideo, fetchStoryApi, imageApiUrl, isComfyUIClientTask, localComfyUISettings, SEGMENT_VIDEO_COMPANION_MIN_VERSION, videoStatusResponseError } from '@/lib/comfyuiClient';
import { getImageModelCapabilities, imageModelRequiresApiKey, isGptImage2Model, isMidjourneyImageModel, resolveStoryboardGridImageModel } from '@/lib/imageModels';
import { Grid2X2 } from 'lucide-react';
import { isRequestTooLargeError, readApiJson } from '@/lib/apiResponse';
import { createStoryImageRequestPreparer } from '@/lib/storyImageRequest';
import { prepareStoryAssets } from '@/lib/storyAssetPreparation';
import { resolveCharacterStoryboardModel } from '@/lib/characterVisualMaster';
import { bindStoryboardReferences, currentVisualIdentity, ImageReferenceCapacityError, requireReferenceCapacity, visibleStoryObjects, visualAssetDescription, visualAssetSourceKey } from '@/lib/storyVisualAssets';
import { buildShotCountContract, DEFAULT_TARGET_SHOT_COUNT, normalizeTargetShotCount, storyPlanBeatCount, targetDurationSeconds } from '@/lib/pipeline/shotCount';
import { canResumeStoryPlan } from '@/lib/pipeline/resumePlan';
import { adaptedStoryCharacters, storyCastKey } from '@/lib/pipeline/storyCastAdaptation';
import { cacheVideoSource, cachedVideoObjectUrl, requestPersistentVideoStorage, videoCacheKeyForStoryboard } from '@/lib/videoCache';
import { DEFAULT_VISUAL_STYLE, normalizeVisualStyle } from '@/lib/promptArchitecture';
import { createVideoSegmentPlan, estimateVideoSegmentSeconds, isCompletedPlannedVideoSegment, normalizeVideoSegmentPlan, refreshPlannedVideoSegment, releaseUnsubmittedVideoGenerations, resolveVideoSegmentGroups, splitPlannedVideoSegment, restoredStoryStep, suggestVideoSegments, validateVideoSegment, videoSegmentGenerationSignature, type VideoSegmentPlan } from '@/lib/videoSegments';
import { filmEndingDuration, isFilmEndingSegment } from '@/lib/filmEnding';
import { retainFilmEndingForDelivery } from '@/lib/filmEndingAudit';
import { videoSubtitleRemovalSourceTaskId } from '@/lib/videoDuplicateAudit';
import { currentVoiceReferences } from '@/lib/voiceReference';
import { auditStoryDelivery } from '@/lib/storyDeliveryAudit';
import { prepareStoryboardReference } from '@/lib/storyboardImagePreprocess';
import { videoDirectionSourceKey, recoverReorderedObjectDirection, currentChineseVideoDirection } from '@/lib/videoDirection';
import { persistGeneratedStoryboardImage } from '@/lib/generatedImagePersistence';

async function persistLocalGeneratedImage(
  imageUrl: string,
  settings?: Parameters<typeof comfyUIApiUrl>[1],
): Promise<string> {
  return persistGeneratedStoryboardImage(imageUrl, (url, init) =>
    fetch(typeof url === 'string' ? comfyUIApiUrl(url, settings) : url, init));
}
import { analyzeImagePromptSafety, extractImageTaskError, imageSafetyReasonLabel, isImageSafetyRejection, rewriteImagePromptForSafety } from '@/lib/imagePromptSafety';
import { normalizeSavedImageFailureReason, planInterruptedGridRecovery, preserveCompletedGridArtifacts } from '@/lib/gridRecovery';
import { storyboardSpeech } from '@/lib/speechAudioContract';
import { castCharacterVoice, castStoryVoices, lockStoryboardVoiceIds } from '@/lib/voiceCasting';
import { applyStoryAspectRatio, hasStoryMedia, projectStoryAspectRatio, type StoryAspectRatio } from '@/lib/storyAspectRatio';
import { storyStorageKeys } from '@/lib/series/storageScope';
import { bindSeriesPlan, buildApprovedSeriesPlan, reconcileSeriesProductionContract, validateSeriesProduction } from '@/lib/series/productionContract';
import { visibleImageCast, type ImageCastCharacter } from '@/lib/series/imageCastContract';
import { AwaitingMediaTaskError, autoProductionLockName, autoRetryDelayMs, hasUsableStoryboardImage, imagePollingTimeoutError, isTransientAutoProductionError, normalizeStoryboardImageArtifact, planAutoImageBatch, planAutoVideoBatches } from '@/lib/autoProduction';
import { effectiveStoryCast } from '@/lib/storyCast';
import { characterAliasValues, characterIdentityIndex, withoutCharacterValues } from '@/lib/characterIdentity';
import { recoverSeriesStoryAliases } from '@/lib/series/storyCastRecovery';
import { canonicalizeStoryIdentities } from '@/lib/pipeline/storyIdentity';
import { resolveMidjourneyProfileSetting, resolveMidjourneyStyleSetting } from '@/lib/midjourney';
import { applyCapturePreset, DEFAULT_CAPTURE_PRESET, normalizeCapturePreset } from '@/lib/capturePresets';
import { completeProductionTiming, formatProductionElapsed, normalizeProductionTiming, pauseProductionTiming, productionElapsedMs, startProductionTiming } from '@/lib/productionTiming';
import { isFalVideoTask } from '@/lib/falVideo';
import { mergeRegeneratedVisualPrompts } from '@/lib/visualPromptRewrite';

async function makePortableMediaSource(source: string, label: string, inlineRemote = false): Promise<string> {
  if (source.startsWith('data:')) return source;
  if (!source.startsWith('blob:') && (!inlineRemote || !/^https?:\/\//i.test(source))) return source;

  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(source, {
        cache: source.startsWith('http') ? 'force-cache' : 'default',
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      break;
    } catch (error) {
      lastError = error;
      response = undefined;
      if (attempt < 4) await new Promise(resolve => window.setTimeout(resolve, attempt * 800));
    }
  }
  if (!response) {
    throw new Error(`${label}读取失败：${lastError instanceof Error ? lastError.message : '网络连接中断'}`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error(`${label}内容为空`);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error(`${label}转换失败`));
    reader.onerror = () => reject(new Error(`${label}转换失败`));
    reader.readAsDataURL(blob);
  });
}

class TerminalVideoTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalVideoTaskError';
  }
}

class TerminalImageTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalImageTaskError';
  }
}

function clearGeneratedVideo(storyboard: Storyboard): Storyboard {
  return {
    ...storyboard,
    videoUrl: undefined,
    videoSourceUrl: undefined,
    videoCacheKey: undefined,
    videoCacheStatus: undefined,
    videoCachedAt: undefined,
    videoTaskId: undefined,
    videoStatus: 'pending',
    videoSegmentId: undefined,
    videoSegmentStoryboardIds: undefined,
    videoGenerationSignature: undefined,
  };
}

function replaceStoryboardAndInvalidateChangedVideo(current: Storyboard[], updated: Storyboard): Storyboard[] {
  const previous = current.find(item => item.id === updated.id);
  if (!previous) return current;
  if (videoSegmentGenerationSignature([previous]) === videoSegmentGenerationSignature([updated])) {
    return current.map(item => item.id === updated.id ? updated : item);
  }

  const previousSegmentId = previous.videoSegmentId;
  return current.map(item => {
    if (item.id === updated.id) return clearGeneratedVideo(updated);
    if (previousSegmentId && item.videoSegmentId === previousSegmentId) return clearGeneratedVideo(item);
    return item;
  });
}

function autoProductionStorageKey() { return storyStorageKeys().auto; }

type SavedAutoProduction = {
  projectId: string;
  status: 'running' | 'paused';
  updatedAt: number;
};

function savedAutoProduction(): SavedAutoProduction | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(autoProductionStorageKey()) || 'null');
    if (typeof saved?.projectId !== 'string') return undefined;
    return {
      projectId: saved.projectId,
      status: saved.status === 'paused' ? 'paused' : 'running',
      updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : 0,
    };
  } catch {
    return undefined;
  }
}

function savedAutoProductionProjectId(): string | undefined {
  return savedAutoProduction()?.projectId;
}

function markAutoProduction(projectId: string, status: 'running' | 'paused' = 'running'): void {
  try {
    localStorage.setItem(autoProductionStorageKey(), JSON.stringify({ projectId, status, updatedAt: Date.now() }));
  } catch {}
}

function clearAutoProduction(projectId: string): void {
  try {
    if (savedAutoProductionProjectId() === projectId) localStorage.removeItem(autoProductionStorageKey());
  } catch {}
}

export default function StoryPage() {
  const batchRunId = typeof window === 'undefined'
    ? ''
    : new URLSearchParams(window.location.search).get('batchRunId') || '';
  const batchStageRetries = typeof window === 'undefined'
    ? 3
    : Math.min(5, Math.max(1, Number(new URLSearchParams(window.location.search).get('stageRetries')) || 3));
  const postBatchEvent = (payload: Record<string, unknown>) => {
    if (!batchRunId || window.parent === window) return;
    window.parent.postMessage({ type: 'aid-story-batch', runId: batchRunId, ...payload }, window.location.origin);
  };
  useEffect(() => {
    if (!storyStorageKeys().isolated) return;
    const saved = (event: Event) => postBatchEvent({ event: 'checkpoint', project: (event as CustomEvent).detail });
    window.addEventListener('aid-series-project-saved', saved);
    // Headless production must not get stuck on an invisible alert dialog.
    const originalAlert = window.alert;
    window.alert = message => postBatchEvent({ event: 'failed', error: String(message) });
    return () => { window.removeEventListener('aid-series-project-saved', saved); window.alert = originalAlert; };
  }, [batchRunId]);
  const { projectId, projectName, setProjectName, saveProject, loadProject, exportProject, adoptProjectId, newProject } = useProject();
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [isCanvasMode, setIsCanvasMode] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [objects, setObjects] = useState<ObjectItem[]>([]);
  const [storyContent, setStoryContent] = useState('');
  const [projectLanguage, setProjectLanguage] = useState<'zh' | 'en'>('zh');
  const [targetShotCount, setTargetShotCount] = useState(DEFAULT_TARGET_SHOT_COUNT);
  const [projectAspectRatio, setProjectAspectRatio] = useState<StoryAspectRatio>('16:9');
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('follow-reference');
  const [capturePreset, setCapturePreset] = useState<CapturePreset>('follow-reference');
  const [productionTiming, setProductionTiming] = useState<ProjectProductionTiming>();
  const [productionClock, setProductionClock] = useState(() => Date.now());
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [storyPlan, setStoryPlan] = useState<StoryPlan | undefined>();
  const [videoSegmentPlan, setVideoSegmentPlan] = useState<VideoSegmentPlan | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [scriptGenerationPhase, setScriptGenerationPhase] = useState<ScriptGenerationPhase>('idle');
  const [costumeImages, setCostumeImages] = useState<Record<string, string>>({}); // { 角色名: URL }
  const [costumeGenerating, setCostumeGenerating] = useState<Record<string, boolean>>({}); // { 角色名: bool }
  const [voiceReferences, setVoiceReferences] = useState<Record<string, string>>(); // { 角色名: Cloudinary URL }
  const [voiceGenerating, setVoiceGenerating] = useState<Record<string, boolean>>({}); // { 角色名: bool }
  const [sceneImages, setSceneImages] = useState<string[]>([]);
  const styleReferenceRef = useRef<ImageStyleReference>();
  const [sceneGenerating, setSceneGenerating] = useState(false);
  const [isGeneratingGrid, setIsGeneratingGrid] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [autoStage, setAutoStage] = useState('');
  const [autoExportRequestId, setAutoExportRequestId] = useState(0);
  const [autoResumeRequested, setAutoResumeRequested] = useState(false);
  const autoAbortRef = useRef(false);
  const autoRunLockRef = useRef(false);
  const autoOwnsCrossTabLeaseRef = useRef(false);
  const autoLeaseRetryTimerRef = useRef<number>();
  const autoResumeAfterPauseTimerRef = useRef<number>();
  const autoExportCompletionRef = useRef<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>();
  const videoRecoveryRef = useRef(new Set<string>());
  const activeVideoPollsRef = useRef(new Map<string, Promise<void>>());
  const gridRecoveryRef = useRef(new Set<string>());
  const prepareImageRequestRef = useRef(createStoryImageRequestPreparer());
  const assetPreparationRef = useRef<{ projectId: string; promise: Promise<void> }>();
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  useEffect(() => {
    setProductionClock(Date.now());
    if (productionTiming?.status !== 'running') return;
    const timer = window.setInterval(() => setProductionClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [productionTiming?.status, productionTiming?.startedAt, productionTiming?.pausedDurationMs]);

  const cacheCompletedVideo = async (
    storyboardId: string,
    sourceUrl: string,
    segmentStoryboardIds: string[] = [storyboardId],
    cacheProjectId = projectId,
    generationSignature?: string,
    generationId?: string,
  ): Promise<string> => {
    const cacheKey = videoCacheKeyForStoryboard(cacheProjectId, storyboardId, generationSignature, generationId);
    if (cacheProjectId !== projectIdRef.current) return sourceUrl;
    commitStoryboards(prev => prev.map(sb => segmentStoryboardIds.includes(sb.id) ? {
      ...sb,
      videoStatus: 'completed',
      ...(sb.id === storyboardId ? {
        videoUrl: sourceUrl,
        videoSourceUrl: sourceUrl.startsWith('http') ? sourceUrl : sb.videoSourceUrl,
        videoCacheKey: cacheKey,
        videoGenerationSignature: generationSignature || sb.videoGenerationSignature,
        videoCacheStatus: 'caching' as const,
      } : {}),
    } : sb));

    try {
      void requestPersistentVideoStorage();
      const cached = await cacheVideoSource(cacheKey, sourceUrl);
      if (cacheProjectId !== projectIdRef.current) return cached.objectUrl;
      const cachedAt = new Date().toISOString();
      commitStoryboards(prev => prev.map(sb => segmentStoryboardIds.includes(sb.id) ? {
        ...sb,
        videoStatus: 'completed',
        ...(sb.id === storyboardId ? {
          videoUrl: cached.objectUrl,
          videoSourceUrl: sourceUrl.startsWith('http') ? sourceUrl : sb.videoSourceUrl,
          videoCacheKey: cacheKey,
          videoGenerationSignature: generationSignature || sb.videoGenerationSignature,
          videoCacheStatus: 'completed' as const,
          videoCachedAt: cachedAt,
        } : {}),
      } : sb));
      persistCurrentProject();
      return cached.objectUrl;
    } catch (error) {
      console.error(`场景 ${storyboardId} 本地视频缓存失败:`, error);
      if (cacheProjectId !== projectIdRef.current) return sourceUrl;
      commitStoryboards(prev => prev.map(sb => sb.id === storyboardId ? {
        ...sb,
        videoStatus: 'completed',
        videoUrl: sourceUrl,
        videoSourceUrl: sourceUrl.startsWith('http') ? sourceUrl : sb.videoSourceUrl,
        videoCacheKey: cacheKey,
        videoCacheStatus: 'failed',
      } : sb));
      return sourceUrl;
    }
  };

  const recoverProjectVideos = async (sourceStoryboards: Storyboard[], cacheProjectId: string) => {
    for (const storyboard of sourceStoryboards) {
      // Probe the deterministic cache key for every shot. This also recovers a
      // clip completed less than 30 seconds before refresh, before autosave had
      // time to persist its final videoStatus/cache metadata.
      const recoveryKey = `${cacheProjectId}:${storyboard.id}`;
      if (videoRecoveryRef.current.has(recoveryKey)) continue;
      if (storyboard.videoSegmentId && !storyboard.videoSegmentStoryboardIds?.length) continue;
      videoRecoveryRef.current.add(recoveryKey);
      const segmentIds = storyboard.videoSegmentStoryboardIds?.length ? storyboard.videoSegmentStoryboardIds : [storyboard.id];
      // Never probe the old `storyboard-video:scene-N` keys here. Those keys
      // had no project namespace, so a fresh project could restore another
      // project's clip simply because both contain `scene-1`.
      const generationSignature = storyboard.videoGenerationSignature;
      const generationId = storyboard.videoTaskId && (isComfyUIClientTask(storyboard.videoTaskId) || isFalVideoTask(storyboard.videoTaskId))
        ? storyboard.videoTaskId
        : undefined;
      const cacheKey = videoCacheKeyForStoryboard(cacheProjectId, storyboard.id, generationSignature, generationId);
      try {
        // A regenerated clip can have the same creative signature as its old
        // render. Only trust a persisted cache when it was written for this
        // exact paid task; otherwise resume the newer task before probing the
        // old deterministic cache and accidentally restoring stale video.
        if (generationId && storyboard.videoCacheKey !== cacheKey) {
          if (cacheProjectId !== projectIdRef.current) continue;
          setStoryboards(prev => {
            const next = prev.map(sb => segmentIds.includes(sb.id) ? {
              ...sb,
              videoStatus: 'generating' as const,
            } : sb);
            storyboardsRef.current = next;
            return next;
          });
          void pollVideoStatus(
            storyboard.id,
            generationId,
            segmentIds,
            cacheProjectId,
            generationSignature,
          ).catch(error => {
            console.warn(`场景 ${storyboard.sceneNumber} 视频恢复失败:`, error);
            if (cacheProjectId !== projectIdRef.current) return;
            setStoryboards(prev => {
              const next = prev.map(sb => segmentIds.includes(sb.id) ? {
                ...sb,
                videoStatus: 'failed' as const,
                videoUrl: sb.videoUrl?.startsWith('blob:') ? undefined : sb.videoUrl,
                videoCacheKey: cacheKey,
                videoCacheStatus: 'failed' as const,
              } : sb);
              storyboardsRef.current = next;
              return next;
            });
          });
          continue;
        }

        const cachedUrl = await cachedVideoObjectUrl(cacheKey);
        if (cachedUrl) {
          if (cacheProjectId !== projectIdRef.current) continue;
          setStoryboards(prev => prev.map(sb => segmentIds.includes(sb.id) ? {
            ...sb,
            videoStatus: 'completed',
            ...(sb.id === storyboard.id ? {
              videoUrl: cachedUrl,
              videoCacheKey: cacheKey,
              videoGenerationSignature: generationSignature,
              videoCacheStatus: 'completed' as const,
            } : {}),
          } : sb));
          continue;
        }

        const remoteUrl = storyboard.videoSourceUrl
          || (storyboard.videoUrl?.startsWith('http') ? storyboard.videoUrl : undefined);
        if (remoteUrl) {
          await cacheCompletedVideo(storyboard.id, remoteUrl, segmentIds, cacheProjectId, generationSignature, generationId);
          continue;
        }

        // Resume the saved ComfyUI task instead of downloading immediately.
        // A refresh can happen while ComfyUI is still processing; the old
        // implementation treated "视频仍在生成中" as a recovery failure and
        // permanently stranded the UI in the generating state even after the
        // remote task subsequently completed.
        if (storyboard.videoTaskId && (isComfyUIClientTask(storyboard.videoTaskId) || isFalVideoTask(storyboard.videoTaskId))) {
          if (cacheProjectId !== projectIdRef.current) continue;
          setStoryboards(prev => {
            const next = prev.map(sb => segmentIds.includes(sb.id) ? {
              ...sb,
              videoStatus: 'generating' as const,
            } : sb);
            storyboardsRef.current = next;
            return next;
          });
          // Attach every saved task at once. Waiting for the first remote job
          // before watching the next one makes later completed segments look
          // stuck for minutes even though their files are already available.
          void pollVideoStatus(storyboard.id, storyboard.videoTaskId, segmentIds, cacheProjectId, generationSignature).catch(error => {
            console.warn(`场景 ${storyboard.sceneNumber} 视频恢复失败:`, error);
            if (cacheProjectId !== projectIdRef.current) return;
            setStoryboards(prev => {
              const next = prev.map(sb => segmentIds.includes(sb.id) ? {
                ...sb,
                videoStatus: 'failed' as const,
                videoUrl: sb.videoUrl?.startsWith('blob:') ? undefined : sb.videoUrl,
                videoCacheKey: cacheKey,
                videoCacheStatus: 'failed' as const,
              } : sb);
              storyboardsRef.current = next;
              return next;
            });
          });
          continue;
        }
      } catch (error) {
        console.warn(`场景 ${storyboard.sceneNumber} 视频恢复失败:`, error);
        if (cacheProjectId !== projectIdRef.current) continue;
        const isTaskRecovery = Boolean(storyboard.videoTaskId && (isComfyUIClientTask(storyboard.videoTaskId) || isFalVideoTask(storyboard.videoTaskId)));
        setStoryboards(prev => prev.map(sb => segmentIds.includes(sb.id) ? {
          ...sb,
          videoUrl: sb.videoUrl?.startsWith('blob:') ? undefined : sb.videoUrl,
          videoCacheKey: cacheKey,
          videoCacheStatus: 'failed',
          ...(isTaskRecovery ? { videoStatus: 'failed' as const } : {}),
        } : sb));
      }
    }
  };

  // 全自动编排需要读取「最新」状态（避免长异步闭包里的旧值）
  const storyboardsRef = useRef(storyboards);
  const charactersRef = useRef(characters);
  const objectsRef = useRef(objects);
  const costumeImagesRef = useRef(costumeImages);
  const voiceReferencesRef = useRef(voiceReferences);
  const sceneImagesRef = useRef(sceneImages);
  const settingsRef = useRef(settings);
  const projectLanguageRef = useRef<'zh' | 'en'>(projectLanguage);
  const projectLanguageLockedRef = useRef(false);
  const projectAspectRatioRef = useRef<StoryAspectRatio>(projectAspectRatio);
  const projectAspectLockedRef = useRef(false);
  const videoSegmentPlanRef = useRef(videoSegmentPlan);
  const storyPlanRef = useRef(storyPlan);
  const capturePresetRef = useRef<CapturePreset>(capturePreset);
  const productionTimingRef = useRef<ProjectProductionTiming>();
  const commitStoryboards = (updater: (current: Storyboard[]) => Storyboard[]) => {
    setStoryboards(current => {
      const next = updater(current);
      // Long-running auto generation immediately starts the following H3
      // segment. Keep the ref synchronized in the same update so continuity
      // never reads the previous render's video URL.
      storyboardsRef.current = next;
      return next;
    });
  };
  useEffect(() => {
    storyboardsRef.current = storyboards;
    charactersRef.current = characters;
    objectsRef.current = objects;
    costumeImagesRef.current = costumeImages;
    voiceReferencesRef.current = voiceReferences;
    sceneImagesRef.current = sceneImages;
    settingsRef.current = settings;
    projectLanguageRef.current = projectLanguage;
    projectAspectRatioRef.current = projectAspectRatio;
    videoSegmentPlanRef.current = videoSegmentPlan;
    storyPlanRef.current = storyPlan;
    capturePresetRef.current = capturePreset;
    productionTimingRef.current = productionTiming;
  }, [storyboards, characters, objects, costumeImages, voiceReferences, sceneImages, settings, projectLanguage, projectAspectRatio, videoSegmentPlan, storyPlan, capturePreset, productionTiming]);

  const persistCurrentProject = (nextStoryboards = storyboardsRef.current) => {
    saveProject({
      characters: charactersRef.current,
      objects: objectsRef.current,
      storyContent,
      language: projectLanguageRef.current,
      targetShotCount,
      aspectRatio: projectAspectRatioRef.current,
      visualStyle,
      capturePreset: capturePresetRef.current,
      productionTiming: productionTimingRef.current,
      storyOutline: '',
      storyboards: nextStoryboards,
      voiceReferences: voiceReferencesRef.current,
      costumeImages: costumeImagesRef.current,
      sceneImages: sceneImagesRef.current,
      styleReference: styleReferenceRef.current,
      storyPlan: storyPlanRef.current,
      videoSegmentPlan: videoSegmentPlanRef.current,
      createdAt: new Date().toISOString(),
    });
  };

  const currentCastVoiceReferences = () => characterAliasValues(voiceReferencesRef.current,
    effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters));

  const recoverSavedCastAliases = async (storyId: string) => {
    if (!storyId?.startsWith('series-')) return;
    try {
      const response = await fetch(comfyUIApiUrl('/api/companion/series', settingsRef.current.comfyui), {
        cache: 'no-store', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return;
      const snapshot = await response.json();
      if (projectIdRef.current !== storyId || !Array.isArray(snapshot.projects)) return;
      const current = charactersRef.current;
      const recovered = recoverSeriesStoryAliases(storyId, current, snapshot.projects);
      if (!recovered.some((character, index) => character !== current[index])) return;
      charactersRef.current = recovered;
      setCharacters(recovered);
      const voiceCast = effectiveStoryCast(recovered, storyPlanRef.current?.characters);
      const boards = lockStoryboardVoiceIds(storyboardsRef.current, voiceCast);
      storyboardsRef.current = boards;
      setStoryboards(boards);
      const plan = videoSegmentPlanRef.current;
      if (plan) {
        const rebound = { ...plan, segments: lockStoryboardVoiceIds(plan.segments, voiceCast) };
        videoSegmentPlanRef.current = rebound;
        setVideoSegmentPlan(rebound);
      }
      // Normal autosave persists this metadata. Do not save an old captured
      // screenplay here: the user may have edited it while the GET was pending.
    } catch {
      // Offline standalone Story remains usable; no voice is guessed.
    }
  };

  useEffect(() => {
    if (!batchRunId || !autoStage) return;
    postBatchEvent({
      event: 'progress',
      projectId: projectIdRef.current,
      stage: autoStage,
      completedImages: storyboardsRef.current.filter(item => item.status === 'completed').length,
      totalImages: storyboardsRef.current.length,
      completedVideos: storyboardsRef.current.filter(item => item.videoStatus === 'completed').length,
    });
    // batchRunId identifies one immutable iframe run; refs carry live counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchRunId, autoStage]);

  useEffect(() => {
    if (!projectLanguageLockedRef.current) {
      const language = settings.language === 'en' ? 'en' : 'zh';
      projectLanguageRef.current = language;
      setProjectLanguage(language);
    }
  }, [settings.language]);

  useEffect(() => {
    if (!projectAspectLockedRef.current) {
      const ratio = projectStoryAspectRatio(undefined, [], settings.aspectRatio);
      projectAspectRatioRef.current = ratio;
      setProjectAspectRatio(ratio);
    }
  }, [settings.aspectRatio]);

  useEffect(() => {
    const savedProject = loadProject();
    if (savedProject) {
      projectIdRef.current = savedProject.id!;
      const savedLanguageForVoice = savedProject.language === 'en' ? 'en' : 'zh';
      const savedCharacters = castStoryVoices((savedProject.characters || []) as Character[], savedLanguageForVoice);
      const savedStoryPlan = savedProject.storyPlan ? canonicalizeStoryIdentities({
        ...savedProject.storyPlan,
        characters: castStoryVoices(savedProject.storyPlan.characters || [], savedLanguageForVoice),
      }, savedCharacters) : undefined;
      const savedObjects = savedProject.objects || [];
      const savedCostumeImages = savedProject.costumeImages || {};
      const savedSceneImages = savedProject.sceneImages || [];
      styleReferenceRef.current = savedProject.styleReference;
      charactersRef.current = savedCharacters;
      objectsRef.current = savedObjects;
      costumeImagesRef.current = savedCostumeImages;
      const savedVoiceReferences = currentVoiceReferences(savedProject.voiceReferences);
      voiceReferencesRef.current = savedVoiceReferences;
      sceneImagesRef.current = savedSceneImages;
      setCharacters(savedCharacters);
      setObjects(savedObjects);
      setStoryContent(savedProject.storyContent || '');
      const savedLanguage = savedProject.language === 'en' || savedProject.language === 'zh' ? savedProject.language : undefined;
      projectLanguageLockedRef.current = Boolean(savedLanguage);
      if (savedLanguage) {
        projectLanguageRef.current = savedLanguage;
        setProjectLanguage(savedLanguage);
      }
      setTargetShotCount(storyStorageKeys().isolated
        ? Math.max(1, Math.min(81, Math.trunc(Number(savedProject.targetShotCount) || DEFAULT_TARGET_SHOT_COUNT)))
        : normalizeTargetShotCount(savedProject.targetShotCount));
      const savedAspectRatio = projectStoryAspectRatio(savedProject.aspectRatio, savedProject.storyboards || [], settings.aspectRatio);
      projectAspectLockedRef.current = Boolean(
        savedProject.aspectRatio
        || (savedProject.storyboards || []).some(item => item.aspectRatio),
      );
      projectAspectRatioRef.current = savedAspectRatio;
      setProjectAspectRatio(savedAspectRatio);
      setVisualStyle(normalizeVisualStyle(savedProject.visualStyle || settings.visualStyle));
      const savedCapturePreset = normalizeCapturePreset(savedProject.capturePreset);
      capturePresetRef.current = savedCapturePreset;
      setCapturePreset(savedCapturePreset);
      const savedProductionTiming = normalizeProductionTiming(savedProject.productionTiming);
      productionTimingRef.current = savedProductionTiming;
      setProductionTiming(savedProductionTiming);
      const savedEffectiveVoiceCast = effectiveStoryCast(savedCharacters, savedStoryPlan?.characters);
      const normalizedStoryboards = lockStoryboardVoiceIds<Storyboard>((savedProject.storyboards || []).map(item => normalizeStoryboardImageArtifact({
        ...recoverReorderedObjectDirection(item),
        aspectRatio: savedAspectRatio,
        capturePreset: normalizeCapturePreset(item.capturePreset || savedProject.capturePreset),
        imageFailureReason: normalizeSavedImageFailureReason(item.imageFailureReason)
          || (item.status === 'failed' ? '上次分镜生成未完成；请重新生成，系统会定位具体原因并自动修正可恢复的提示词问题' : undefined),
      })), savedEffectiveVoiceCast);
      // `generating` is only recoverable after Companion has returned a
      // durable task id. If the page was refreshed (or a request failed)
      // before that point, unlock the segment instead of showing a fake job
      // forever while the ComfyUI queue is empty.
      const savedStoryboards = releaseUnsubmittedVideoGenerations(normalizedStoryboards);
      storyboardsRef.current = savedStoryboards;
      setStoryboards(savedStoryboards);
      if (savedStoryboards !== normalizedStoryboards) {
        saveProject({
          ...savedProject,
          name: savedProject.name,
          storyboards: savedStoryboards,
          createdAt: savedProject.createdAt,
        });
      }
      void recoverProjectVideos(savedStoryboards, savedProject.id!);
      // A refresh used to strand a paid grid task in "generating" forever.
      // New tasks are 2×2. A missing size marker identifies a pre-upgrade 3×3
      // task, which must retain its original nine-shot crop boundary.
      const recoveryGroups: Array<{ group: Storyboard[]; gridSize: 2 | 3 }> = [];
      const seenRecoveryStarts = new Set<string>();
      savedStoryboards.forEach((item, index) => {
        if (item.imageTaskMode === 'single' || hasUsableStoryboardImage(item)) return;
        if (item.status !== 'generating' && !item.taskId) return;
        const gridSize: 2 | 3 = item.imageGridSize === 2 ? 2 : 3;
        const capacity = gridSize * gridSize;
        const start = Math.floor(index / capacity) * capacity;
        const key = `${gridSize}:${start}`;
        if (seenRecoveryStarts.has(key)) return;
        seenRecoveryStarts.add(key);
        recoveryGroups.push({ group: savedStoryboards.slice(start, start + capacity), gridSize });
      });
      for (const { group, gridSize } of recoveryGroups) {
        const gridRecoveryGroup = group.filter(item => item.imageTaskMode !== 'single');
        const recoveryPlan = planInterruptedGridRecovery(gridRecoveryGroup);
        // Completed mixed grid/single-image batches are authoritative. Never
        // re-split their old mother grid on refresh: that replaces repairs and
        // invalidates already paid videos merely because crop URLs change.
        if (recoveryPlan.kind === 'release') {
          const groupIds = new Set(group.filter(item => item.status === 'generating').map(item => item.id));
          setStoryboards(current => {
            const next = current.map(item => groupIds.has(item.id) ? {
              ...item,
              status: 'failed' as const,
              taskId: undefined,
              imageTaskMode: undefined,
              imageGridSize: undefined,
              imageFailureReason: recoveryPlan.reason,
            } : item);
            storyboardsRef.current = next;
            return next;
          });
        }
        const recoverableTaskId = recoveryPlan.kind === 'resume' ? recoveryPlan.taskId : undefined;
        if (recoverableTaskId) {
          const taskId = recoverableTaskId;
          const recoveryKey = `${savedProject.id}:${taskId}`;
          if (!gridRecoveryRef.current.has(recoveryKey)) {
            gridRecoveryRef.current.add(recoveryKey);
            window.setTimeout(async () => {
              try {
                // Project data and settings are restored by separate hooks.
                // Wait for the latest settings ref instead of capturing the
                // initial empty API key and showing a false configuration alert.
                for (let attempt = 0; attempt < 40 && imageModelRequiresApiKey(settingsRef.current.imageModel) && !settingsRef.current.apiKey; attempt++) {
                  await new Promise(resolve => window.setTimeout(resolve, 250));
                }
                const recoveryApiKey = settingsRef.current.apiKey;
                if (isMidjourneyImageModel(settingsRef.current.imageModel)) {
                  await handleGenerateGrid(group);
                  return;
                }
                if (imageModelRequiresApiKey(settingsRef.current.imageModel) && !recoveryApiKey) throw new Error('APIMart API Key 尚未加载');
                const response = await fetch(imageApiUrl('/api/check-image-status', settingsRef.current.comfyui, taskId), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId, apiKey: recoveryApiKey, comfyui: localComfyUISettings(settingsRef.current.comfyui) })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                const recoverable = data.status === 'completed'
                  || data.status === 'processing'
                  || data.status === 'pending'
                  || data.status === 'running'
                  || data.status === 'queued';
                if (!recoverable) throw new Error(extractImageTaskError(data) || `任务状态 ${data.status || 'unknown'}`);
                void handleGenerateGrid(group, { resumeTaskId: taskId, gridSize });
              } catch (error) {
                console.warn(`四宫格任务 ${taskId} 已失效，允许重新生成:`, error);
                if (savedProject.id !== projectIdRef.current) return;
                const groupIds = new Set(group.filter(item => !hasUsableStoryboardImage(item)).map(item => item.id));
                const recoveryFailureReason = `刷新后恢复任务失败：${extractImageTaskError(error)}；已解除锁定，请重新生成本批`;
                setStoryboards(current => {
                  const next = current.map(item => groupIds.has(item.id) ? {
                    ...item,
                    status: 'failed' as const,
                    taskId: undefined,
                    imageTaskMode: undefined,
                    imageGridSize: undefined,
                    imageFailureReason: recoveryFailureReason,
                  } : item);
                  storyboardsRef.current = next;
                  return next;
                });
              }
            }, 250);
          }
        }
      }
      setVoiceReferences(savedVoiceReferences);
      setCostumeImages(savedCostumeImages);
      setSceneImages(savedSceneImages);
      setStoryPlan(savedStoryPlan);
      storyPlanRef.current = savedStoryPlan;
      const savedVideoSegmentPlan = savedStoryboards.length
        ? normalizeVideoSegmentPlan(savedStoryboards, savedProject.videoSegmentPlan, savedLanguageForVoice)
        : undefined;
      setVideoSegmentPlan(savedVideoSegmentPlan);
      videoSegmentPlanRef.current = savedVideoSegmentPlan;
      if (savedVideoSegmentPlan && JSON.stringify(savedVideoSegmentPlan) !== JSON.stringify(savedProject.videoSegmentPlan)) {
        saveProject({
          ...savedProject,
          name: savedProject.name,
          storyboards: savedStoryboards,
          videoSegmentPlan: savedVideoSegmentPlan,
          createdAt: savedProject.createdAt,
        });
      }
      const savedAuto = savedAutoProduction();
      if (savedAuto && savedAuto.projectId === savedProject.id) {
        if (savedAuto.status === 'running') setAutoResumeRequested(true);
        else setAutoPaused(true);
      }
      if (savedProject.storyboards?.length > 0) setCurrentStep(restoredStoryStep(savedStoryboards, savedVideoSegmentPlan));
      else if (savedProject.storyContent && savedProject.characters?.length > 0) setCurrentStep(2);
      void recoverSavedCastAliases(savedProject.id!);
    }
  }, [loadProject]);

  useEffect(() => {
    const timer = setInterval(() => {
      const savedAuto = savedAutoProduction();
      // A stale tab must never overwrite the storyboard/video task ids being
      // persisted by the one tab that owns this project's orchestration lock.
      if (savedAuto?.projectId === projectIdRef.current
        && savedAuto.status === 'running'
        && !autoOwnsCrossTabLeaseRef.current) return;
      if (characters.length > 0 || storyContent || storyboards.length > 0) {
        saveProject({ characters, objects, storyContent, language: projectLanguage, targetShotCount, aspectRatio: projectAspectRatio, visualStyle, capturePreset, productionTiming: productionTimingRef.current, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, styleReference: styleReferenceRef.current, storyPlan, videoSegmentPlan, createdAt: new Date().toISOString() });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [characters, objects, storyContent, projectLanguage, targetShotCount, projectAspectRatio, visualStyle, capturePreset, productionTiming, storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, videoSegmentPlan, saveProject]);

  const handleSave = () => {
    saveProject({ characters, objects, storyContent, language: projectLanguage, targetShotCount, aspectRatio: projectAspectRatio, visualStyle, capturePreset, productionTiming: productionTimingRef.current, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, styleReference: styleReferenceRef.current, storyPlan, videoSegmentPlan, createdAt: new Date().toISOString() });
    alert('Project saved!');
  };

  const handleVideoSegmentPlanChange = (plan: VideoSegmentPlan) => {
    if (productionTimingRef.current?.status === 'completed') {
      productionTimingRef.current = undefined;
      setProductionTiming(undefined);
    }
    videoSegmentPlanRef.current = plan;
    setVideoSegmentPlan(plan);
    // Director edits are explicit user decisions. Persist immediately instead
    // of waiting for the 30-second autosave window, so an immediate refresh
    // cannot silently replace the manual schedule with a new AI suggestion.
    saveProject({
      characters,
      objects,
      storyContent,
      language: projectLanguage,
      targetShotCount,
      aspectRatio: projectAspectRatio,
      visualStyle,
      capturePreset,
      productionTiming: productionTimingRef.current,
      storyOutline: '',
      storyboards: storyboardsRef.current,
      voiceReferences: voiceReferencesRef.current,
      costumeImages: costumeImagesRef.current,
      sceneImages: sceneImagesRef.current,
      styleReference: styleReferenceRef.current,
      storyPlan,
      videoSegmentPlan: plan,
      createdAt: new Date().toISOString(),
    });
  };

  const handleVoiceCastChange = (characterName: string, patch: VoiceCastPatch) => {
    const uploaded = charactersRef.current.find(character => character.name === characterName);
    const planned = storyPlanRef.current?.characters.find(character => character.name === characterName);
    if (!uploaded && !planned) return;

    const base = {
      ...planned,
      ...uploaded,
      name: characterName,
      description: uploaded?.description || [planned?.role, planned?.voiceProfile].filter(Boolean).join('；'),
    };
    const wantsAutomatic = patch.voiceSource === 'auto';
    const resolved = wantsAutomatic
      ? castCharacterVoice({ ...base, ...patch, voiceId: undefined, voiceSource: 'auto' }, projectLanguageRef.current)
      : { ...base, ...patch, voiceId: String(patch.voiceId ?? base.voiceId ?? '').trim(), voiceSource: 'user' as const };

    const nextCharacters = charactersRef.current.map(character => character.name === characterName ? {
      ...character,
      gender: resolved.gender,
      ageGroup: resolved.ageGroup,
      voiceId: resolved.voiceId || undefined,
      voiceProfile: resolved.voiceProfile,
      voiceSource: resolved.voiceSource,
    } : character);
    charactersRef.current = nextCharacters;
    setCharacters(nextCharacters);

    const currentPlan = storyPlanRef.current;
    const nextPlan = currentPlan ? {
      ...currentPlan,
      characters: currentPlan.characters.map(character => character.name === characterName ? {
        ...character,
        gender: resolved.gender,
        ageGroup: resolved.ageGroup,
        voiceId: resolved.voiceId || undefined,
        voiceProfile: resolved.voiceProfile,
        voiceSource: resolved.voiceSource,
      } : character),
    } : undefined;
    storyPlanRef.current = nextPlan;
    setStoryPlan(nextPlan);

    const effectiveCast = effectiveStoryCast(nextCharacters, nextPlan?.characters);
    const nextStoryboards = lockStoryboardVoiceIds(storyboardsRef.current, effectiveCast);
    storyboardsRef.current = nextStoryboards;
    setStoryboards(nextStoryboards);
    const currentVideoPlan = videoSegmentPlanRef.current;
    const nextVideoPlan = currentVideoPlan ? {
      ...currentVideoPlan,
      segments: lockStoryboardVoiceIds(currentVideoPlan.segments, effectiveCast),
      updatedAt: new Date().toISOString(),
    } : undefined;
    videoSegmentPlanRef.current = nextVideoPlan;
    setVideoSegmentPlan(nextVideoPlan);

    const previousVoiceId = uploaded?.voiceId || planned?.voiceId;
    let nextVoiceReferences = voiceReferencesRef.current;
    if (previousVoiceId !== resolved.voiceId) {
      nextVoiceReferences = withoutCharacterValues(nextVoiceReferences, characterName, effectiveCast);
      voiceReferencesRef.current = nextVoiceReferences;
      setVoiceReferences(nextVoiceReferences);
    }

    saveProject({
      characters: nextCharacters,
      objects: objectsRef.current,
      storyContent,
      language: projectLanguageRef.current,
      targetShotCount,
      aspectRatio: projectAspectRatioRef.current,
      visualStyle,
      capturePreset,
      productionTiming: productionTimingRef.current,
      storyOutline: '',
      storyboards: nextStoryboards,
      voiceReferences: nextVoiceReferences,
      costumeImages: costumeImagesRef.current,
      sceneImages: sceneImagesRef.current,
      styleReference: styleReferenceRef.current,
      storyPlan: nextPlan,
      videoSegmentPlan: nextVideoPlan,
      createdAt: new Date().toISOString(),
    });
  };

  const handleOpen = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const importedProjectId = adoptProjectId(data.id);
        projectIdRef.current = importedProjectId;
        autoAbortRef.current = true;
        setAutoRunning(false);
        setAutoStage('');
        videoRecoveryRef.current.clear();
        setIsCanvasMode(false);
        setProjectName(data.name || 'Untitled Project');
        const importedVoiceLanguage = data.language === 'en' ? 'en' : 'zh';
        const importedCharacters = castStoryVoices((data.characters || []) as Character[], importedVoiceLanguage);
        const importedObjects = data.objects || [];
        const importedCostumeImages = data.costumeImages || {};
        const importedSceneImages = data.sceneImages || [];
        styleReferenceRef.current = data.styleReference;
        const importedVoiceReferences = currentVoiceReferences(data.voiceReferences);
        charactersRef.current = importedCharacters;
        objectsRef.current = importedObjects;
        costumeImagesRef.current = importedCostumeImages;
        voiceReferencesRef.current = importedVoiceReferences;
        sceneImagesRef.current = importedSceneImages;
        setCharacters(importedCharacters);
        setObjects(importedObjects);
        setStoryContent(data.storyContent || '');
        const importedLanguage = data.language === 'en' || data.language === 'zh'
          ? data.language
          : (settingsRef.current.language === 'en' ? 'en' : 'zh');
        const importedStoryPlan: StoryPlan | undefined = data.storyPlan ? canonicalizeStoryIdentities({
          ...data.storyPlan,
          characters: castStoryVoices(data.storyPlan.characters || [], importedLanguage),
        }, importedCharacters) : undefined;
        projectLanguageLockedRef.current = Boolean(data.language);
        projectLanguageRef.current = importedLanguage;
        setProjectLanguage(importedLanguage);
        const importedTargetShotCount = storyStorageKeys().isolated
          ? Math.max(1, Math.min(81, Math.trunc(Number(data.targetShotCount) || DEFAULT_TARGET_SHOT_COUNT)))
          : normalizeTargetShotCount(data.targetShotCount);
        setTargetShotCount(importedTargetShotCount);
        const importedAspectRatio = projectStoryAspectRatio(data.aspectRatio, data.storyboards || [], settingsRef.current.aspectRatio);
        projectAspectLockedRef.current = Boolean(data.aspectRatio || (data.storyboards || []).some((item: Storyboard) => item.aspectRatio));
        projectAspectRatioRef.current = importedAspectRatio;
        setProjectAspectRatio(importedAspectRatio);
        setVisualStyle(normalizeVisualStyle(data.visualStyle || settings.visualStyle));
        const importedCapturePreset = normalizeCapturePreset(data.capturePreset);
        capturePresetRef.current = importedCapturePreset;
        setCapturePreset(importedCapturePreset);
        const importedProductionTiming = normalizeProductionTiming(data.productionTiming);
        productionTimingRef.current = importedProductionTiming;
        setProductionTiming(importedProductionTiming);
        const importedEffectiveVoiceCast = effectiveStoryCast(importedCharacters, importedStoryPlan?.characters);
        const importedStoryboards = lockStoryboardVoiceIds<Storyboard>((data.storyboards || []).map((item: Storyboard) => ({ ...item, aspectRatio: importedAspectRatio, capturePreset: normalizeCapturePreset(item.capturePreset || data.capturePreset) })), importedEffectiveVoiceCast);
        storyboardsRef.current = importedStoryboards;
        setStoryboards(importedStoryboards);
        void recoverProjectVideos(importedStoryboards, importedProjectId);
        setVoiceReferences(importedVoiceReferences);
        setCostumeImages(importedCostumeImages);
        setSceneImages(importedSceneImages);
        setStoryPlan(importedStoryPlan);
        storyPlanRef.current = importedStoryPlan;
        const importedVideoSegmentPlan = importedStoryboards.length
          ? normalizeVideoSegmentPlan(importedStoryboards, data.videoSegmentPlan, importedLanguage)
          : undefined;
        setVideoSegmentPlan(importedVideoSegmentPlan);
        videoSegmentPlanRef.current = importedVideoSegmentPlan;
        // Import is an explicit project replacement. Persist it immediately so
        // a refresh or a background tab cannot resurrect the project that was
        // open before the file chooser completed.
        saveProject({
          id: importedProjectId,
          name: data.name || 'Untitled Project',
          characters: importedCharacters,
          objects: importedObjects,
          storyContent: data.storyContent || '',
          language: importedLanguage,
          targetShotCount: importedTargetShotCount,
          aspectRatio: importedAspectRatio,
          visualStyle: normalizeVisualStyle(data.visualStyle || settingsRef.current.visualStyle),
          capturePreset: importedCapturePreset,
          productionTiming: importedProductionTiming,
          storyOutline: '',
          storyboards: importedStoryboards,
          voiceReferences: importedVoiceReferences,
          costumeImages: importedCostumeImages,
          sceneImages: importedSceneImages,
          styleReference: data.styleReference,
          storyPlan: importedStoryPlan,
          videoSegmentPlan: importedVideoSegmentPlan,
          createdAt: data.createdAt || new Date().toISOString(),
        });
        if (data.storyboards?.length > 0) setCurrentStep(4);
        else if (data.storyContent && data.characters?.length > 0) setCurrentStep(2);
        else setCurrentStep(1);
        void recoverSavedCastAliases(importedProjectId);
        alert('Project loaded!');
      } catch {
        alert('Failed to load project file');
      }
    };
    input.click();
  };

  const handleExport = () => {
    exportProject({ name: projectName, characters, objects, storyContent, language: projectLanguage, targetShotCount, aspectRatio: projectAspectRatio, visualStyle, capturePreset, productionTiming, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, styleReference: styleReferenceRef.current, storyPlan, videoSegmentPlan, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  const handleUpdateStoryboard = (updated: Storyboard) => {
    if (productionTimingRef.current?.status === 'completed') {
      productionTimingRef.current = undefined;
      setProductionTiming(undefined);
    }
    setStoryboards(prev => {
      const next = replaceStoryboardAndInvalidateChangedVideo(prev, updated);
      storyboardsRef.current = next;
      return next;
    });
  };

  const handleVisualStyleChange = (style: VisualStyle) => {
    const normalized = normalizeVisualStyle(style);
    if (normalized === visualStyle) return;
    if (storyboardsRef.current.some(item => item.status === 'generating' || item.videoStatus === 'generating')) {
      alert('当前仍有生成任务，请等任务结束后再更换风格。'); return;
    }
    if (hasStoryMedia(storyboardsRef.current) && !window.confirm('更换风格后现有分镜图需要重新生成，相关视频也需重制。不会自动提交付费生成，是否继续？')) return;
    setVisualStyle(normalized);
    productionTimingRef.current = undefined;
    setProductionTiming(undefined);
    setStoryboards(prev => {
      const next = prev.map(storyboard => storyboard.visualStyle === normalized
        ? storyboard
        : applyCapturePreset({ ...storyboard, visualStyle: normalized }, capturePresetRef.current));
      storyboardsRef.current = next;
      return next;
    });
    sceneImagesRef.current = []; setSceneImages([]);
  };

  const handleCapturePresetChange = (preset: CapturePreset) => {
    const normalized = normalizeCapturePreset(preset);
    if (normalized === capturePresetRef.current) return;
    if (storyboardsRef.current.some(item => item.status === 'generating' || item.videoStatus === 'generating')) {
      alert('当前仍有图片或视频正在生成，请等待任务结束后再切换拍摄方式。');
      return;
    }
    if (hasStoryMedia(storyboardsRef.current) && !window.confirm('切换全片拍摄方式会改变构图、机位、表演和成像质感，需要重新生成现有场景图、分镜图和视频。是否继续？')) return;
    capturePresetRef.current = normalized;
    setCapturePreset(normalized);
    productionTimingRef.current = undefined;
    setProductionTiming(undefined);
    const nextStoryboards = storyboardsRef.current.map(storyboard => (
      storyboard.capturePreset === normalized ? storyboard : applyCapturePreset(storyboard, normalized)
    ));
    storyboardsRef.current = nextStoryboards;
    setStoryboards(nextStoryboards);
    sceneImagesRef.current = [];
    setSceneImages([]);
    setVideoSegmentPlan(undefined);
    videoSegmentPlanRef.current = undefined;
    saveProject({
      characters: charactersRef.current,
      objects: objectsRef.current,
      storyContent,
      language: projectLanguageRef.current,
      targetShotCount,
      aspectRatio: projectAspectRatioRef.current,
      visualStyle,
      capturePreset: normalized,
      styleReference: styleReferenceRef.current,
      productionTiming: undefined,
      storyOutline: '',
      storyboards: nextStoryboards,
      voiceReferences: voiceReferencesRef.current,
      costumeImages: costumeImagesRef.current,
      sceneImages: [],
      storyPlan: storyPlanRef.current,
      videoSegmentPlan: undefined,
      createdAt: new Date().toISOString(),
    });
  };

  const handleAspectRatioChange = (aspectRatio: StoryAspectRatio): boolean => {
    if (aspectRatio === projectAspectRatioRef.current) return true;
    if (storyboardsRef.current.some(item => item.status === 'generating' || item.videoStatus === 'generating')) {
      alert('当前仍有图片或视频正在生成，请等待任务结束后再切换画幅。');
      return false;
    }
    if (hasStoryMedia(storyboardsRef.current) && !window.confirm('切换成片画幅需要重新生成现有分镜图和视频。继续后会保留剧本，但清除当前项目已关联的图片与视频结果。是否继续？')) {
      return false;
    }
    projectAspectLockedRef.current = true;
    projectAspectRatioRef.current = aspectRatio;
    setProjectAspectRatio(aspectRatio);
    productionTimingRef.current = undefined;
    setProductionTiming(undefined);
    const nextStoryboards = applyStoryAspectRatio(storyboardsRef.current, aspectRatio);
    storyboardsRef.current = nextStoryboards;
    setStoryboards(nextStoryboards);
    const nextSettings = { ...settingsRef.current, aspectRatio };
    settingsRef.current = nextSettings;
    saveSettings(nextSettings);
    return true;
  };

  const handleSettingsSave = (nextSettings: typeof settings): boolean => {
    if (nextSettings.aspectRatio !== projectAspectRatioRef.current && !handleAspectRatioChange(nextSettings.aspectRatio)) return false;
    const nextLanguage: 'zh' | 'en' = nextSettings.language === 'en' ? 'en' : 'zh';
    projectLanguageLockedRef.current = true;
    projectLanguageRef.current = nextLanguage;
    setProjectLanguage(nextLanguage);
    const merged = { ...nextSettings, language: nextLanguage, aspectRatio: projectAspectRatioRef.current };
    settingsRef.current = merged;
    saveSettings(merged);
    return true;
  };

  // Step2 → Step3: generate shot script from story + characters
  const ensureStoryVisualAssets = async () => {
    const projectId = projectIdRef.current;
    const existing = assetPreparationRef.current;
    if (existing?.projectId === projectId) return existing.promise;
    const promise = (async () => {
      const beforeCharacters = charactersRef.current, beforeObjects = objectsRef.current;
      const costumes = characterAliasValues(costumeImagesRef.current, beforeCharacters);
      const needs = beforeCharacters.some(c => (costumes[c.name] || c.imageUrl || c.imageBase64) && !currentVisualIdentity(c, costumes[c.name]))
        || beforeObjects.some(o => (o.imageUrl || o.imageBase64) && !currentVisualIdentity(o));
      if (!needs) return;
      if (autoRunLockRef.current) setAutoStage('理解已选原图并固定资产外观（仅首次或素材变更时）');
      const active = settingsRef.current;
      const prepared = await prepareStoryAssets({ characters: beforeCharacters, objects: beforeObjects, costumeImages: costumes,
        apiKey: active.apiKey, dmxApiKey: active.dmxApiKey, scriptProvider: active.scriptProvider, scriptModel: active.scriptModel,
        prepareImages: prepareImageRequestRef.current,
        request: body => fetchStoryApi('/api/prepare-story-assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, active.comfyui),
      });
      if (projectId !== projectIdRef.current) throw new Error('项目已切换，未回写旧项目资产');
      const unchanged = beforeCharacters.length === charactersRef.current.length && beforeObjects.length === objectsRef.current.length
        && beforeCharacters.every(c => { const now = charactersRef.current.find(n => n.id === c.id); return now && visualAssetSourceKey(c, costumes[c.name]) === visualAssetSourceKey(now, characterAliasValues(costumeImagesRef.current, charactersRef.current)[now.name]); })
        && beforeObjects.every(o => { const now = objectsRef.current.find(n => n.id === o.id); return now && visualAssetSourceKey(o) === visualAssetSourceKey(now); });
      if (!unchanged) throw new Error('参考素材已更改，请重新开始；未提交生图');
      charactersRef.current = charactersRef.current.map(c => ({ ...c, visualIdentity: prepared.characters.find(n => n.id === c.id)?.visualIdentity }));
      objectsRef.current = objectsRef.current.map(o => ({ ...o, visualIdentity: prepared.objects.find(n => n.id === o.id)?.visualIdentity }));
      setCharacters(charactersRef.current); setObjects(objectsRef.current);
      persistCurrentProject();
    })();
    assetPreparationRef.current = { projectId, promise };
    try { await promise; } finally { if (assetPreparationRef.current?.promise === promise) assetPreparationRef.current = undefined; }
  };

  // ① 编剧 + ② 导演：梗概 → StoryPlan → 分镜。返回生成的分镜数组供编排器使用。
  const runScript = async (resume = false): Promise<Storyboard[]> => {
    // Never send uploaded image/base64/File fields to the text-only screenplay
    // endpoints. Besides wasting bandwidth, large character images can make a
    // hosting gateway reject the request with an HTML 413/5xx page.
    const language = projectLanguageRef.current;
    setScriptGenerationPhase('assets');
    await ensureStoryVisualAssets();
    setScriptGenerationPhase('planning');
    const voiceLockedCharacters = castStoryVoices(charactersRef.current, language);
    charactersRef.current = voiceLockedCharacters;
    setCharacters(voiceLockedCharacters);
    const writerCharacters = voiceLockedCharacters.map(character => {
      const { id, name, aliases, description, voiceId, voiceProfile, voiceSource, voiceLocked, gender, ageGroup } = character;
      const source = characterAliasValues(costumeImagesRef.current, voiceLockedCharacters)[name];
      return { id, name, aliases, description, visualDescription: currentVisualIdentity(character, source) ? visualAssetDescription(character, source) : undefined, voiceId, voiceProfile, voiceSource, voiceLocked, gender, ageGroup };
    });
    const writerObjects = objectsRef.current.map(object => ({ id: object.id, name: object.name, aliases: object.aliases, description: currentVisualIdentity(object) ? `${object.description}\nOriginal image facts (appearance authority): ${visualAssetDescription(object)}` : object.description }));
    const activeSettings = settingsRef.current;
    const savedSeriesContract = storyStorageKeys().isolated ? localStorage.getItem(storyStorageKeys().contract) : null;
    // Ordinary stories still need the generic shot-count contract. A series
    // episode already has exact per-shot timing; appending a 5s/shot estimate
    // would contradict an authored screenplay whose dialogue required longer.
    const planningSynopsis = savedSeriesContract
      ? storyContent.trim()
      : `${storyContent.trim()}\n\n${buildShotCountContract(targetShotCount, language)}`;
    if (storyStorageKeys().isolated && !savedSeriesContract) throw new Error('连续剧定稿合同缺失，停止导演');
    const approvedSeriesContract = savedSeriesContract
      ? reconcileSeriesProductionContract(JSON.parse(savedSeriesContract), writerCharacters)
      : undefined;
    if (savedSeriesContract && JSON.stringify(approvedSeriesContract) !== savedSeriesContract) {
      localStorage.setItem(storyStorageKeys().contract, JSON.stringify(approvedSeriesContract));
    }
    let storyPlan = storyPlanRef.current;
    if (storyPlan) {
      const planCast = storyPlan.castAdaptation?.castKey === storyCastKey(writerCharacters)
        ? adaptedStoryCharacters(writerCharacters, storyPlan.castAdaptation) : writerCharacters;
      storyPlan = canonicalizeStoryIdentities(storyPlan, planCast);
      storyPlanRef.current = storyPlan;
      setStoryPlan(storyPlan);
    }
    if (!resume || !canResumeStoryPlan(storyPlan, planningSynopsis, targetShotCount, writerCharacters) || (approvedSeriesContract?.shots && !storyPlan?.seriesEpisode)) {
      let generatedPlan: StoryPlan;
      if (approvedSeriesContract?.shots) {
        generatedPlan = buildApprovedSeriesPlan(approvedSeriesContract, planningSynopsis, writerCharacters);
      } else {
      const planRes = await fetchStoryApi('/api/generate-story-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synopsis: planningSynopsis, targetShotCount, characters: writerCharacters, objects: writerObjects, apiKey: activeSettings.apiKey, language, scriptProvider: activeSettings.scriptProvider || 'auto', scriptModel: activeSettings.scriptModel || 'gpt-4o', dmxApiKey: activeSettings.dmxApiKey })
      }, activeSettings.comfyui);
      generatedPlan = (await readApiJson<{ storyPlan: StoryPlan }>(planRes, '剧本规划失败')).storyPlan;
      }
      const actualShotCount = storyPlanBeatCount(generatedPlan);
      if (actualShotCount !== targetShotCount) {
        throw new Error(`剧本规划返回了 ${actualShotCount} 个镜头，但你选择的是 ${targetShotCount} 个，请重试`);
      }
      storyPlan = {
        ...generatedPlan,
        targetShotCount,
        targetDurationSeconds: approvedSeriesContract?.shots
          ? approvedSeriesContract.shots.reduce((sum, shot) => sum + shot.seconds, 0)
          : targetDurationSeconds(targetShotCount),
        estimatedDurationSeconds: generatedPlan.sequences.reduce((total, sequence) => (
          total + sequence.beats.reduce((sum, beat) => sum + beat.durationHint, 0)
        ), 0),
      };
      storyPlanRef.current = storyPlan;
      setStoryPlan(storyPlan);
      // Persist the completed writing stage before starting paid direction.
      persistCurrentProject();
    }
    if (storyStorageKeys().isolated) {
      const savedContract = localStorage.getItem(storyStorageKeys().contract);
      if (!savedContract) throw new Error('连续剧定稿合同缺失，停止导演');
      const contract = approvedSeriesContract || reconcileSeriesProductionContract(JSON.parse(savedContract), writerCharacters);
      storyPlan = bindSeriesPlan(contract, storyPlan);
      validateSeriesProduction(contract, storyPlan.sequences.flatMap(sequence => sequence.beats));
      storyPlanRef.current = storyPlan;
      setStoryPlan(storyPlan);
      persistCurrentProject();
    }
    setScriptGenerationPhase('directing');

    const dirRes = await fetchStoryApi('/api/direct-storyboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyPlan, characters: writerCharacters, objects: writerObjects, apiKey: activeSettings.apiKey, aspectRatio: projectAspectRatioRef.current, language, visualStyle, capturePreset: capturePresetRef.current, scriptProvider: activeSettings.scriptProvider || 'auto', scriptModel: activeSettings.scriptModel || 'gpt-4o', dmxApiKey: activeSettings.dmxApiKey })
    }, activeSettings.comfyui);
    const { storyboards } = await readApiJson<{ storyboards: Storyboard[] }>(dirRes, '分镜导演失败');
    // The StoryPlan also contains automatically discovered speaking roles.
    // Reapply its authoritative voice map at the client boundary so an older
    // director response can never reach H3 with a missing/default voice.
    const effectiveVoiceCast = effectiveStoryCast(voiceLockedCharacters, storyPlan.characters);
    const approvedShots = storyStorageKeys().isolated
      ? approvedSeriesContract?.shots
      : undefined;
    const styledStoryboards = lockStoryboardVoiceIds(
      storyboards.map((storyboard, index) => ({ ...bindStoryboardReferences(storyboard, effectiveVoiceCast, objectsRef.current), visualStyle, capturePreset: capturePresetRef.current,
        ...(approvedShots?.[index] ? { locationId: approvedShots[index].locationId || storyboard.locationId,
          sceneStyle: approvedShots[index].sceneStyle || storyboard.sceneStyle,
          sceneImageOverride: approvedShots[index].sceneImageUrl || storyboard.sceneImageOverride } : {}),
      })),
      effectiveVoiceCast,
    );
    setScriptGenerationPhase('validating');
    const deliveryAudit = auditStoryDelivery(storyPlan, styledStoryboards);
    if (deliveryAudit.errors.length) {
      throw new Error(`故事交付校验失败：${deliveryAudit.errors.slice(0, 4).join('；')}`);
    }
    const initialVideoSegmentPlan = createVideoSegmentPlan(
      styledStoryboards,
      suggestVideoSegments(styledStoryboards),
      'auto',
    );
    setVideoSegmentPlan(initialVideoSegmentPlan);
    videoSegmentPlanRef.current = initialVideoSegmentPlan;
    setStoryboards(styledStoryboards);
    storyboardsRef.current = styledStoryboards;
    persistCurrentProject(styledStoryboards);
    return styledStoryboards;
  };

  /** A Series visual redo preserves the approved screenplay and shot grammar,
   * but recompiles both image and H3 directing prompts against the newest
   * character/object identities. The marker is cleared only after the whole
   * replacement batch has been persisted. */
  const rewriteVisualPromptsForRedo = async (): Promise<Storyboard[]> => {
    const retained = storyboardsRef.current;
    const rewriteIds = [...new Set(retained.map(item => item.visualPromptRewriteId).filter(Boolean))] as string[];
    if (!rewriteIds.length) return retained;

    setScriptGenerationPhase('assets');
    await ensureStoryVisualAssets();
    const language = projectLanguageRef.current;
    const voiceLockedCharacters = castStoryVoices(charactersRef.current, language);
    charactersRef.current = voiceLockedCharacters;
    setCharacters(voiceLockedCharacters);
    const writerCharacters = voiceLockedCharacters.map(character => {
      const { id, name, aliases, description, voiceId, voiceProfile, voiceSource, voiceLocked, gender, ageGroup } = character;
      const source = characterAliasValues(costumeImagesRef.current, voiceLockedCharacters)[name];
      return { id, name, aliases, description, visualDescription: currentVisualIdentity(character, source) ? visualAssetDescription(character, source) : undefined, voiceId, voiceProfile, voiceSource, voiceLocked, gender, ageGroup };
    });
    const writerObjects = objectsRef.current.map(object => ({
      id: object.id,
      name: object.name,
      aliases: object.aliases,
      description: currentVisualIdentity(object)
        ? `${object.description}\nOriginal image facts (appearance authority): ${visualAssetDescription(object)}`
        : object.description,
    }));
    const activeSettings = settingsRef.current;
    const savedSeriesContract = storyStorageKeys().isolated
      ? localStorage.getItem(storyStorageKeys().contract)
      : null;
    const approvedSeriesContract = savedSeriesContract
      ? reconcileSeriesProductionContract(JSON.parse(savedSeriesContract), writerCharacters)
      : undefined;
    if (savedSeriesContract && JSON.stringify(approvedSeriesContract) !== savedSeriesContract) {
      localStorage.setItem(storyStorageKeys().contract, JSON.stringify(approvedSeriesContract));
    }
    let currentPlan = storyPlanRef.current || (approvedSeriesContract
      ? buildApprovedSeriesPlan(approvedSeriesContract, storyContent.trim(), writerCharacters)
      : undefined);
    if (!currentPlan) throw new Error('一键重做缺少可复用的剧本计划，未开始生成图片或视频');
    const planCast = currentPlan.castAdaptation?.castKey === storyCastKey(writerCharacters)
      ? adaptedStoryCharacters(writerCharacters, currentPlan.castAdaptation)
      : writerCharacters;
    currentPlan = canonicalizeStoryIdentities(currentPlan, planCast);
    if (approvedSeriesContract) currentPlan = bindSeriesPlan(approvedSeriesContract, currentPlan);
    storyPlanRef.current = currentPlan;
    setStoryPlan(currentPlan);

    setScriptGenerationPhase('directing');
    const response = await fetchStoryApi('/api/direct-storyboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyPlan: currentPlan,
        characters: writerCharacters,
        objects: writerObjects,
        apiKey: activeSettings.apiKey,
        aspectRatio: projectAspectRatioRef.current,
        language,
        visualStyle,
        capturePreset: capturePresetRef.current,
        scriptProvider: activeSettings.scriptProvider || 'auto',
        scriptModel: activeSettings.scriptModel || 'gpt-4o',
        dmxApiKey: activeSettings.dmxApiKey,
        generationRevision: rewriteIds.sort().join(':'),
      }),
    }, activeSettings.comfyui);
    const { storyboards: regenerated } = await readApiJson<{ storyboards: Storyboard[] }>(response, '重写分镜生图与视频提示词失败');
    const effectiveVoiceCast = effectiveStoryCast(voiceLockedCharacters, currentPlan.characters);
    const approvedShots = approvedSeriesContract?.shots;
    const rewritten = lockStoryboardVoiceIds(
      mergeRegeneratedVisualPrompts(retained, regenerated).map((storyboard, index) => ({
        ...bindStoryboardReferences(storyboard, effectiveVoiceCast, objectsRef.current),
        visualStyle,
        capturePreset: capturePresetRef.current,
        ...(approvedShots?.[index] ? {
          locationId: approvedShots[index].locationId || storyboard.locationId,
          sceneStyle: approvedShots[index].sceneStyle || storyboard.sceneStyle,
          sceneImageOverride: approvedShots[index].sceneImageUrl || storyboard.sceneImageOverride,
        } : {}),
      })),
      effectiveVoiceCast,
    );
    if (approvedSeriesContract) validateSeriesProduction(approvedSeriesContract, rewritten);
    const nextVideoSegmentPlan = createVideoSegmentPlan(
      rewritten,
      suggestVideoSegments(rewritten),
      'auto',
    );
    setVideoSegmentPlan(nextVideoSegmentPlan);
    videoSegmentPlanRef.current = nextVideoSegmentPlan;
    setStoryboards(rewritten);
    storyboardsRef.current = rewritten;
    setScriptGenerationPhase('validating');
    persistCurrentProject(rewritten);
    return rewritten;
  };

  const handleGenerateScript = async () => {
    if (!settings.apiKey && !settings.dmxApiKey) { alert('Please configure API Key in settings'); return; }
    setScriptGenerationPhase('planning');
    setIsLoading(true);
    try {
      await runScript();
      setCurrentStep(3);
    } catch (error) {
      alert(`剧本生成失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
      setScriptGenerationPhase('idle');
    }
  };

  // Step4: batch generate via 2x2 grid
  const handleGenerateGrid = async (batch: Storyboard[], options: { throwOnError?: boolean; resumeTaskId?: string; gridSize?: 2 | 3 } = {}) => {
    const activeSettings = { ...settingsRef.current, imageModel: resolveCharacterStoryboardModel(settingsRef.current.imageModel, charactersRef.current) };
    if (isMidjourneyImageModel(activeSettings.imageModel)) {
      setIsGeneratingGrid(true);
      try {
        for (const member of batch) {
          const latest = storyboardsRef.current.find(s => s.id === member.id);
          if (latest && !hasUsableStoryboardImage(latest)) await handleGenerateImage(latest, options);
        }
      } finally { setIsGeneratingGrid(false); }
      return;
    }
    if (imageModelRequiresApiKey(activeSettings.imageModel) && !activeSettings.apiKey) {
      const error = new Error('Please configure API Key in settings');
      if (options.throwOnError) throw error;
      if (options.resumeTaskId) return;
      alert(error.message);
      return;
    }
    if (batch.length === 0) return;
    const { buildGridPrompt, chunkGridBatch, GridPromptCapacityError } = await import('@/lib/gridSplitter');
    const aspectRatio = projectAspectRatioRef.current;
    const generationProjectId = projectIdRef.current;
    const updateGridStoryboards = (updater: (items: Storyboard[]) => Storyboard[]) => {
      if (generationProjectId !== projectIdRef.current) return;
      const current = storyboardsRef.current;
      const proposed = updater(current);
      const next = options.resumeTaskId ? preserveCompletedGridArtifacts(current, proposed) : proposed;
      storyboardsRef.current = next;
      setStoryboards(next);
      persistCurrentProject(next);
    };
    setIsGeneratingGrid(true);
    const failedBatches: string[] = [];
    // Process in groups of 4
    try {
      if (!options.resumeTaskId) await ensureStoryVisualAssets();
      const gridSize = options.gridSize || 2;
      const gridCapacity = gridSize * gridSize;
      if (options.resumeTaskId && batch.length > gridCapacity) throw new Error('恢复批次超出原任务容量；保留任务编号，未重新生成');
      for (const group of chunkGridBatch(batch, gridCapacity)) {
        updateGridStoryboards(items => items.map(sb =>
          group.some(g => g.id === sb.id) ? { ...sb, status: 'generating' } : sb
        ));
        try {
        // Midjourney establishes the project's cinematic master frame. Nano
        // Banana 2 then turns that MJ anchor into a strict, splittable 2x2
        // contact sheet. Sending independent MJ jobs here produces separate
        // portrait-like candidates instead of one coherent storyboard batch.
        const gridImageModel = resolveStoryboardGridImageModel(activeSettings.imageModel);
        // Grid generation must consider the cast from every panel, not only the
        // first storyboard in the group. Otherwise later character references
        // are uploaded without a matching prompt label and can be ignored.
        const productionCast = effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters);
        const groupCharacters = productionCast.filter(character => group.some(sb => visibleImageCast(sb, productionCast).includes(character)));
        const groupObjects = objectsRef.current.filter(object => group.some(sb => visibleStoryObjects(sb, objectsRef.current).includes(object)));
        const costumeSources = characterAliasValues(costumeImagesRef.current, productionCast);

        // Build grid prompt from group's prompts
        const sceneStyle = new Set(group.map(s => s.locationId).filter(Boolean)).size > 1
          ? 'Locations vary by panel. Each mapped environment applies only to its listed shots; keep character identities consistent across locations.'
          : group[0]?.sceneStyle || '';
        const textDefinedCharacters = [...new Set(group.flatMap(sb => sb.characters || []))]
          .filter(name => !characterIdentityIndex(groupCharacters).resolve(name))
          .map(name => {
            const costume = group.map(sb => sb.characterCostume?.[name]).find(Boolean);
            return `${name}: ${costume || 'stable role-appropriate face, body, age, silhouette, wardrobe and color palette; text-defined identity without a separate reference image'}`;
          });
        const charDescs = [
          ...groupCharacters.map(c => `${c.name}: ${visualAssetDescription(c, costumeSources[c.name])}`),
          ...textDefinedCharacters,
        ].join('\n');
        const rejected = group.find(sb => sb.status === 'failed' && isImageSafetyRejection(sb.imageFailureReason));
        if (rejected) throw new TerminalImageTaskError(rejected.imageFailureReason || '上游审核拒绝');
        const safetyFindings = (options.resumeTaskId ? [] : group).map(sb => ({
          storyboard: sb,
          risks: analyzeImagePromptSafety(`${sb.prompt}\n${sb.description}`),
        })).filter(finding => finding.risks.length > 0);
        if (safetyFindings.length > 0) {
          updateGridStoryboards(items => items.map(sb => {
            const finding = safetyFindings.find(entry => entry.storyboard.id === sb.id);
            if (!finding) return sb;
            return {
              ...sb,
              imagePromptOverride: rewriteImagePromptForSafety(sb.prompt, 1),
              imageFailureReason: `生成前检测到：${imageSafetyReasonLabel(finding.risks)}；已自动改为非血腥画面`,
              imageRetryCount: sb.imageRetryCount || 0,
            };
          }));
        }
        const buildShotDescriptions = (safetyAttempt: number) => group.map(sb => {
          const finding = safetyFindings.find(entry => entry.storyboard.id === sb.id);
          const shouldRewrite = Boolean(finding) || safetyAttempt > 0 || Boolean(sb.imagePromptOverride);
          const safetyLevel: 1 | 2 = (finding && safetyAttempt === 0) || safetyAttempt === 1 ? 1 : 2;
          const basePrompt = sb.imagePromptOverride || sb.prompt;
          const sourcePrompt = shouldRewrite
            ? rewriteImagePromptForSafety(basePrompt, safetyLevel).replace(/^[\s\S]*?\n\n/, '')
            : basePrompt;
          const cleanPrompt = sourcePrompt.replace(/\[([^\]]+)\]/g, '$1');
          const identityIndex = characterIdentityIndex(productionCast);
          const requiredCharacters = [...new Set([
            ...(sb.characters || []),
            ...visibleImageCast(sb, productionCast)
              .map(character => character.name),
          ].map(name => identityIndex.resolve(name)?.name || name))].filter(name => !charactersRef.current.some(c => c.name === name && (c as ImageCastCharacter).appearance === 'voice_only'));
          const requiredObjects = visibleStoryObjects(sb, groupObjects)
            .map(object => object.name);
          const panelChars = requiredCharacters.length
            ? `Only ${requiredCharacters.join(', ')} appear in this frame, one instance of each.`
            : 'No person or story character appears in this frame.';
          const panelObjs = requiredObjects.length
            ? `The physical props are ${requiredObjects.join(', ')}.`
            : '';
          return `${cleanPrompt} ${panelChars} ${panelObjs}`.trim();
        });

        // Keep labels and images in exactly the same order. Text-only entities
        // stay in the prompt but must not consume a reference image number.
        const characterReferences = groupCharacters
          .map(character => ({
            image: costumeSources[character.name] || character.imageUrl || character.imageBase64,
            label: `CHARACTER IDENTITY: ${character.name} [ID ${character.id}] — ${visualAssetDescription(character, costumeSources[character.name])}${character.aliases?.length ? `; same identity aliases: ${character.aliases.join(', ')}` : ''}`
          }))
          .filter((reference): reference is { image: string; label: string } => Boolean(reference.image));
        const objectReferences = groupObjects
          .map(object => ({
            image: object.imageUrl || object.imageBase64,
            label: `OBJECT IDENTITY: ${object.name} [ID ${object.id}] — ${visualAssetDescription(object)}`
          }))
          .filter((reference): reference is { image: string; label: string } => Boolean(reference.image));
        const specificScenes = [...new Set(group.map(s => s.sceneImageOverride).filter((url): url is string => Boolean(url)))];
        const sceneReference = specificScenes.length
          ? specificScenes.map(image => ({ image, label: `ENVIRONMENT: shots ${group.filter(s => s.sceneImageOverride === image).map(s => s.sceneNumber).join(',')}` }))
          : sceneImagesRef.current[0] ? [{ image: sceneImagesRef.current[0], label: 'ENVIRONMENT: scene/world reference' }] : [];
        const referenceLimit = getImageModelCapabilities(gridImageModel).maxReferenceImages;
        // A registered fixed prop is an immutable identity source, not optional
        // environment flavor. Keep it ahead of every other reference for all
        // providers so a low image limit can never silently drop it.
        const references = [...objectReferences, ...characterReferences, ...sceneReference];
        if (!options.resumeTaskId) requireReferenceCapacity(references.length, referenceLimit, styleReferenceRef.current ? 1 : 0);
        const refLabels = references.map(reference => reference.label);
        const refImages = references.map(reference => reference.image);
        let gridUrl = '';
        let lastGridError: unknown;
        const maxSafetyAttempts = 1; // Preflight only; never rewrite around a provider refusal.
        for (let safetyAttempt = 0; safetyAttempt < maxSafetyAttempts && !gridUrl; safetyAttempt += 1) {
          const shotDescs = buildShotDescriptions(safetyAttempt);
          const rawGridPrompt = options.resumeTaskId ? '' : buildGridPrompt(
            sceneStyle,
            charDescs,
            shotDescs,
            aspectRatio,
            refLabels,
            group.map(storyboard => storyboard.sceneNumber),
            visualStyle,
            capturePresetRef.current,
            gridImageModel,
          );
          const usesSafetyRewrite = safetyFindings.length > 0 || safetyAttempt > 0;
          const gridPrompt = usesSafetyRewrite
            ? `${rewriteImagePromptForSafety('', safetyFindings.length > 0 && safetyAttempt === 0 || safetyAttempt === 1 ? 1 : 2)}\n\n${rawGridPrompt}`
            : rawGridPrompt;
          const gridStoryboard = {
            ...group[0],
            prompt: gridPrompt,
            characters: groupCharacters.map(character => character.name),
            objects: groupObjects.map(object => object.name)
          };

          try {
            // Reattach to the paid task. A provider refusal is preserved for review.
            let taskId = safetyAttempt === 0 && options.resumeTaskId && batch.length <= gridCapacity ? options.resumeTaskId : '';
            if (!taskId) {
              const requestBody = await prepareImageRequestRef.current({
                storyboard: gridStoryboard,
                characters: groupCharacters,
                objects: groupObjects,
                aspectRatio,
                imageModel: gridImageModel,
                apiKey: activeSettings.apiKey,
                costumeImages: costumeImagesRef.current,
                sceneImage: sceneImagesRef.current[0] || '',
                referenceImages: refImages,
                referenceImageLabels: refLabels,
                visualStyle,
                capturePreset: capturePresetRef.current,
                comfyui: localComfyUISettings(activeSettings.comfyui),
                styleReference: styleReferenceRef.current, midjourneyStyle: resolveMidjourneyStyleSetting(activeSettings), midjourneyProfile: resolveMidjourneyProfileSetting(activeSettings),
              });
              if (generationProjectId !== projectIdRef.current || (autoRunLockRef.current && autoAbortRef.current)) throw new Error('制作已暂停或项目已切换，未提交新的四宫格任务');
              const res = await fetch(imageApiUrl('/api/generate', activeSettings.comfyui, gridImageModel), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: requestBody,
              });
              ({ taskId } = await readApiJson<{ taskId: string }>(res, '四宫格任务创建失败'));
              updateGridStoryboards(items => items.map(sb =>
                group.some(g => g.id === sb.id) ? { ...sb, taskId, imageTaskMode: 'grid' as const, imageGridSize: gridSize } : sb
              ));
              // The remote task is already billable at this point. Persist its
              // id immediately so a refresh can reattach instead of purchasing
              // a duplicate or leaving the batch stranded.
              persistCurrentProject();
            }

            // 4K four-panel jobs can still need several minutes during
            // provider congestion. Keep polling for nine minutes so the UI
            // does not report a false timeout while the paid task is healthy.
            for (let j = 0; j < 180; j++) {
              await new Promise(r => setTimeout(r, 3000));
              if (generationProjectId !== projectIdRef.current) throw new Error('项目已切换，旧项目的四宫格任务已停止回写');
              const statusRes = await fetch(imageApiUrl('/api/check-image-status', activeSettings.comfyui, taskId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, apiKey: activeSettings.apiKey, comfyui: localComfyUISettings(activeSettings.comfyui) })
              });
              if (!statusRes.ok) continue;
              const statusData = await statusRes.json();
              if (generationProjectId !== projectIdRef.current) throw new Error('项目已切换，旧项目的四宫格任务已停止回写');
              if (statusData.status === 'completed' && statusData.imageUrl) {
                gridUrl = await persistLocalGeneratedImage(statusData.imageUrl, activeSettings.comfyui);
                break;
              }
              if (statusData.status === 'failed') throw new TerminalImageTaskError(extractImageTaskError(statusData));
            }
            if (!gridUrl) throw new Error('Grid image timeout');
          } catch (error) {
            lastGridError = error;
            throw error;
          }
        }
        if (!gridUrl) throw (lastGridError instanceof Error ? lastGridError : new Error('Grid image failed'));

        // Persist the short-lived APIMart result and split it with Cloudinary
        // delivery transformations. Netlify's image proxy can hang while
        // downloading getapib.org, leaving every shot stuck in "generating".
        const splitResponse = await fetch('/api/split-grid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: gridUrl, gridSize })
        });
        const { cells: uploadedCells, gridUrl: persistedGridUrl } = await readApiJson<{ cells: string[]; gridUrl: string }>(splitResponse, '四宫格拆分失败');
        if (!Array.isArray(uploadedCells) || uploadedCells.length < group.length) {
          throw new Error(`四宫格拆分数量不足：需要 ${group.length}，实际 ${uploadedCells?.length || 0}`);
        }
        updateGridStoryboards(items => group.reduce((current, groupStoryboard, idx) => {
          const previous = current.find(item => item.id === groupStoryboard.id);
          const newImageUrl = uploadedCells[idx];
          if (!previous || !newImageUrl) {
            if (!newImageUrl) console.warn(`No image URL for ${groupStoryboard.id} at index ${idx}`);
            return current;
          }
          console.log(`Setting imageUrl for ${groupStoryboard.id}:`, newImageUrl);
          return replaceStoryboardAndInvalidateChangedVideo(current, {
            ...previous,
            imageUrl: newImageUrl,
            gridSourceUrl: persistedGridUrl || previous.gridSourceUrl,
            status: 'completed' as const,
            imageFailureReason: undefined,
          });
        }, items));
        } catch (error) {
          if (!options.resumeTaskId && (error instanceof GridPromptCapacityError || error instanceof ImageReferenceCapacityError)) {
            // The grid has not been submitted. Preserve each full shot and its
            // references through the ordinary single-image recovery path.
            for (const member of group) {
              const latest = storyboardsRef.current.find(item => item.id === member.id) || member;
              if (!hasUsableStoryboardImage(latest)) {
                if (autoRunLockRef.current) setAutoStage(`逐镜生图：镜头 ${latest.sceneNumber}`);
                await handleGenerateImage(latest, { throwOnError: true });
              }
            }
            continue;
          }
          console.error('Grid generation failed:', error);
          const contentRejected = isImageSafetyRejection(error);
          const terminalTaskFailure = error instanceof TerminalImageTaskError && !contentRejected;
          updateGridStoryboards(items => items.map(sb => group.some(g => g.id === sb.id) ? {
            ...sb,
            // A polling timeout or split/upload failure does not prove that the
            // paid image task failed. Keep it recoverable and reattach to the
            // same id; only an explicit provider failure permits resubmission.
            status: !contentRejected && !terminalTaskFailure && sb.taskId ? 'generating' : 'failed',
            taskId: terminalTaskFailure ? undefined : sb.taskId,
            imageTaskMode: terminalTaskFailure ? undefined : sb.imageTaskMode,
            imageGridSize: terminalTaskFailure ? undefined : sb.imageGridSize,
            imageFailureReason: extractImageTaskError(error),
          } : sb));
          const range = `${group[0]?.sceneNumber ?? '?'}–${group[group.length - 1]?.sceneNumber ?? '?'}`;
          failedBatches.push(`${range}: ${extractImageTaskError(error)}`);
          // A deterministic size rejection must not submit every remaining
          // batch with the same oversized state or enter the auto-retry loop.
          if (isRequestTooLargeError(error)) {
            if (options.throwOnError) throw error;
            alert(failedBatches.join('\n'));
            return;
          }
        }
      }
      // A single failed APIMart batch must never prevent later batches from
      // being submitted. Report once after the whole queue has been attempted.
      if (failedBatches.length > 0) {
        const summary = `以下四宫格批次生成失败：\n${failedBatches.join('\n')}`;
        if (options.throwOnError) throw new Error(summary);
        alert(summary);
      }
    } catch (error) {
      if (options.throwOnError) throw error;
      alert(extractImageTaskError(error));
    } finally {
      setIsGeneratingGrid(false);
    }
  };

  // Step4: individual image generation
  const handleGenerateImage = async (storyboard: Storyboard, options: { throwOnError?: boolean } = {}) => {
    const activeSettings = { ...settingsRef.current, imageModel: resolveCharacterStoryboardModel(settingsRef.current.imageModel, charactersRef.current) };
    if (imageModelRequiresApiKey(activeSettings.imageModel) && !activeSettings.apiKey) {
      const error = new Error('Please configure API Key in settings');
      if (options.throwOnError) throw error;
      alert(error.message);
      return;
    }
    const generationProjectId = projectIdRef.current;
    try {
      const latestBeforeStart = storyboardsRef.current.find(item => item.id === storyboard.id) || storyboard;
      if (hasUsableStoryboardImage(latestBeforeStart)) return;
      if (latestBeforeStart.status === 'failed' && isImageSafetyRejection(latestBeforeStart.imageFailureReason))
        throw new TerminalImageTaskError(latestBeforeStart.imageFailureReason || '上游审核拒绝');
      const initialRisks = analyzeImagePromptSafety(`${storyboard.prompt}\n${storyboard.description}`);
      const maxSafetyAttempts = 1; // Preflight only; provider refusals require review.
      for (let safetyAttempt = 0; safetyAttempt < maxSafetyAttempts; safetyAttempt += 1) {
        const shouldRewrite = initialRisks.length > 0 || safetyAttempt > 0 || Boolean(storyboard.imagePromptOverride);
        const safetyLevel: 1 | 2 = initialRisks.length > 0 && safetyAttempt === 0 || safetyAttempt === 1 ? 1 : 2;
        const imagePrompt = storyboard.imagePromptOverride || storyboard.imageCastRepairPrompt || storyboard.prompt;
        const prompt = shouldRewrite ? rewriteImagePromptForSafety(imagePrompt, safetyLevel) : imagePrompt;
        setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? {
          ...sb,
          status: 'generating',
          imagePromptOverride: shouldRewrite ? prompt : sb.imagePromptOverride,
          imageFailureReason: shouldRewrite
            ? `${initialRisks.length ? `检测到${imageSafetyReasonLabel(initialRisks)}` : '供应商内容安全拒绝'}；已自动修正并进行第 ${safetyAttempt + 1} 次生成`
            : undefined,
          imageRetryCount: safetyAttempt,
        } : sb));
        try {
          const latest = storyboardsRef.current.find(item => item.id === storyboard.id) || storyboard;
          let taskId = safetyAttempt === 0 && latest.imageTaskMode === 'single' ? latest.taskId : undefined;
          if (!taskId) {
            await ensureStoryVisualAssets();
            const requestBody = await prepareImageRequestRef.current({ storyboard: { ...storyboard, prompt, capturePreset: capturePresetRef.current }, characters: effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters), objects: objectsRef.current, aspectRatio: projectAspectRatioRef.current, imageModel: activeSettings.imageModel, apiKey: activeSettings.apiKey, costumeImages: costumeImagesRef.current, sceneImage: storyboard.sceneImageOverride || sceneImagesRef.current[0] || '', visualStyle, capturePreset: capturePresetRef.current, comfyui: localComfyUISettings(activeSettings.comfyui), styleReference: styleReferenceRef.current, midjourneyStyle: resolveMidjourneyStyleSetting(activeSettings), midjourneyProfile: resolveMidjourneyProfileSetting(activeSettings) });
            if (generationProjectId !== projectIdRef.current || (autoRunLockRef.current && autoAbortRef.current)) throw new Error('制作已暂停或项目已切换，未提交新的分镜任务');
            const response = await fetch(imageApiUrl('/api/generate', activeSettings.comfyui, activeSettings.imageModel), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: requestBody,
            });
            const data = await readApiJson<{ taskId: string }>(response, '启动单张分镜生成失败');
            taskId = data.taskId;
            if (!taskId) throw new Error('生图接口没有返回任务 ID');
            const acceptedBoards = storyboardsRef.current.map(item => item.id === storyboard.id ? {
              ...item,
              taskId,
              imageTaskMode: 'single' as const,
              status: 'generating' as const,
            } : item);
            storyboardsRef.current = acceptedBoards;
            setStoryboards(acceptedBoards);
            // Persist immediately after the billable task is accepted. A
            // refresh can now reconnect to this exact task instead of paying
            // for a duplicate single-image repair.
            persistCurrentProject(acceptedBoards);
          }
          await pollImageStatus(storyboard.id, taskId, generationProjectId, activeSettings.apiKey);
          persistCurrentProject();
          return;
        } catch (error) {
          throw error;
        }
      }
    } catch (error) {
      if (generationProjectId !== projectIdRef.current) return;
      const contentRejected = isImageSafetyRejection(error);
      const terminalTaskFailure = error instanceof TerminalImageTaskError && !contentRejected;
      commitStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? {
        ...sb,
        status: !contentRejected && !terminalTaskFailure && sb.taskId ? 'generating' : 'failed',
        taskId: terminalTaskFailure ? undefined : sb.taskId,
        imageTaskMode: terminalTaskFailure ? undefined : sb.imageTaskMode,
        imageFailureReason: error instanceof Error ? error.message : 'Unknown image generation error',
      } : sb));
      persistCurrentProject();
      if (options.throwOnError) throw error;
    }
  };

  const pollImageStatus = async (storyboardId: string, taskId: string, generationProjectId = projectIdRef.current, apiKey = settingsRef.current.apiKey) => {
    let lastActiveAt: number | undefined;
    for (let i = 0; i < 90; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (generationProjectId !== projectIdRef.current) return;
      let response: Response;
      try {
        response = await fetch(imageApiUrl('/api/check-image-status', settingsRef.current.comfyui, taskId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey, comfyui: localComfyUISettings(settingsRef.current.comfyui) })
        });
      } catch {
        continue;
      }
      if (!response.ok) continue;
      const data = await response.json().catch(() => undefined);
      if (!data) continue;
      if (['submitted', 'pending', 'queued', 'processing', 'running', 'in_progress', 'generating'].includes(data.status)) lastActiveAt = Date.now();
      if (generationProjectId !== projectIdRef.current) return;
      if (data.status === 'completed' && data.imageUrl) {
          // Keep the paid task id if storage fails, so recovery downloads the
          // existing result instead of buying another image generation.
          const imageUrl = await persistLocalGeneratedImage(data.imageUrl, settingsRef.current.comfyui);
          if (generationProjectId !== projectIdRef.current) return;
          const previous = storyboardsRef.current.find(sb => sb.id === storyboardId);
          if (!previous) return;
          const updated = { ...previous, status: 'completed' as const, imageUrl, taskId, imageFailureReason: undefined,
            imageCandidateUrls: data.provider === 'midjourney' && Array.isArray(data.candidateUrls) ? data.candidateUrls.slice(1, 4).filter((url: unknown): url is string => typeof url === 'string' && url.startsWith('https://')) : undefined };
          const next = replaceStoryboardAndInvalidateChangedVideo(storyboardsRef.current, updated);
          storyboardsRef.current = next;
          setStoryboards(next);
          return;
      }
      if (data.status === 'failed') throw new TerminalImageTaskError(extractImageTaskError(data) || 'Image generation failed');
    }
    if (generationProjectId !== projectIdRef.current) return;
    throw imagePollingTimeoutError(taskId, lastActiveAt);
  };

  const handleGenerateCostume = async (
    type: 'costume' | 'scene',
    characterName?: string,
    options: { throwOnError?: boolean } = {},
  ) => {
    const activeSettings = { ...settingsRef.current, imageModel: resolveCharacterStoryboardModel(settingsRef.current.imageModel, charactersRef.current) };
    if (imageModelRequiresApiKey(activeSettings.imageModel) && !activeSettings.apiKey) {
      const error = new Error('请先在设置中配置 APIMart API Key');
      if (options.throwOnError) throw error;
      alert(error.message);
      return;
    }
    const generationProjectId = projectIdRef.current;
    const productionCast = effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters);
    const character = characterName ? productionCast.find(c => c.name === characterName) : undefined;
    const sceneStyle = storyboardsRef.current[0]?.sceneStyle;
    const representativeStoryboard = storyboardsRef.current.find(storyboard => (
      (storyboard.characters || []).some(name => productionCast.some(member => member.name === name))
    )) || storyboardsRef.current[0];
    const anchorCharacter = productionCast.find(member => member.imageUrl || member.imageBase64)
      || productionCast.find(member => costumeImagesRef.current[member.name]);

    if (type === 'costume' && characterName) {
      setCostumeGenerating(prev => ({ ...prev, [characterName]: true }));
    } else {
      setSceneGenerating(true);
    }

    try {
      const response = await fetch(imageApiUrl('/api/generate-costume', activeSettings.comfyui, activeSettings.imageModel), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, name: characterName,
          inheritReferenceLook: type === 'scene' ? Boolean(anchorCharacter) : Boolean(character?.visualMaster),
          description: character?.description || '',
          costumeDesc: characterName ? storyboardsRef.current[0]?.characterCostume?.[characterName] : undefined,
          sceneStyle,
          representativeShot: type === 'scene'
            ? (representativeStoryboard?.prompt || representativeStoryboard?.description || representativeStoryboard?.action || '')
            : undefined,
          storyCharacterNames: type === 'scene' ? productionCast.map(member => member.name) : undefined,
          // MJ 用角色卡生成“人物处在故事场景里”的电影母版；其他模型
          // 仍可把同一输入当作媒介/风格锚点。
          referenceImageUrl: type === 'scene'
            ? (anchorCharacter
                ? (costumeImagesRef.current[anchorCharacter.name] || anchorCharacter.imageUrl || anchorCharacter.imageBase64)
                : undefined)
            : (character?.imageUrl || character?.imageBase64),
          aspectRatio: projectAspectRatioRef.current,
          imageModel: activeSettings.imageModel,
          apiKey: activeSettings.apiKey,
          visualStyle,
          capturePreset: capturePresetRef.current,
          comfyui: localComfyUISettings(activeSettings.comfyui),
          styleReference: styleReferenceRef.current, midjourneyStyle: resolveMidjourneyStyleSetting(activeSettings), midjourneyProfile: resolveMidjourneyProfileSetting(activeSettings),
        })
      });
      const { taskId } = await readApiJson<{ taskId: string }>(response, type === 'costume' ? '生成角色定妆失败' : '生成场景参考失败');
      if (!taskId) throw new Error('生图接口没有返回任务 ID');

      // Poll for completion
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 3000));
        if (generationProjectId !== projectIdRef.current) return;
        const statusRes = await fetch(imageApiUrl('/api/check-image-status', activeSettings.comfyui, taskId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey: activeSettings.apiKey, comfyui: localComfyUISettings(activeSettings.comfyui) })
        });
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        if (generationProjectId !== projectIdRef.current) return;
        if (statusData.status === 'completed' && statusData.imageUrl) {
          if (type === 'costume' && characterName) {
            const persistedImageUrl = await persistLocalGeneratedImage(statusData.imageUrl, activeSettings.comfyui);
            const nextCostumeImages = { ...costumeImagesRef.current, [characterName]: persistedImageUrl };
            costumeImagesRef.current = nextCostumeImages;
            setCostumeImages(nextCostumeImages);
          } else {
            const persistedImageUrl = await persistLocalGeneratedImage(statusData.imageUrl, activeSettings.comfyui);
            const nextSceneImages = [...sceneImagesRef.current, persistedImageUrl];
            sceneImagesRef.current = nextSceneImages;
            setSceneImages(nextSceneImages);
          }
          return;
        }
        if (statusData.status === 'failed') throw new Error('Image generation failed');
      }
      throw new Error('Timeout');
    } catch (error) {
      if (generationProjectId !== projectIdRef.current) return;
      if (options.throwOnError) throw error;
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (type === 'costume' && characterName) {
        setCostumeGenerating(prev => ({ ...prev, [characterName]: false }));
      } else {
        setSceneGenerating(false);
      }
    }
  };

  const handleGenerateVoiceReference = async (
    characterName: string,
    options: { throwOnError?: boolean } = {},
  ) => {
    const activeSettings = settingsRef.current;
    if (!activeSettings.fishAudioKey) {
      const error = new Error('请先在设置中配置 Fish Audio API Key');
      if (options.throwOnError) throw error;
      alert(error.message);
      return;
    }
    const generationProjectId = projectIdRef.current;
    const voiceCast = effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters);
    const character = characterIdentityIndex(voiceCast).resolve(characterName);
    if (!character) return;
    setVoiceGenerating(prev => ({ ...prev, [characterName]: true }));
    try {
      const res = await fetch('/api/generate-voice-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterName,
          language: projectLanguageRef.current,
          voiceId: character.voiceId,
          fishAudioKey: activeSettings.fishAudioKey,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const { url } = await res.json();
      if (generationProjectId !== projectIdRef.current) return;
      const nextVoiceReferences = characterAliasValues({ ...(voiceReferencesRef.current || {}), [character.name]: url }, voiceCast);
      voiceReferencesRef.current = nextVoiceReferences;
      setVoiceReferences(nextVoiceReferences);
      persistCurrentProject();
    } catch (err) {
      if (generationProjectId !== projectIdRef.current) return;
      if (options.throwOnError) throw err;
      alert(`Voice reference failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setVoiceGenerating(prev => ({ ...prev, [characterName]: false }));
    }
  };

  const handleGenerateVideoPrompt = async (storyboard: Storyboard, requestedSegment?: Storyboard[], rewriteDirection = false, options: { throwOnError?: boolean } = {}) => {
    const generationProjectId = projectIdRef.current;
    const segmentIds = (requestedSegment?.length ? requestedSegment : [storyboard]).map(item => item.id);
    const requestedById = new Map((requestedSegment || []).map(item => [item.id, item]));
    const voiceCast = effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters);
    const segmentStoryboards = lockStoryboardVoiceIds(storyboardsRef.current
      .filter(item => segmentIds.includes(item.id))
      .sort((a, b) => a.sceneNumber - b.sceneNumber)
      .map(item => ({ ...item, ...(requestedById.get(item.id) || {}), imageUrl: item.imageUrl, visualStyle, capturePreset: capturePresetRef.current })), voiceCast);
    const leader = segmentStoryboards[0];
    const hasFirstFrame = false;
    const videoProvider = settingsRef.current.videoProvider || 'apimart';
    const referenceAudioNames = videoProvider === 'fal' ? [] : [...new Set(segmentStoryboards
      .flatMap(item => storyboardSpeech(item).map(line => line.character)))]
      .filter(name => Boolean(name && currentCastVoiceReferences()[name]))
      .slice(0, 3);
    const voiceProfiles = characterAliasValues(Object.fromEntries(voiceCast
      .filter(character => character.voiceProfile)
      .map(character => [character.name, character.voiceProfile!])), voiceCast);
    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: 'generating...' } : sb));
    try {
      const response = await fetch(videoProvider === 'comfyui'
        ? comfyUIApiUrl('/api/generate-video-prompt', settingsRef.current.comfyui)
        : '/api/generate-video-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleReference: styleReferenceRef.current, storyboard: { ...storyboard, visualStyle, capturePreset: capturePresetRef.current }, segmentStoryboards, isFilmEnding: isFilmEndingSegment(storyboardsRef.current, segmentStoryboards), referenceAudioNames, voiceProfiles: videoProvider === 'fal' ? voiceProfiles : {}, language: projectLanguageRef.current, hasFirstFrame, rewriteDirection, apiKey: settingsRef.current.apiKey, dmxApiKey: settingsRef.current.dmxApiKey, scriptProvider: settingsRef.current.scriptProvider || 'auto', scriptModel: settingsRef.current.scriptModel || 'gpt-4o' })
      });
      const data = await readApiJson<{ videoPrompt: string; directions?: Array<Pick<Storyboard, 'id' | 'videoDirection' | 'videoDirectionSource'>> }>(response, '视频提示词生成失败');
      if (generationProjectId !== projectIdRef.current) return;
      if (segmentStoryboards.some(source => {
        const current = storyboardsRef.current.find(item => item.id === source.id);
        return !current || videoDirectionSourceKey({ ...current, visualStyle, capturePreset: capturePresetRef.current }) !== videoDirectionSourceKey(source);
      })) throw new Error('镜头内容在细化期间已改变，请重新生成提示词');
      // This is the complete H3 prompt. If the user edits and saves it, the
      // generation route submits the edited text verbatim.
      const updated = storyboardsRef.current.map(sb => {
        const direction = data.directions?.find(item => item.id === sb.id);
        const next = direction ? { ...sb, videoDirection: direction.videoDirection, videoDirectionSource: direction.videoDirectionSource } : sb;
        return sb.id === storyboard.id ? { ...next, videoPrompt: data.videoPrompt, videoPromptOverride: false } : next;
      });
      storyboardsRef.current = updated;
      setStoryboards(updated);
      return data.videoPrompt;
    } catch (error) {
      if (generationProjectId !== projectIdRef.current) return;
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id && sb.videoPrompt === 'generating...' ? { ...sb, videoPrompt: storyboard.videoPrompt || '' } : sb));
      if (options.throwOnError) throw error;
      alert(`视频提示词生成失败：${error instanceof Error ? error.message : '未知错误'}`);
      return undefined;
    }
  };

  const handleGenerateVideo = async (
    storyboard: Storyboard,
    requestedSegment?: Storyboard[],
    options: { throwOnError?: boolean } = {},
  ) => {
    const generationProjectId = projectIdRef.current;
    const activeSettings = settingsRef.current;
    const failBeforeSubmission = (message: string) => {
      const error = new Error(message);
      if (options.throwOnError) throw error;
      alert(message);
    };
    const videoProvider = activeSettings.videoProvider || 'apimart';
    if (videoProvider === 'apimart' && !activeSettings.apiKey) {
      failBeforeSubmission('请先在设置中配置 APIMart API Key');
      return;
    }
    if (videoProvider === 'fal' && !activeSettings.fal?.apiKey) {
      failBeforeSubmission('请先在设置中配置 fal API Key');
      return;
    }
    if (requestedSegment && requestedSegment.length > 1) {
      // A user can redo a saved historical multi-shot clip. New work is always
      // one image per request; the legacy membership remains readable until redo.
      for (const single of splitPlannedVideoSegment(storyboardsRef.current, requestedSegment)) {
        if (generationProjectId !== projectIdRef.current) return;
        if (isCompletedPlannedVideoSegment(storyboardsRef.current, single)) continue;
        await handleGenerateVideo(single[0], single, options);
      }
      return;
    }
    const currentShots = storyboardsRef.current;
    const requestedIds = (requestedSegment?.length ? requestedSegment : [storyboard]).map(item => item.id);
    const requestedById = new Map((requestedSegment || []).map(item => [item.id, item]));
    let segment = lockStoryboardVoiceIds(currentShots
      .filter(item => requestedIds.includes(item.id))
      .sort((a, b) => a.sceneNumber - b.sceneNumber)
      .map(item => ({ ...item, ...(requestedById.get(item.id) || {}), imageUrl: item.imageUrl, videoStartMode: 'storyboard' as const, continuousFromPrev: false, ...((item.videoSegmentStoryboardIds?.length || 0) > 1 ? { videoPrompt: undefined, videoPromptOverride: false } : {}) })), effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters));
    // One-click generation must use the same source adaptation as the manual
    // prompt button. A stale/invalid brief must not silently become a generic
    // image-action template. Valid briefs and explicit user prompts cost no call.
    if (['comfyui', 'fal'].includes(videoProvider) && segment.length && !segment[0].videoPromptOverride
      && segment.some(item => { try { return !currentChineseVideoDirection(item); } catch { return true; } })) {
      try {
        await handleGenerateVideoPrompt(segment[0], segment, false, { throwOnError: true });
        if (generationProjectId !== projectIdRef.current) return;
        segment = segment.map(item => {
          const updated = storyboardsRef.current.find(shot => shot.id === item.id);
          const next = { ...item, videoDirection: updated?.videoDirection, videoDirectionSource: updated?.videoDirectionSource };
          if (!currentChineseVideoDirection(next)) throw new Error(`第 ${item.sceneNumber} 镜动作稿仍需转换为中文；保留分镜，不提交通用模板`);
          return next;
        });
      } catch (error) {
        failBeforeSubmission(error instanceof Error ? error.message : '视频动作稿自动适配失败');
        return;
      }
    }
    const validationError = validateVideoSegment(segment, projectLanguageRef.current);
    if (validationError) {
      failBeforeSubmission(validationError);
      return;
    }
    if (segment.length > 1 && videoProvider !== 'comfyui' && videoProvider !== 'fal') {
      failBeforeSubmission('多分镜单片段需要 MiniMax H3，请在设置中选择 fal H3 Max 或仙宫云 ComfyUI');
      return;
    }

    if (videoProvider === 'comfyui') {
      try {
        const statusResponse = await fetch(comfyUIApiUrl('/api/companion/status', activeSettings.comfyui), { cache: 'no-store', signal: AbortSignal.timeout(2500) });
        const status = statusResponse.ok ? await statusResponse.json() : undefined;
        if (!status?.ok || !companionVersionAtLeast(String(status.version || ''), SEGMENT_VIDEO_COMPANION_MIN_VERSION)) {
          throw new Error(`单镜单图与 pruned 四步生成需要 Companion v${SEGMENT_VIDEO_COMPANION_MIN_VERSION.join('.')} 或更高版本；当前版本为 ${status?.version || '未知'}`);
        }
      } catch (error) {
        failBeforeSubmission(error instanceof Error ? error.message : '无法确认 Companion 版本');
        return;
      }
    }

    const segmentIds = segment.map(item => item.id);
    const leader = segment[0];
    const segmentId = `segment-${Date.now()}-${leader.sceneNumber}`;
    const duration = filmEndingDuration(estimateVideoSegmentSeconds(segment), isFilmEndingSegment(currentShots, segment), undefined, leader.videoEndingMinimumDuration);
    // Each storyboard owns its first frame. Motion-context continuation is
    // reserved for the dedicated continuous-shot workflow, not editorial cuts.
    const shouldContinuePreviousSegment = false;
    const finalSegment = isFilmEndingSegment(currentShots, segment);
    const motionContext: { chainId: string; segmentIndex: number } | undefined = undefined;
    const generationInputs = segment.map(item => ({
      ...item,
      videoProviderUsed: videoProvider,
      videoSeed: videoProvider === 'fal' && Number.isInteger(activeSettings.fal?.seed) ? activeSettings.fal?.seed : undefined,
      ...(item.id === leader.id ? { continuousFromPrev: shouldContinuePreviousSegment } : {}),
    }));
    const generationSignature = videoSegmentGenerationSignature(generationInputs);
    commitStoryboards(prev => {
      const oldSegmentIds = new Set(prev.filter(item => segmentIds.includes(item.id)).map(item => item.videoSegmentId).filter(Boolean));
      return prev.map(item => {
        const belongsToReplacedSegment = item.videoSegmentId && oldSegmentIds.has(item.videoSegmentId);
        if (!segmentIds.includes(item.id)) {
          return belongsToReplacedSegment ? {
            ...item,
            videoSegmentId: undefined,
            videoSegmentStoryboardIds: undefined,
            videoGenerationSignature: undefined,
            videoStatus: 'pending' as const,
            videoUrl: undefined,
            videoSourceUrl: undefined,
            videoCacheKey: undefined,
            videoCacheStatus: undefined,
            videoCachedAt: undefined,
            videoTaskId: undefined,
          } : item;
        }
        return {
          ...item,
          visualStyle,
          capturePreset: capturePresetRef.current,
          videoStatus: 'generating' as const,
          videoUrl: undefined,
          videoSourceUrl: undefined,
          videoCacheKey: undefined,
          videoCacheStatus: undefined,
          videoCachedAt: undefined,
          videoTaskId: undefined,
          videoProviderUsed: videoProvider,
          videoSeed: videoProvider === 'fal' && Number.isInteger(activeSettings.fal?.seed) ? activeSettings.fal?.seed : undefined,
          videoContinuityChainId: undefined,
          videoContinuitySegmentIndex: undefined,
          videoStartMode: 'storyboard',
          videoSegmentId: segmentId,
          videoSegmentStoryboardIds: item.id === leader.id ? segmentIds : undefined,
          videoGenerationSignature: item.id === leader.id ? generationSignature : undefined,
          videoDuration: duration,
          continuousFromPrev: false,
        };
      });
    });
    let submittedTaskId: string | undefined;
    try {
      const portableSegment = await Promise.all(segment.map(async item => ({
        ...item,
        visualStyle,
        capturePreset: capturePresetRef.current,
        imageUrl: videoProvider === 'comfyui'
          // Crop once to the project ratio and use a quality/size ladder before
          // inlining. H3 receives a sharp standalone frame instead of a huge
          // 4K mother grid or a soft low-resolution crop.
          ? await prepareStoryboardReference(item.imageUrl!, `场景 ${item.sceneNumber} 分镜图`, projectAspectRatioRef.current)
          : item.imageUrl,
      })));
      const speakingCharacters = [...new Set(segment.flatMap(item => storyboardSpeech(item).map(line => line.character)))];
      // Manual segment generation must be as self-sufficient as one-click
      // production. A character's Fish voiceId locks casting, while this tiny
      // reference file is generated once and reused only to teach H3 the
      // timbre. Older projects may have the voiceId but no current calibration
      // artifact, so create it lazily instead of presenting an enabled button
      // that fails after the user clicks it.
      if (videoProvider === 'comfyui') {
        for (const character of speakingCharacters) {
          if (!currentCastVoiceReferences()[character]) {
            await handleGenerateVoiceReference(character, { throwOnError: true });
          }
        }
      }
      const missingVoiceReference = videoProvider === 'comfyui'
        ? speakingCharacters.find(character => !currentCastVoiceReferences()[character])
        : undefined;
      if (missingVoiceReference) {
        throw new Error(`角色“${missingVoiceReference}”尚未生成全片音色参考；请先在第 3 步锁定一次 Fish Audio 音色`);
      }
      const portableVoiceEntries = videoProvider === 'comfyui'
        ? await Promise.all(speakingCharacters.map(async character => {
            const source = currentCastVoiceReferences()[character];
            return source
              ? [character, await makePortableMediaSource(source, `${character} 声音参考`, true)] as const
              : undefined;
          }))
        : [];
      const portableVoiceReferences = Object.fromEntries(portableVoiceEntries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
      const voiceCast = effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters);
      const voiceProfiles = characterAliasValues(Object.fromEntries(voiceCast
        .filter(character => character.voiceProfile)
        .map(character => [character.name, character.voiceProfile!])), voiceCast);
      const storyboardForRequest = {
        ...portableSegment[0],
        continuousFromPrev: shouldContinuePreviousSegment,
        videoStartMode: shouldContinuePreviousSegment ? 'previous-segment-tail' : 'storyboard',
        videoDuration: duration,
        videoSegmentId: segmentId,
        videoSegmentStoryboardIds: segmentIds,
      };

      const firstFrameUrl = undefined;

      const generationUrl = videoProvider === 'comfyui'
        ? comfyUIApiUrl('/api/generate-video', activeSettings.comfyui)
        : '/api/generate-video';
      const subtitleRemovalSourceTaskId = videoProvider === 'comfyui'
        ? videoSubtitleRemovalSourceTaskId(leader)
        : undefined;
      const response = await fetch(generationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleReference: styleReferenceRef.current, storyboard: storyboardForRequest, segmentStoryboards: portableSegment, isFilmEnding: finalSegment, language: projectLanguageRef.current, apiKey: activeSettings.apiKey, dmxApiKey: activeSettings.dmxApiKey, scriptProvider: activeSettings.scriptProvider || 'auto', scriptModel: activeSettings.scriptModel || 'gpt-4o', videoModel: activeSettings.videoModel, aspectRatio: projectAspectRatioRef.current, firstFrameUrl, motionContext, subtitleRemovalSourceTaskId, voiceReferences: videoProvider === 'comfyui' ? portableVoiceReferences : (voiceReferencesRef.current || {}), voiceProfiles: videoProvider === 'fal' ? voiceProfiles : {}, videoProvider, fal: activeSettings.fal, comfyui: localComfyUISettings(activeSettings.comfyui) })
      });
      const data = await readApiJson<{ taskId: string; videoPrompt?: string }>(response, '视频任务创建失败');
      submittedTaskId = data.taskId;
      if (generationProjectId !== projectIdRef.current) return;
      const submittedStoryboards = storyboardsRef.current.map(sb => segmentIds.includes(sb.id) ? {
        ...sb,
        videoTaskId: sb.id === leader.id ? data.taskId : undefined,
        ...(sb.id === leader.id && data.videoPrompt ? { videoPrompt: data.videoPrompt } : {}),
      } : sb);
      storyboardsRef.current = submittedStoryboards;
      setStoryboards(submittedStoryboards);
      // Persist the paid remote task immediately. A refresh in the first
      // 30 seconds must not lose the only identifier that can recover it.
      saveProject({
        characters: charactersRef.current,
        objects: objectsRef.current,
        storyContent,
        language: projectLanguageRef.current,
        targetShotCount,
        aspectRatio: projectAspectRatioRef.current,
        visualStyle,
        capturePreset: capturePresetRef.current,
        productionTiming: productionTimingRef.current,
        storyOutline: '',
        storyboards: submittedStoryboards,
        voiceReferences: voiceReferencesRef.current,
        costumeImages: costumeImagesRef.current,
        sceneImages: sceneImagesRef.current,
      styleReference: styleReferenceRef.current,
        storyPlan: storyPlanRef.current,
        videoSegmentPlan: videoSegmentPlanRef.current,
        createdAt: new Date().toISOString(),
      });
      await pollVideoStatus(leader.id, data.taskId, segmentIds, generationProjectId, generationSignature);
    } catch (error) {
      console.error('Video generation failed:', error);
      if (generationProjectId !== projectIdRef.current) return;
      if (submittedTaskId && !(error instanceof TerminalVideoTaskError)) {
        // The paid ComfyUI job already exists. A temporary SSH tunnel/status
        // failure does not prove that the render failed, so keep its durable id
        // and let auto-production reattach to the same task after backoff.
        // Clearing it here used to submit a duplicate H3 render while the first
        // one was still running (or had already completed successfully).
        const resumableStoryboards = storyboardsRef.current.map(sb => segmentIds.includes(sb.id) ? {
          ...sb,
          videoStatus: 'generating' as const,
          videoTaskId: sb.id === leader.id ? submittedTaskId : undefined,
        } : sb);
        storyboardsRef.current = resumableStoryboards;
        setStoryboards(resumableStoryboards);
        persistCurrentProject(resumableStoryboards);
        if (options.throwOnError) throw error;
        alert(`视频任务已提交，但状态查询暂时失败；任务号已保留，可稍后自动恢复：${error instanceof Error ? error.message : '未知错误'}`);
        return;
      }
      // Do not rely on the 30-second autosave after a pre-enqueue failure.
      // Synchronize state/ref/storage immediately so refresh cannot resurrect
      // the optimistic generating lock without a recoverable task id.
      const failedStoryboards = storyboardsRef.current.map(sb => segmentIds.includes(sb.id) ? {
        ...sb,
        videoStatus: 'failed' as const,
        videoTaskId: undefined,
      } : sb);
      storyboardsRef.current = failedStoryboards;
      setStoryboards(failedStoryboards);
      persistCurrentProject(failedStoryboards);
      if (options.throwOnError) throw error;
      alert(`视频生成失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const pollVideoStatus = (
    storyboardId: string,
    taskId: string,
    segmentStoryboardIds: string[] = [storyboardId],
    generationProjectId = projectIdRef.current,
    generationSignature?: string,
  ): Promise<void> => {
    const existingPoll = activeVideoPollsRef.current.get(taskId);
    if (existingPoll) return existingPoll;

    const pollPromise = (async () => {
      const isComfyTask = isComfyUIClientTask(taskId);
      let consecutiveErrors = 0;
      for (let i = 0; i < 180; i++) {
        // Recovery checks immediately. Newly submitted jobs still settle into
        // the regular ten-second cadence after this first inexpensive probe.
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 10000));
        if (generationProjectId !== projectIdRef.current) return;
        try {
          const currentSettings = settingsRef.current;
          const statusUrl = isComfyTask
            ? comfyUIApiUrl('/api/check-video-status', currentSettings.comfyui)
            : '/api/check-video-status';
          const response = await fetch(statusUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId,
              apiKey: currentSettings.apiKey,
              fal: currentSettings.fal,
              localDelivery: isComfyTask,
              comfyui: localComfyUISettings(currentSettings.comfyui),
            })
          });
          if (!response.ok) throw new Error(await videoStatusResponseError(response));

          const data = await response.json();
          if (generationProjectId !== projectIdRef.current) return;

          if (isComfyTask && data.status === 'completed' && data.readyForDownload) {
            const localVideoUrl = await downloadComfyUIVideo(taskId, currentSettings.comfyui, { smoothAudioTail: true });
            await cacheCompletedVideo(storyboardId, localVideoUrl, segmentStoryboardIds, generationProjectId, generationSignature, taskId);
            return;
          }
          if (data.status === 'completed' && data.videoUrl) {
            await cacheCompletedVideo(storyboardId, data.videoUrl, segmentStoryboardIds, generationProjectId, generationSignature, taskId);
            return;
          }
          if (data.status === 'failed') throw new TerminalVideoTaskError(data.error || '视频任务执行失败');
          consecutiveErrors = 0;
        } catch (error) {
          console.error('Video status polling error:', error);
          if (error instanceof TerminalVideoTaskError) throw error;
          consecutiveErrors += 1;
          if (consecutiveErrors >= 3) {
            throw new Error(`视频回传失败：${error instanceof Error ? error.message : '无法连接本地 Companion'}`);
          }
        }
      }
      if (generationProjectId !== projectIdRef.current) return;
      throw new Error('视频生成超时（30 分钟内未完成）');
    })();

    activeVideoPollsRef.current.set(taskId, pollPromise);
    void pollPromise.finally(() => {
      if (activeVideoPollsRef.current.get(taskId) === pollPromise) {
        activeVideoPollsRef.current.delete(taskId);
      }
    }).catch(() => undefined);
    return pollPromise;
  };

  // 一键成片：编剧 → 定妆/音色 → 图片 → 视频 → 合并下载。
  // 每个阶段会持续重试，直到成功、切换项目或用户主动暂停。
  const handleAutoGenerate = async (ownsCrossTabLease = false): Promise<void> => {
    if (autoRunLockRef.current) {
      // Let the paused orchestration observe autoAbort=true and unwind before
      // starting a replacement. Clearing the abort flag immediately can leave
      // the old call parked inside a retry/poll while the UI claims it resumed.
      if (autoAbortRef.current || autoPaused) {
        markAutoProduction(projectIdRef.current, 'running');
        setAutoPaused(false);
        setAutoRunning(true);
        setAutoStage('正在安全接管断点任务…');
        const resumeWhenReleased = () => {
          if (autoRunLockRef.current) {
            autoResumeAfterPauseTimerRef.current = window.setTimeout(resumeWhenReleased, 250);
            return;
          }
          autoResumeAfterPauseTimerRef.current = undefined;
          autoAbortRef.current = false;
          void handleAutoGenerate();
        };
        if (!autoResumeAfterPauseTimerRef.current) {
          autoResumeAfterPauseTimerRef.current = window.setTimeout(resumeWhenReleased, 250);
        }
      }
      return;
    }
    // localStorage persists the desired orchestration state, but it does not
    // provide mutual exclusion. Without a browser-wide lease every open Story
    // tab resumes the same project and can purchase/submit the same H3 segment.
    // Web Locks releases automatically when the owning tab closes or crashes;
    // a waiting tab then resumes from the already persisted task/image state.
    if (!ownsCrossTabLease && typeof navigator !== 'undefined' && navigator.locks?.request) {
      let acquired = false;
      await navigator.locks.request(
        autoProductionLockName(projectIdRef.current),
        { ifAvailable: true },
        async lock => {
          if (!lock) return;
          acquired = true;
          autoOwnsCrossTabLeaseRef.current = true;
          if (autoLeaseRetryTimerRef.current) {
            window.clearTimeout(autoLeaseRetryTimerRef.current);
            autoLeaseRetryTimerRef.current = undefined;
          }
          try {
            await handleAutoGenerate(true);
          } finally {
            autoOwnsCrossTabLeaseRef.current = false;
          }
        },
      );
      if (!acquired) {
        setAutoRunning(false);
        setAutoStage('另一标签页正在托管本项目；本页只同步进度');
        if (!autoLeaseRetryTimerRef.current) {
          autoLeaseRetryTimerRef.current = window.setTimeout(() => {
            autoLeaseRetryTimerRef.current = undefined;
            const saved = savedAutoProduction();
            if (saved?.projectId === projectIdRef.current && saved.status === 'running') {
              void handleAutoGenerate();
            }
          }, 5000);
        }
      }
      return;
    }
    const initialSettings = settingsRef.current;
    if (imageModelRequiresApiKey(initialSettings.imageModel) && !initialSettings.apiKey) { alert('一键成片使用 APIMart 生图时需要先配置 API Key'); return; }
    if (charactersRef.current.length === 0) { alert('一键成片至少需要一个角色'); return; }
    if (storyboardsRef.current.length === 0 && !storyContent.trim()) { alert('请先填写故事内容'); return; }
    autoRunLockRef.current = true;
    const nextProductionTiming = startProductionTiming(productionTimingRef.current);
    productionTimingRef.current = nextProductionTiming;
    setProductionTiming(nextProductionTiming);
    markAutoProduction(projectIdRef.current, 'running');
    setAutoPaused(false);
    setAutoRunning(true);
    setAutoStage('编剧 + 分镜');
    autoAbortRef.current = false;
    persistCurrentProject();

    const waitBeforeRetry = async (milliseconds: number) => {
      const deadline = Date.now() + milliseconds;
      while (!autoAbortRef.current && Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, Math.min(1000, deadline - Date.now())));
      }
    };
    const retryUntilCompleted = async <T,>(label: string, operation: () => Promise<T>): Promise<T | undefined> => {
      let failureCount = 0;
      let transientFailureCount = 0;
      while (!autoAbortRef.current) {
        try {
          setAutoStage(failureCount ? `${label}（第 ${failureCount + 1} 次尝试）` : label);
          const result = await operation();
          persistCurrentProject();
          return result;
        } catch (error) {
          if (autoAbortRef.current) return undefined;
          persistCurrentProject();
          if (error instanceof AwaitingMediaTaskError) {
            setAutoStage(`${label}：原任务仍在处理中，15 秒后继续查询`);
            await waitBeforeRetry(15_000);
            continue;
          }
          if (isImageSafetyRejection(error) || isRequestTooLargeError(error)) throw error;
          const transient = isTransientAutoProductionError(error);
          if (transient) transientFailureCount += 1;
          else failureCount += 1;
          const count = transient ? transientFailureCount : failureCount;
          if (batchRunId && count >= (transient ? 6 : batchStageRetries)) throw error;
          const delayMilliseconds = autoRetryDelayMs(count);
          const delaySeconds = Math.round(delayMilliseconds / 1000);
          const message = error instanceof Error ? error.message : '未知错误';
          setAutoStage(`${label}失败：${message}；${delaySeconds} 秒后自动重试`);
          await waitBeforeRetry(delayMilliseconds);
        }
      }
      return undefined;
    };

    try {
      if (storyboardsRef.current.length === 0) {
        await retryUntilCompleted('编剧 + 分镜', async () => {
          const generated = await runScript(true);
          if (!generated.length) throw new Error('导演阶段没有返回任何分镜');
          return generated;
        });
        if (autoAbortRef.current) return;
        setCurrentStep(3);
      }

      if (storyStorageKeys().isolated) {
        const contract = localStorage.getItem(storyStorageKeys().contract);
        if (!contract) throw new Error('连续剧定稿合同缺失，停止制作以避免角色或台词漂移');
        const reconciled = reconcileSeriesProductionContract(JSON.parse(contract), effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters));
        if (JSON.stringify(reconciled) !== contract) localStorage.setItem(storyStorageKeys().contract, JSON.stringify(reconciled));
        validateSeriesProduction(reconciled, storyboardsRef.current);
      }
      const productionCast = effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters);
      for (const character of productionCast) {
        if (autoAbortRef.current) return;
        // A supplied role card is already the identity input for MJ. Generating
        // another MJ character sheet here only adds cost and portrait bias
        // before the actual story-world master frame is created.
        const midjourneyRoleCardReady = isMidjourneyImageModel(settingsRef.current.imageModel)
          && Boolean(character.imageUrl || character.imageBase64);
        if (midjourneyRoleCardReady || character.visualMaster) continue;
        if (!costumeImagesRef.current[character.name]) {
          await retryUntilCompleted(`生成 ${character.name} 定妆`, async () => {
            await handleGenerateCostume('costume', character.name, { throwOnError: true });
            if (!costumeImagesRef.current[character.name]) throw new Error('任务结束但没有返回定妆图');
          });
        }
      }
      if (sceneImagesRef.current.length === 0) {
        await retryUntilCompleted('生成场景参考', async () => {
          await handleGenerateCostume('scene', undefined, { throwOnError: true });
          if (sceneImagesRef.current.length === 0) throw new Error('任务结束但没有返回场景图');
        });
      }
      if (storyboardsRef.current.some(storyboard => storyboard.visualPromptRewriteId)) {
        await retryUntilCompleted('按最新角色、道具与规范重写分镜及视频提示词', async () => {
          const rewritten = await rewriteVisualPromptsForRedo();
          if (rewritten.some(storyboard => storyboard.visualPromptRewriteId)) {
            throw new Error('提示词重写完成但断点标记尚未清除');
          }
          return rewritten;
        });
        if (autoAbortRef.current) return;
      }
      const effectiveVoiceCast = effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters);
      const identities = characterIdentityIndex(effectiveVoiceCast);
      for (const character of effectiveVoiceCast) {
        if (autoAbortRef.current) return;
        const speaks = storyboardsRef.current.some(storyboard => storyboardSpeech(storyboard).some(line => identities.resolve(line.character) === character));
        const autoVideoProvider = settingsRef.current.videoProvider || 'apimart';
        if (speaks && autoVideoProvider !== 'fal' && !character.voiceId) {
          throw new Error(`${character.name} 有台词但尚未确认性别与 Fish Audio 音色；请在第 3 步“全片音色选角”中确认`);
        }
        if (speaks && autoVideoProvider !== 'fal' && settingsRef.current.fishAudioKey && !currentCastVoiceReferences()[character.name]) {
          await retryUntilCompleted(`生成 ${character.name} 音色参考`, async () => {
            await handleGenerateVoiceReference(character.name, { throwOnError: true });
            if (!currentCastVoiceReferences()[character.name]) throw new Error('任务结束但没有返回音色参考');
          });
        }
      }
      if (autoAbortRef.current) return;

      setCurrentStep(4);
      await retryUntilCompleted(isMidjourneyImageModel(resolveCharacterStoryboardModel(settingsRef.current.imageModel, charactersRef.current)) ? 'MJ 逐镜生成分镜图' : '四宫格生成分镜图', async () => {
        const { chunkGridBatch } = await import('@/lib/gridSplitter');
        const normalized = storyboardsRef.current.map(normalizeStoryboardImageArtifact);
        if (normalized.some((item, index) => item !== storyboardsRef.current[index])) {
          commitStoryboards(() => normalized);
          persistCurrentProject(normalized);
        }
        // Keep the director's original four-shot batch boundaries. Filtering
        // failed cards first would shift panel indexes and can assign a crop to
        // the wrong scene on retry.
        for (const group of chunkGridBatch(storyboardsRef.current)) {
          const plan = planAutoImageBatch(group, resolveCharacterStoryboardModel(settingsRef.current.imageModel, charactersRef.current));
          if (plan.kind === 'skip') continue;
          if (plan.kind === 'await-legacy-grid') throw new AwaitingMediaTaskError(plan.taskId);
          if (plan.kind === 'resume-grid') {
            await handleGenerateGrid(group, { throwOnError: true, resumeTaskId: plan.taskId });
            continue;
          }
          if (plan.kind === 'generate-grid') {
            await handleGenerateGrid(group, { throwOnError: true });
            continue;
          }
          for (const storyboardId of plan.storyboardIds) {
            const missing = storyboardsRef.current.find(item => item.id === storyboardId);
            if (!missing || hasUsableStoryboardImage(missing)) continue;
            setAutoStage(`逐镜生图：镜头 ${missing.sceneNumber}`);
            await handleGenerateImage(missing, { throwOnError: true });
          }
        }
        const unfinished = storyboardsRef.current.filter(sb => !hasUsableStoryboardImage(sb));
        if (unfinished.length) throw new Error(`仍有 ${unfinished.length} 个分镜未完成`);
      });
      if (autoAbortRef.current) return;
      setCurrentStep(5);
      const videoProvider = settingsRef.current.videoProvider || 'apimart';
      const isH3SegmentProvider = videoProvider === 'comfyui' || videoProvider === 'fal';
      const videoGroups = (isH3SegmentProvider
        ? resolveVideoSegmentGroups(
            storyboardsRef.current.filter(item => item.imageUrl),
            videoSegmentPlanRef.current,
            projectLanguageRef.current,
          )
        : storyboardsRef.current.filter(item => item.imageUrl).map(item => [item]))
        .map(group => lockStoryboardVoiceIds(group, effectiveVoiceCast));
      const deliveryAudit = auditStoryDelivery(storyPlanRef.current, storyboardsRef.current, videoGroups);
      if (deliveryAudit.errors.length) {
        throw new Error(`视频分段前故事交付校验失败：${deliveryAudit.errors.slice(0, 4).join('；')}`);
      }
      const completeVideoGroup = async (group: Storyboard[]) => {
        if (autoAbortRef.current) return;
        const groupLabel = `视频片段 ${group.map(item => item.sceneNumber).join('·')}`;
        const completeGroup = async () => {
          const latestGroup = refreshPlannedVideoSegment(storyboardsRef.current, group);
          const latestLeader = latestGroup[0];
          const alreadyDone = isH3SegmentProvider
            ? isCompletedPlannedVideoSegment(storyboardsRef.current, group)
            : latestGroup.every(item => item.videoStatus === 'completed' && item.videoUrl);
          if (alreadyDone) return;

          const savedTaskId = latestLeader.videoTaskId;
          if (savedTaskId) {
            try {
              await pollVideoStatus(
                latestLeader.id,
                savedTaskId,
                latestGroup.map(item => item.id),
                projectIdRef.current,
                latestLeader.videoGenerationSignature,
              );
            } catch (error) {
              // Network/status timeouts do not prove the paid task failed.
              // Keep its id and reattach after backoff; only an explicit
              // terminal provider failure is allowed to purchase a new task.
              if (!(error instanceof TerminalVideoTaskError)) throw error;
              console.warn(`${groupLabel} 的旧任务已明确失败，将提交新任务:`, error);
            }
            const recovered = latestGroup.map(item => storyboardsRef.current.find(current => current.id === item.id) || item);
            const recoveredDone = isH3SegmentProvider
              ? isCompletedPlannedVideoSegment(storyboardsRef.current, group)
              : recovered.every(item => item.videoStatus === 'completed' && item.videoUrl);
            if (recoveredDone) return;
          }

          await handleGenerateVideo(latestLeader, latestGroup, { throwOnError: true });
          const completed = latestGroup.map(item => storyboardsRef.current.find(current => current.id === item.id) || item);
          const isDone = isH3SegmentProvider
            ? (isCompletedPlannedVideoSegment(storyboardsRef.current, group)
              || splitPlannedVideoSegment(storyboardsRef.current, group).every(single => isCompletedPlannedVideoSegment(storyboardsRef.current, single)))
            : completed.every(item => item.videoStatus === 'completed' && item.videoUrl);
          if (!isDone) throw new Error('任务结束但没有返回完整视频');
        };
        await retryUntilCompleted(groupLabel, completeGroup);
        if (videoProvider === 'comfyui' && isFilmEndingSegment(storyboardsRef.current, group)) {
          // Ending direction belongs in the generation prompt, not a second ASR gate.
          // Resume paid clips unchanged, including checkpoints with a failed old audit.
          commitStoryboards(items => retainFilmEndingForDelivery(items, group));
          persistCurrentProject();
        }
      };

      // Keep at most two independent paid renders in flight. The local H3 GPU
      // still executes its queue safely, while reference preparation, upload,
      // polling, download and cache writes overlap. Each new render uses its own image.
      for (const batch of planAutoVideoBatches(videoGroups)) {
        if (autoAbortRef.current) return;
        const results = await Promise.allSettled(batch.map(completeVideoGroup));
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failed) throw failed.reason;
      }
      if (autoAbortRef.current) return;

      // A resumed batch can have every paid segment marked completed while its
      // ephemeral blob URL is absent from the new page. Step 6 only exports
      // leaders with a readable videoUrl, so entering it immediately used to
      // produce a plausible but truncated film (for example 4 of 16 clips).
      // Rehydrate every authoritative segment from IndexedDB or its existing
      // task before rendering the editor. This never submits a new video task.
      setAutoStage('恢复全部视频片段用于合成');
      let exportStoryboards = storyboardsRef.current;
      // A terminal historical multi-shot task may have been replaced by several
      // single-shot renders. Recover every new leader, not the old batch shape.
      const exportGroups = isH3SegmentProvider
        ? resolveVideoSegmentGroups(exportStoryboards.filter(item => item.imageUrl), videoSegmentPlanRef.current, projectLanguageRef.current)
        : videoGroups;
      for (const planned of exportGroups) {
        const current = refreshPlannedVideoSegment(exportStoryboards, planned);
        const leader = current[0];
        if (!leader || leader.videoStatus !== 'completed' || !leader.videoTaskId) {
          throw new Error(`导出前镜头 ${planned.map(item => item.sceneNumber).join('·')} 尚未完成`);
        }
        if (leader.videoUrl) continue;
        let recovered = leader.videoCacheKey
          ? await cachedVideoObjectUrl(leader.videoCacheKey)
          : undefined;
        if (!recovered) recovered = leader.videoSourceUrl;
        if (!recovered && isComfyUIClientTask(leader.videoTaskId)) {
          const downloaded = await downloadComfyUIVideo(leader.videoTaskId, settingsRef.current.comfyui, { smoothAudioTail: true });
          if (leader.videoCacheKey) {
            const cached = await cacheVideoSource(leader.videoCacheKey, downloaded);
            recovered = cached.objectUrl;
          } else recovered = downloaded;
        }
        if (!recovered) throw new Error(`导出前无法恢复镜头 ${leader.sceneNumber} 的已有视频`);
        exportStoryboards = exportStoryboards.map(item => item.id === leader.id ? {
          ...item, videoUrl: recovered, videoCacheStatus: leader.videoCacheKey ? 'completed' as const : item.videoCacheStatus,
        } : item);
      }
      const missingExportSegments = exportGroups.filter(group => {
        const leader = refreshPlannedVideoSegment(exportStoryboards, group)[0];
        return !leader?.videoUrl;
      });
      if (missingExportSegments.length) {
        throw new Error(`导出前仍缺少 ${missingExportSegments.length} 个已生成视频片段，已保留断点`);
      }
      storyboardsRef.current = exportStoryboards;
      setStoryboards(exportStoryboards);
      persistCurrentProject();

      setCurrentStep(6);
      await retryUntilCompleted('合并并导出成片', () => new Promise<void>((resolve, reject) => {
        autoExportCompletionRef.current = { resolve, reject };
        setAutoExportRequestId(current => current + 1);
      }));
      if (autoAbortRef.current) return;
      clearAutoProduction(projectIdRef.current);
      setAutoPaused(false);
      setAutoStage('成片已导出');
    } catch (error) {
      if (autoAbortRef.current) return;
      const message = error instanceof Error ? error.message : 'Unknown error';
      const pausedTiming = pauseProductionTiming(productionTimingRef.current);
      productionTimingRef.current = pausedTiming;
      setProductionTiming(pausedTiming);
      markAutoProduction(projectIdRef.current, 'paused');
      setAutoPaused(true);
      persistCurrentProject();
      if (batchRunId) {
        postBatchEvent({ event: 'failed', projectId: projectIdRef.current, error: message });
      } else {
        alert(`自动生成中断：${message}`);
      }
    } finally {
      autoRunLockRef.current = false;
      setAutoRunning(false);
      if (savedAutoProduction()?.status !== 'paused') setAutoStage('');
    }
  };

  const handleAutoStop = () => {
    autoAbortRef.current = true;
    if (autoResumeAfterPauseTimerRef.current) {
      window.clearTimeout(autoResumeAfterPauseTimerRef.current);
      autoResumeAfterPauseTimerRef.current = undefined;
    }
    if (autoLeaseRetryTimerRef.current) {
      window.clearTimeout(autoLeaseRetryTimerRef.current);
      autoLeaseRetryTimerRef.current = undefined;
    }
    const pausedTiming = pauseProductionTiming(productionTimingRef.current);
    productionTimingRef.current = pausedTiming;
    setProductionTiming(pausedTiming);
    persistCurrentProject();
    markAutoProduction(projectIdRef.current, 'paused');
    setAutoPaused(true);
    setAutoRunning(false);
    setAutoStage('已暂停；已提交的任务仍会在后台完成');
  };

  const handleAutoExportComplete = (result: VideoEditorExportResult) => {
    const completion = autoExportCompletionRef.current;
    autoExportCompletionRef.current = undefined;
    const completedTiming = completeProductionTiming(productionTimingRef.current);
    productionTimingRef.current = completedTiming;
    setProductionTiming(completedTiming);
    persistCurrentProject();
    if (batchRunId) {
      let project: unknown;
      try {
        project = JSON.parse(localStorage.getItem(storyStorageKeys().current) || 'null');
      } catch {}
      postBatchEvent({
        event: 'completed',
        projectId: projectIdRef.current,
        fileName: result.fileName,
        jobId: result.jobId,
        blob: result.blob,
        project,
      });
    }
    completion?.resolve();
  };

  const handleAutoExportError = (error: unknown) => {
    const completion = autoExportCompletionRef.current;
    autoExportCompletionRef.current = undefined;
    completion?.reject(error);
  };

  useEffect(() => {
    if (!autoResumeRequested || autoRunLockRef.current) return;
    if ((imageModelRequiresApiKey(settings.imageModel) && !settings.apiKey)
      || projectIdRef.current !== savedAutoProductionProjectId()) return;
    setAutoResumeRequested(false);
    void handleAutoGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResumeRequested, settings.apiKey, projectId]);

  const completedImages = storyboards.filter(s => s.status === 'completed').length;
  const completedVideos = storyboards.filter(s => s.videoStatus === 'completed').length;

  return (
    <div className="aid-theme-teal contents">
    <DevToolsLayout
      toolbar={
        <Toolbar
          projectName={projectName}
          onProjectNameChange={setProjectName}
          onNewProject={newProject}
          onOpen={handleOpen}
          onSave={handleSave}
          onExport={handleExport}
          onSettings={() => setShowSettings(true)}
        />
      }
      statusBar={
        <StatusBar
          totalScenes={storyboards.length}
          completedScenes={completedImages}
          failedScenes={storyboards.filter(s => s.status === 'failed').length}
          isGenerating={isLoading}
          currentTask={isLoading ? scriptGenerationPhaseLabel(scriptGenerationPhase) : undefined}
        />
      }
    >
      {isCanvasMode && storyboards.length > 0 ? (
        <div className="relative h-full bg-[var(--bg-primary)]">
          <CanvasMode
            key={projectId}
            storyContent={storyContent}
            storyboards={storyboards}
            videoSegmentPlan={videoSegmentPlan}
            onExit={() => setIsCanvasMode(false)}
            onUpdate={handleUpdateStoryboard}
            onGenerateImage={handleGenerateImage}
            onGenerateVideoPrompt={handleGenerateVideoPrompt}
            onGenerateVideo={handleGenerateVideo}
            onGenerateGrid={handleGenerateGrid}
            singleShotMode={isMidjourneyImageModel(resolveCharacterStoryboardModel(settings.imageModel, characters))}
          />
        </div>
      ) : (
        <div className="min-h-full bg-[var(--bg-primary)]">
          <div className="mx-auto max-w-[1440px] p-3 md:p-7">
            <div className="aid-page-lead mb-5">
              <div><p className="aid-eyebrow">Story production pipeline</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">从故事设定到完整视频</h1><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">按步骤固定角色、剧本与视觉参考，每一步的结果都会带到下一阶段。</p></div>
              <div className="flex gap-2"><span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">STEP {String(currentStep).padStart(2, '0')} / 06</span><span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">{storyboards.length} SCENES</span></div>
            </div>
            <div className="flex items-center justify-between mb-4">
              <StepIndicator
                currentStep={currentStep}
                steps={['角色', '故事', '剧本', '图片', '视频', '导出']}
              />
              <div className="flex items-center gap-2">
                {(storyContent.trim() || storyboards.length > 0) && (
                  autoRunning ? (
                    <button
                      onClick={handleAutoStop}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--error)] hover:bg-[#c0392b] text-white border border-[var(--border-color)] rounded transition-colors"
                    >
                      ⏸ 暂停
                    </button>
                  ) : (
                    <button
                      onClick={() => { void handleAutoGenerate(); }}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#5dd18d] text-[var(--bg-primary)] border border-[var(--border-color)] rounded transition-colors"
                    >
                      {autoPaused ? '▶ 继续成片' : '✨ 一键成片'}
                    </button>
                  )
                )}
                {(autoRunning || autoPaused) && (
                  <span className="text-xs font-mono text-[var(--accent-yellow)]">{autoStage}…</span>
                )}
                {productionTiming && (
                  <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--workspace-accent)]">
                    ⏱ {productionTiming.status === 'completed' ? '总耗时' : productionTiming.status === 'paused' ? '已暂停' : '已用时'} {formatProductionElapsed(productionElapsedMs(productionTiming, productionClock))}
                  </span>
                )}
                {storyboards.length > 0 && (
                  <button
                    onClick={() => setIsCanvasMode(true)}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
                  >
                    <Grid2X2 size={14} />
                    无限画布
                  </button>
                )}
              </div>
            </div>
            {currentStep === 1 && (
              <Step2
                characters={characters}
                objects={objects}
                onCharactersChange={setCharacters}
                onObjectsChange={setObjects}
                onBack={() => {}}
                onNext={() => setCurrentStep(2)}
                isLoading={false}
                visualStyle={visualStyle}
                onVisualStyleChange={handleVisualStyleChange}
                capturePreset={capturePreset}
                onCapturePresetChange={handleCapturePresetChange}
              />
            )}
            {currentStep === 2 && (
              <Step1
                storyContent={storyContent}
                onStoryLoad={setStoryContent}
                onNext={handleGenerateScript}
                onBack={() => setCurrentStep(1)}
                isLoading={isLoading}
                language={projectLanguage}
                onLanguageChange={(lang) => {
                  projectLanguageLockedRef.current = true;
                  projectLanguageRef.current = lang;
                  setProjectLanguage(lang);
                  const nextSettings = { ...settingsRef.current, language: lang };
                  settingsRef.current = nextSettings;
                  saveSettings(nextSettings);
                }}
                targetShotCount={targetShotCount}
                onTargetShotCountChange={setTargetShotCount}
                aspectRatio={projectAspectRatio}
                onAspectRatioChange={handleAspectRatioChange}
                apiKey={settings.apiKey}
                scriptProvider={settings.scriptProvider || 'auto'}
                scriptModel={settings.scriptModel}
                dmxApiKey={settings.dmxApiKey}
                companionSettings={settings.comfyui}
                generationPhase={scriptGenerationPhase}
              />
            )}
            {currentStep === 3 && (
              <Step3
                storyPlan={storyPlan}
                storyboards={storyboards}
                characters={characters}
                objects={objects}
                costumeImages={costumeImages}
                costumeGenerating={costumeGenerating}
                sceneImage={sceneImages[0] || ''}
                sceneImages={sceneImages}
                sceneGenerating={sceneGenerating}
                onBack={() => setCurrentStep(2)}
                onNext={() => setCurrentStep(4)}
                onUpdate={handleUpdateStoryboard}
                onGenerateCostume={handleGenerateCostume}
                onClearCostumeImage={(name) => setCostumeImages(prev => { const n = { ...prev }; delete n[name]; return n; })}
                onClearSceneImage={(idx) => setSceneImages(prev => prev.filter((_, i) => i !== idx))}
                voiceReferences={characterAliasValues(voiceReferences, effectiveStoryCast(characters, storyPlan?.characters))}
                voiceGenerating={voiceGenerating}
                onGenerateVoiceReference={handleGenerateVoiceReference}
                onClearVoiceReference={(name) => {
                  const next = withoutCharacterValues(voiceReferencesRef.current, name, effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters));
                  voiceReferencesRef.current = next;
                  setVoiceReferences(next);
                }}
                onVoiceCastChange={handleVoiceCastChange}
              />
            )}
            {currentStep === 4 && (
              <Step4
                storyboards={storyboards}
                onBack={() => setCurrentStep(3)}
                onNext={() => setCurrentStep(5)}
                onGenerateImage={handleGenerateImage}
                onRetry={handleGenerateImage}
                onUpdate={handleUpdateStoryboard}
                onGenerateGrid={handleGenerateGrid}
                isGeneratingGrid={isGeneratingGrid}
                singleShotMode={isMidjourneyImageModel(resolveCharacterStoryboardModel(settings.imageModel, characters))}
              />
            )}
            {currentStep === 5 && (
              <Step5
                storyboards={storyboards}
                characters={effectiveStoryCast(characters, storyPlan?.characters)}
                videoModel={settings.videoModel}
                videoProvider={settings.videoProvider || 'apimart'}
                aspectRatio={projectAspectRatio}
                language={projectLanguage}
                voiceReferences={characterAliasValues(voiceReferences, effectiveStoryCast(characters, storyPlan?.characters))}
                videoSegmentPlan={videoSegmentPlan}
                productionTiming={productionTiming}
                onVideoSegmentPlanChange={handleVideoSegmentPlanChange}
                onBack={() => setCurrentStep(4)}
                onNext={() => setCurrentStep(6)}
                onGenerateVideo={handleGenerateVideo}
                onGenerateVideoPrompt={handleGenerateVideoPrompt}
                onUpdate={handleUpdateStoryboard}
              />
            )}
            {currentStep === 6 && (
              <Step6
                storyboards={storyboards}
                projectId={projectId}
                projectName={projectName}
                companionSettings={settings.comfyui}
                aspectRatio={projectAspectRatio}
                autoExportRequestId={autoExportRequestId}
                onAutoExportComplete={handleAutoExportComplete}
                onAutoExportError={handleAutoExportError}
                downloadAfterExport={!batchRunId}
                productionTiming={productionTiming}
                onBack={() => setCurrentStep(5)}
              />
            )}
          </div>
        </div>
      )}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={handleSettingsSave}
      />
    </DevToolsLayout>
    </div>
  );
}
