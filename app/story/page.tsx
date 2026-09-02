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
import { Grid3x3 } from 'lucide-react';
import { readApiJson } from '@/lib/apiResponse';
import { buildShotCountContract, DEFAULT_TARGET_SHOT_COUNT, normalizeTargetShotCount, storyPlanBeatCount, targetDurationSeconds } from '@/lib/pipeline/shotCount';
import { canResumeStoryPlan } from '@/lib/pipeline/resumePlan';
import { cacheVideoSource, cachedVideoObjectUrl, requestPersistentVideoStorage, videoCacheKeyForStoryboard } from '@/lib/videoCache';
import { DEFAULT_VISUAL_STYLE, normalizeVisualStyle } from '@/lib/promptArchitecture';
import { createVideoSegmentPlan, estimateVideoSegmentSeconds, isCompletedPlannedVideoSegment, normalizeVideoSegmentPlan, refreshPlannedVideoSegment, releaseUnsubmittedVideoGenerations, resolveVideoSegmentGroups, restoredStoryStep, suggestVideoSegments, validateVideoSegment, videoSegmentGenerationSignature, type VideoSegmentPlan } from '@/lib/videoSegments';
import { filmEndingDuration, isFilmEndingSegment } from '@/lib/filmEnding';
import { FILM_ENDING_ASR_SKIPPED_WARNING, FILM_ENDING_WARNING, MAX_ENDING_REPAIRS, filmEndingDisposition, prepareFilmEndingRepair, type FilmEndingAudit } from '@/lib/filmEndingAudit';
import { MAX_VIDEO_DUPLICATE_REPAIRS, prepareVideoDuplicateRepair, videoDuplicateAuditScope, type VideoDuplicateAudit } from '@/lib/videoDuplicateAudit';
import { currentVoiceReferences } from '@/lib/voiceReference';
import { auditStoryDelivery } from '@/lib/storyDeliveryAudit';
import { CONTINUITY_HANDOFF_LEAD_SECONDS, previousSegmentTailSource } from '@/lib/videoContinuity';
import { prepareStoryboardReference } from '@/lib/storyboardImagePreprocess';
import { videoDirectionSourceKey } from '@/lib/videoDirection';
import { persistGeneratedStoryboardImage } from '@/lib/generatedImagePersistence';

async function persistLocalGeneratedImage(imageUrl: string): Promise<string> {
  if (!imageUrl.startsWith('data:')) return imageUrl;
  const response = await fetch('/api/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData: imageUrl }),
  });
  const data = await readApiJson<{ url: string }>(response, '本地生成图片上传失败');
  if (!data.url) throw new Error('本地生成图片上传后没有返回 URL');
  return data.url;
}
import { analyzeImagePromptSafety, extractImageTaskError, imageSafetyReasonLabel, isImageSafetyRejection, rewriteImagePromptForSafety } from '@/lib/imagePromptSafety';
import { normalizeSavedImageFailureReason, planInterruptedGridRecovery, preserveCompletedGridArtifacts } from '@/lib/gridRecovery';
import { storyboardSpeech } from '@/lib/speechAudioContract';
import { castCharacterVoice, castStoryVoices, lockStoryboardVoiceIds } from '@/lib/voiceCasting';
import { applyStoryAspectRatio, hasStoryMedia, projectStoryAspectRatio, type StoryAspectRatio } from '@/lib/storyAspectRatio';
import { storyStorageKeys } from '@/lib/series/storageScope';
import { bindSeriesPlan, buildApprovedSeriesPlan, reconcileSeriesProductionContract, validateSeriesProduction } from '@/lib/series/productionContract';
import { prepareImageCastRepair, visibleImageCast, type ImageCastCheck, type ImageCastCharacter } from '@/lib/series/imageCastContract';
import { AwaitingMediaTaskError, autoProductionLockName, autoRetryDelayMs, hasUsableStoryboardImage, imagePollingTimeoutError, isTransientAutoProductionError, normalizeStoryboardImageArtifact, planAutoImageBatch } from '@/lib/autoProduction';
import { effectiveStoryCast } from '@/lib/storyCast';
import { resolveMidjourneyProfileSetting, resolveMidjourneyStyleSetting } from '@/lib/midjourney';
import { applyCapturePreset, DEFAULT_CAPTURE_PRESET, normalizeCapturePreset } from '@/lib/capturePresets';
import { completeProductionTiming, formatProductionElapsed, normalizeProductionTiming, pauseProductionTiming, productionElapsedMs, startProductionTiming } from '@/lib/productionTiming';
import { isFalVideoTask } from '@/lib/falVideo';

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

async function extractVideoTailFrame(source: string, label: string): Promise<string> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (/^https?:\/\//i.test(source)) video.crossOrigin = 'anonymous';
  video.src = source;

  const waitFor = (event: 'loadedmetadata' | 'loadeddata' | 'seeked') => new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(event, handleReady);
      video.removeEventListener('error', handleError);
    };
    const handleReady = () => { cleanup(); resolve(); };
    const handleError = () => { cleanup(); reject(new Error(`${label}读取失败`)); };
    video.addEventListener(event, handleReady, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });

  try {
    const metadataReady = waitFor('loadedmetadata');
    video.load();
    await metadataReady;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor('loadeddata');
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
      throw new Error(`${label}缺少有效的视频尺寸或时长`);
    }

    // Hand off while motion is still alive. The editor removes the matching
    // tail interval from the preceding clip, so playback does not jump back.
    const lead = Math.min(CONTINUITY_HANDOFF_LEAD_SECONDS, video.duration / 2);
    const tailTime = Math.max(0, video.duration - lead);
    if (tailTime > 0.001) {
      const seeked = waitFor('seeked');
      video.currentTime = tailTime;
      await seeked;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`${label}尾帧画布创建失败`);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.95);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
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
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(DEFAULT_VISUAL_STYLE);
  const [capturePreset, setCapturePreset] = useState<CapturePreset>(DEFAULT_CAPTURE_PRESET);
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
      const savedStoryPlan = savedProject.storyPlan ? {
        ...savedProject.storyPlan,
        characters: castStoryVoices(savedProject.storyPlan.characters || [], savedLanguageForVoice),
      } : undefined;
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
      setTargetShotCount(normalizeTargetShotCount(savedProject.targetShotCount));
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
      const savedEffectiveVoiceCast = [
        ...savedCharacters,
        ...(savedStoryPlan?.characters || []).filter(planned => !savedCharacters.some(character => character.name === planned.name)),
      ];
      const normalizedStoryboards = lockStoryboardVoiceIds<Storyboard>((savedProject.storyboards || []).map(item => normalizeStoryboardImageArtifact({
        ...item,
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
      // A refresh used to strand a paid 3×3 task in "generating" forever.
      // Resume polling a batch when all its shots share the same saved task id.
      for (let index = 0; index < savedStoryboards.length; index += 9) {
        const group = savedStoryboards.slice(index, index + 9);
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
                void handleGenerateGrid(group, { resumeTaskId: taskId });
              } catch (error) {
                console.warn(`九宫格任务 ${taskId} 已失效，允许重新生成:`, error);
                if (savedProject.id !== projectIdRef.current) return;
                const groupIds = new Set(group.map(item => item.id));
                const recoveryFailureReason = `刷新后恢复任务失败：${extractImageTaskError(error)}；已解除锁定，请重新生成本批`;
                setStoryboards(current => {
                  const next = current.map(item => groupIds.has(item.id) ? {
                    ...item,
                    status: 'failed' as const,
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
      ...uploaded,
      ...planned,
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

    const effectiveCast = [
      ...nextCharacters,
      ...(nextPlan?.characters || []).filter(character => !nextCharacters.some(uploadedCharacter => uploadedCharacter.name === character.name)),
    ];
    const nextStoryboards = lockStoryboardVoiceIds(storyboardsRef.current, effectiveCast);
    storyboardsRef.current = nextStoryboards;
    setStoryboards(nextStoryboards);
    const currentVideoPlan = videoSegmentPlanRef.current;
    const nextVideoPlan = currentVideoPlan ? {
      ...currentVideoPlan,
      segments: currentVideoPlan.segments.map(segment => ({
        ...segment,
        speech: segment.speech.map(line => line.character === characterName ? {
          ...line,
          voiceId: resolved.voiceId || undefined,
        } : line),
      })),
      updatedAt: new Date().toISOString(),
    } : undefined;
    videoSegmentPlanRef.current = nextVideoPlan;
    setVideoSegmentPlan(nextVideoPlan);

    const previousVoiceId = uploaded?.voiceId || planned?.voiceId;
    let nextVoiceReferences = voiceReferencesRef.current;
    if (previousVoiceId !== resolved.voiceId && nextVoiceReferences?.[characterName]) {
      nextVoiceReferences = { ...nextVoiceReferences };
      delete nextVoiceReferences[characterName];
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
        const importedStoryPlan: StoryPlan | undefined = data.storyPlan ? {
          ...data.storyPlan,
          characters: castStoryVoices(data.storyPlan.characters || [], importedLanguage),
        } : undefined;
        projectLanguageLockedRef.current = Boolean(data.language);
        projectLanguageRef.current = importedLanguage;
        setProjectLanguage(importedLanguage);
        setTargetShotCount(normalizeTargetShotCount(data.targetShotCount));
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
        const importedEffectiveVoiceCast = [
          ...importedCharacters,
          ...(importedStoryPlan?.characters || []).filter(planned => !importedCharacters.some(character => character.name === planned.name)),
        ];
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
          targetShotCount: normalizeTargetShotCount(data.targetShotCount),
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
    setVisualStyle(normalized);
    productionTimingRef.current = undefined;
    setProductionTiming(undefined);
    setStoryboards(prev => {
      const next = prev.map(storyboard => storyboard.visualStyle === normalized
        ? storyboard
        : clearGeneratedVideo({ ...storyboard, visualStyle: normalized }));
      storyboardsRef.current = next;
      return next;
    });
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
  // ① 编剧 + ② 导演：梗概 → StoryPlan → 分镜。返回生成的分镜数组供编排器使用。
  const runScript = async (resume = false): Promise<Storyboard[]> => {
    // Never send uploaded image/base64/File fields to the text-only screenplay
    // endpoints. Besides wasting bandwidth, large character images can make a
    // hosting gateway reject the request with an HTML 413/5xx page.
    const language = projectLanguageRef.current;
    const voiceLockedCharacters = castStoryVoices(characters, language);
    charactersRef.current = voiceLockedCharacters;
    setCharacters(voiceLockedCharacters);
    const writerCharacters = voiceLockedCharacters.map(({ name, description, voiceId, voiceProfile, voiceSource, voiceLocked, gender, ageGroup }) => ({ name, description, voiceId, voiceProfile, voiceSource, voiceLocked, gender, ageGroup }));
    const writerObjects = objects.map(({ name, description }) => ({ name, description }));
    const activeSettings = settingsRef.current;
    // Older Companion builds ignore the structured field below, so append the
    // same production spec to the brief as a backwards-compatible contract.
    const planningSynopsis = `${storyContent.trim()}\n\n${buildShotCountContract(targetShotCount, language)}`;
    const savedSeriesContract = storyStorageKeys().isolated ? localStorage.getItem(storyStorageKeys().contract) : null;
    if (storyStorageKeys().isolated && !savedSeriesContract) throw new Error('连续剧定稿合同缺失，停止导演');
    const approvedSeriesContract = savedSeriesContract
      ? reconcileSeriesProductionContract(JSON.parse(savedSeriesContract), writerCharacters)
      : undefined;
    if (savedSeriesContract && JSON.stringify(approvedSeriesContract) !== savedSeriesContract) {
      localStorage.setItem(storyStorageKeys().contract, JSON.stringify(approvedSeriesContract));
    }
    let storyPlan = storyPlanRef.current;
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
        targetDurationSeconds: targetDurationSeconds(targetShotCount),
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
    const effectiveVoiceCast = [
      ...voiceLockedCharacters,
      ...(storyPlan.characters || []).filter(planned => (
        !voiceLockedCharacters.some(character => character.name === planned.name)
      )),
    ];
    const approvedShots = storyStorageKeys().isolated
      ? approvedSeriesContract?.shots
      : undefined;
    const styledStoryboards = lockStoryboardVoiceIds(
      storyboards.map((storyboard, index) => ({ ...storyboard, visualStyle, capturePreset: capturePresetRef.current,
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

  // Step4: batch generate via 3x3 grid
  const handleGenerateGrid = async (batch: Storyboard[], options: { throwOnError?: boolean; resumeTaskId?: string } = {}) => {
    const activeSettings = settingsRef.current;
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
    // Process in groups of 9
    try {
      for (const group of chunkGridBatch(batch)) {
        updateGridStoryboards(items => items.map(sb =>
          group.some(g => g.id === sb.id) ? { ...sb, status: 'generating' } : sb
        ));
        try {
        // Midjourney establishes the project's cinematic master frame. Nano
        // Banana 2 then turns that MJ anchor into a strict, splittable 3x3
        // contact sheet. Sending nine independent MJ jobs here produces nine
        // portrait-like candidates instead of one coherent storyboard batch.
        const gridImageModel = resolveStoryboardGridImageModel(activeSettings.imageModel);
        // Grid generation must consider the cast from every panel, not only the
        // first storyboard in the group. Otherwise later character references
        // are uploaded without a matching prompt label and can be ignored.
        const mentionsEntity = (sb: Storyboard, name: string, listedNames?: string[]) =>
          listedNames?.includes(name) ||
          sb.prompt.includes(`[${name}]`) ||
          sb.prompt.includes(name) ||
          sb.description.includes(name);
        const groupCharacters = visibleImageCast({ characters: [...new Set(group.flatMap(sb => sb.characters))] }, effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters)).filter(character =>
          group.some(sb => mentionsEntity(sb, character.name, sb.characters))
        );
        const groupObjects = objectsRef.current.filter(object =>
          group.some(sb => mentionsEntity(sb, object.name, sb.objects))
        );
        const summarize = (value: string, maxLength = 160) => {
          if (value.length <= maxLength) return value;
          const candidate = value.slice(0, maxLength - 3);
          const boundary = candidate.lastIndexOf(' ');
          return `${(boundary >= maxLength * 0.68 ? candidate.slice(0, boundary) : candidate).trimEnd()}...`;
        };

        // Build grid prompt from group's prompts
        const sceneStyle = new Set(group.map(s => s.locationId).filter(Boolean)).size > 1
          ? 'Locations vary by panel. Each mapped environment applies only to its listed shots; keep character identities consistent across locations.'
          : group[0]?.sceneStyle || '';
        const textDefinedCharacters = [...new Set(group.flatMap(sb => sb.characters || []))]
          .filter(name => !groupCharacters.some(character => character.name === name))
          .map(name => {
            const costume = group.map(sb => sb.characterCostume?.[name]).find(Boolean);
            return `${name}: ${summarize(costume || 'stable role-appropriate face, body, age, silhouette, wardrobe and color palette; text-defined identity without a separate reference image')}`;
          });
        const charDescs = [
          ...groupCharacters.map(c => `${c.name}: ${summarize(c.description)}`),
          ...textDefinedCharacters,
        ].join('\n');
        const rejected = group.find(sb => sb.status === 'failed' && isImageSafetyRejection(sb.imageFailureReason));
        if (rejected) throw new TerminalImageTaskError(rejected.imageFailureReason || '上游审核拒绝');
        const safetyFindings = group.map(sb => ({
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
          const cleanPrompt = sourcePrompt.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]/g, '$1');
          const requiredCharacters = [...new Set([
            ...(sb.characters || []),
            ...groupCharacters
              .filter(character => mentionsEntity(sb, character.name, sb.characters))
              .map(character => character.name),
          ])].filter(name => !charactersRef.current.some(c => c.name === name && (c as ImageCastCharacter).appearance === 'voice_only'));
          const requiredObjects = groupObjects
            .filter(object => mentionsEntity(sb, object.name, sb.objects))
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
            image: costumeImagesRef.current[character.name] || character.imageUrl || character.imageBase64,
            label: `CHARACTER IDENTITY: ${character.name}`
          }))
          .filter((reference): reference is { image: string; label: string } => Boolean(reference.image));
        const objectReferences = groupObjects
          .map(object => ({
            image: object.imageUrl || object.imageBase64,
            label: `OBJECT IDENTITY: ${object.name} — ${summarize(object.description)}`
          }))
          .filter((reference): reference is { image: string; label: string } => Boolean(reference.image));
        const specificScenes = [...new Set(group.map(s => s.sceneImageOverride).filter((url): url is string => Boolean(url)))];
        const sceneReference = specificScenes.length
          ? specificScenes.map(image => ({ image, label: `ENVIRONMENT: shots ${group.filter(s => s.sceneImageOverride === image).map(s => s.sceneNumber).join(',')}` }))
          : sceneImagesRef.current[0] ? [{ image: sceneImagesRef.current[0], label: 'ENVIRONMENT: scene/world reference' }] : [];
        const referenceLimit = getImageModelCapabilities(gridImageModel).maxReferenceImages;
        if (objectReferences.length > referenceLimit) {
          throw new Error(`本批需要 ${objectReferences.length} 张固定道具参考，但当前图片模型最多支持 ${referenceLimit} 张；已停止提交以避免道具被替换`);
        }
        // A registered fixed prop is an immutable identity source, not optional
        // environment flavor. Keep it ahead of every other reference for all
        // providers so a low image limit can never silently drop it.
        const references = [...objectReferences, ...characterReferences, ...sceneReference].slice(0, referenceLimit);
        const refLabels = references.map(reference => reference.label);
        const refImages = references.map(reference => reference.image);
        let gridUrl = '';
        let lastGridError: unknown;
        const maxSafetyAttempts = 1; // Preflight only; never rewrite around a provider refusal.
        for (let safetyAttempt = 0; safetyAttempt < maxSafetyAttempts && !gridUrl; safetyAttempt += 1) {
          const shotDescs = buildShotDescriptions(safetyAttempt);
          const rawGridPrompt = buildGridPrompt(
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
            let taskId = safetyAttempt === 0 && options.resumeTaskId && batch.length <= 9 ? options.resumeTaskId : '';
            if (!taskId) {
              const res = await fetch(imageApiUrl('/api/generate', activeSettings.comfyui, gridImageModel), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
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
                })
              });
              ({ taskId } = await readApiJson<{ taskId: string }>(res, '九宫格任务创建失败'));
              updateGridStoryboards(items => items.map(sb =>
                group.some(g => g.id === sb.id) ? { ...sb, taskId, imageTaskMode: 'grid' as const } : sb
              ));
              // The remote task is already billable at this point. Persist its
              // id immediately so a refresh can reattach instead of purchasing
              // a duplicate or leaving the batch stranded.
              persistCurrentProject();
            }

            // 4K nine-panel jobs regularly need more than 4.5 minutes during
            // provider congestion. Keep polling for nine minutes so the UI
            // does not report a false timeout while the paid task is healthy.
            for (let j = 0; j < 180; j++) {
              await new Promise(r => setTimeout(r, 3000));
              if (generationProjectId !== projectIdRef.current) throw new Error('项目已切换，旧项目的九宫格任务已停止回写');
              const statusRes = await fetch(imageApiUrl('/api/check-image-status', activeSettings.comfyui, taskId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, apiKey: activeSettings.apiKey, comfyui: localComfyUISettings(activeSettings.comfyui) })
              });
              if (!statusRes.ok) continue;
              const statusData = await statusRes.json();
              if (generationProjectId !== projectIdRef.current) throw new Error('项目已切换，旧项目的九宫格任务已停止回写');
              if (statusData.status === 'completed' && statusData.imageUrl) {
                gridUrl = await persistLocalGeneratedImage(statusData.imageUrl);
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
          body: JSON.stringify({ imageUrl: gridUrl })
        });
        const { cells: uploadedCells, gridUrl: persistedGridUrl } = await readApiJson<{ cells: string[]; gridUrl: string }>(splitResponse, '九宫格拆分失败');
        if (!Array.isArray(uploadedCells) || uploadedCells.length < group.length) {
          throw new Error(`九宫格拆分数量不足：需要 ${group.length}，实际 ${uploadedCells?.length || 0}`);
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
          if (error instanceof GridPromptCapacityError) {
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
            imageFailureReason: extractImageTaskError(error),
          } : sb));
          const range = `${group[0]?.sceneNumber ?? '?'}–${group[group.length - 1]?.sceneNumber ?? '?'}`;
          failedBatches.push(`${range}: ${extractImageTaskError(error)}`);
        }
      }
      // A single failed APIMart batch must never prevent later batches from
      // being submitted. Report once after the whole queue has been attempted.
      if (failedBatches.length > 0) {
        const summary = `以下九宫格批次生成失败：\n${failedBatches.join('\n')}`;
        if (options.throwOnError) throw new Error(summary);
        alert(summary);
      }
    } finally {
      setIsGeneratingGrid(false);
    }
  };

  // Step4: individual image generation
  const handleGenerateImage = async (storyboard: Storyboard, options: { throwOnError?: boolean } = {}) => {
    const activeSettings = settingsRef.current;
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
            const response = await fetch(imageApiUrl('/api/generate', activeSettings.comfyui, activeSettings.imageModel), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ storyboard: { ...storyboard, prompt, capturePreset: capturePresetRef.current }, characters: effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters), objects: objectsRef.current, aspectRatio: projectAspectRatioRef.current, imageModel: activeSettings.imageModel, apiKey: activeSettings.apiKey, costumeImages: costumeImagesRef.current, sceneImage: storyboard.sceneImageOverride || sceneImagesRef.current[0] || '', visualStyle, capturePreset: capturePresetRef.current, comfyui: localComfyUISettings(activeSettings.comfyui), styleReference: styleReferenceRef.current, midjourneyStyle: resolveMidjourneyStyleSetting(activeSettings), midjourneyProfile: resolveMidjourneyProfileSetting(activeSettings) })
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
          if (isMidjourneyImageModel(activeSettings.imageModel)) {
            for (;;) {
            // Check before moving to the next shot; always compare with the
            // fixed original cast, never propagate an unaudited generated face.
            const current = storyboardsRef.current.find(s => s.id === storyboard.id);
            if (!current?.imageUrl || generationProjectId !== projectIdRef.current) return;
            const cast: ImageCastCharacter[] = effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters).map(c => ({ name: c.name, description: c.description, appearance: (c as ImageCastCharacter).appearance, imageUrl: costumeImagesRef.current[c.name] || c.imageUrl }));
            const response = await fetchStoryApi('/api/series/audit-images', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ boards: [{ sceneNumber: current.sceneNumber, imageUrl: current.imageUrl, characters: current.characters, requireSingleFrame: true }], characters: cast, apiKey: activeSettings.apiKey, dmxApiKey: activeSettings.dmxApiKey, scriptProvider: activeSettings.scriptProvider || 'auto', scriptModel: activeSettings.scriptModel || 'gpt-4o' }),
            }, activeSettings.comfyui);
            const { checks } = await readApiJson<{ checks: ImageCastCheck[] }>(response, 'MJ 单镜角色核验失败');
            const check = checks?.[0];
            if (checks?.length !== 1 || check.sceneNumber !== current.sceneNumber || check.imageUrl !== current.imageUrl || ![true, false, null].includes(check.passed)) throw new Error('MJ 核验未返回当前镜头结果');
            if (generationProjectId !== projectIdRef.current || storyboardsRef.current.find(s => s.id === current.id)?.imageUrl !== check.imageUrl) return;
            if (check.passed === false) {
              const candidates = current.imageCandidateUrls || [];
              if (candidates.length) {
                const upload = await fetch('/api/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageData: candidates[0] }) });
                const { url } = await readApiJson<{ url: string }>(upload, '保存 MJ 备用候选失败');
                if (!url || generationProjectId !== projectIdRef.current) return;
                const nextBoards = replaceStoryboardAndInvalidateChangedVideo(storyboardsRef.current, { ...current, imageUrl: url, imageCandidateUrls: candidates.slice(1) });
                storyboardsRef.current = nextBoards;
                setStoryboards(nextBoards);
                persistCurrentProject(nextBoards);
                continue;
              }
              const repaired = prepareImageCastRepair(current, check, cast);
              const repairedBoards = replaceStoryboardAndInvalidateChangedVideo(storyboardsRef.current, repaired);
              storyboardsRef.current = repairedBoards;
              setStoryboards(repairedBoards);
              persistCurrentProject(repairedBoards);
              await handleGenerateImage(repaired, options);
            } else {
              commitStoryboards(items => items.map(s => s.id === current.id ? { ...s, imageCastReviewWarning: check.passed === null ? check.issues.join('；') : undefined } : s));
              persistCurrentProject();
            }
            break;
            }
          }
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
          const imageUrl = await persistGeneratedStoryboardImage(data.imageUrl);
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
    const activeSettings = settingsRef.current;
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
            const persistedImageUrl = await persistLocalGeneratedImage(statusData.imageUrl);
            const nextCostumeImages = { ...costumeImagesRef.current, [characterName]: persistedImageUrl };
            costumeImagesRef.current = nextCostumeImages;
            setCostumeImages(nextCostumeImages);
          } else {
            const persistedImageUrl = await persistLocalGeneratedImage(statusData.imageUrl);
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
    const character = charactersRef.current.find(c => c.name === characterName)
      || storyPlanRef.current?.characters.find(c => c.name === characterName);
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
      const nextVoiceReferences = { ...(voiceReferencesRef.current || {}), [characterName]: url };
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

  const handleGenerateVideoPrompt = async (storyboard: Storyboard, requestedSegment?: Storyboard[], rewriteDirection = false) => {
    const generationProjectId = projectIdRef.current;
    const segmentIds = (requestedSegment?.length ? requestedSegment : [storyboard]).map(item => item.id);
    const requestedById = new Map((requestedSegment || []).map(item => [item.id, item]));
    const segmentStoryboards = storyboardsRef.current
      .filter(item => segmentIds.includes(item.id))
      .sort((a, b) => a.sceneNumber - b.sceneNumber)
      .map(item => ({ ...item, ...(requestedById.get(item.id) || {}), imageUrl: item.imageUrl, visualStyle, capturePreset: capturePresetRef.current }));
    const leader = segmentStoryboards[0];
    const hasFirstFrame = Boolean(leader && previousSegmentTailSource(storyboardsRef.current, leader));
    const videoProvider = settingsRef.current.videoProvider || 'apimart';
    const referenceAudioNames = videoProvider === 'fal' ? [] : [...new Set(segmentStoryboards
      .flatMap(item => storyboardSpeech(item).map(line => line.character)))]
      .filter(name => Boolean(name && voiceReferencesRef.current?.[name]))
      .slice(0, 3);
    const voiceProfiles = Object.fromEntries(effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters)
      .filter(character => character.voiceProfile)
      .map(character => [character.name, character.voiceProfile!]));
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
      setStoryboards(prev => prev.map(sb => {
        const direction = data.directions?.find(item => item.id === sb.id);
        const next = direction ? { ...sb, videoDirection: direction.videoDirection, videoDirectionSource: direction.videoDirectionSource } : sb;
        return sb.id === storyboard.id ? { ...next, videoPrompt: data.videoPrompt, videoPromptOverride: false } : next;
      }));
      return data.videoPrompt;
    } catch (error) {
      if (generationProjectId !== projectIdRef.current) return;
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id && sb.videoPrompt === 'generating...' ? { ...sb, videoPrompt: storyboard.videoPrompt || '' } : sb));
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
    const currentShots = storyboardsRef.current;
    const requestedIds = (requestedSegment?.length ? requestedSegment : [storyboard]).map(item => item.id);
    const requestedById = new Map((requestedSegment || []).map(item => [item.id, item]));
    const segment = currentShots
      .filter(item => requestedIds.includes(item.id))
      .sort((a, b) => a.sceneNumber - b.sceneNumber)
      .map(item => ({ ...item, ...(requestedById.get(item.id) || {}), imageUrl: item.imageUrl }));
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
          throw new Error(`新版 H3 电影提示词与多分镜片段需要 Companion v${SEGMENT_VIDEO_COMPANION_MIN_VERSION.join('.')} 或更高版本；当前版本为 ${status?.version || '未知'}`);
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
    const prevShot = previousSegmentTailSource(currentShots, leader);
    if (leader.videoStartMode === 'previous-segment-tail' && !prevShot) {
      failBeforeSubmission('无法接续上一段：必须同场同地点、相邻片段已完成且不是换场转场；请选择“当前分镜首帧”。');
      return;
    }
    const shouldContinuePreviousSegment = Boolean(prevShot);
    const finalSegment = isFilmEndingSegment(currentShots, segment);
    const motionContextEnabled = videoProvider === 'comfyui'
      && activeSettings.comfyui?.h3ContinuityMode === 'motion-context';
    const configuredContextFrames = Number(activeSettings.comfyui?.h3MotionContextFrames || 22);
    const contextFrames = ([5, 22, 39].includes(configuredContextFrames) ? configuredContextFrames : 22) as 5 | 22 | 39;
    const previousContextIndex = Number(prevShot?.videoContinuitySegmentIndex);
    const previousContextReady = Boolean(
      prevShot?.videoContinuityChainId
      && Number.isInteger(previousContextIndex)
      && previousContextIndex >= 0,
    );
    const motionContext = motionContextEnabled ? {
      chainId: previousContextReady
        ? prevShot!.videoContinuityChainId!
        : (leader.videoContinuitySegmentIndex === 0 && leader.videoContinuityChainId
            ? leader.videoContinuityChainId
            : `aid-${generationProjectId}-${leader.id}`),
      segmentIndex: previousContextReady ? previousContextIndex + 1 : 0,
      contextFrames,
      continueAudio: true,
      isFinalSegment: finalSegment,
    } : undefined;
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
          videoContinuityChainId: motionContext?.chainId,
          videoContinuitySegmentIndex: motionContext?.segmentIndex,
          videoSegmentId: segmentId,
          videoSegmentStoryboardIds: item.id === leader.id ? segmentIds : undefined,
          videoGenerationSignature: item.id === leader.id ? generationSignature : undefined,
          videoDuration: duration,
          continuousFromPrev: item.id === leader.id ? shouldContinuePreviousSegment : item.continuousFromPrev,
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
          if (!voiceReferencesRef.current?.[character]) {
            await handleGenerateVoiceReference(character, { throwOnError: true });
          }
        }
      }
      const missingVoiceReference = videoProvider === 'comfyui'
        ? speakingCharacters.find(character => !voiceReferencesRef.current?.[character])
        : undefined;
      if (missingVoiceReference) {
        throw new Error(`角色“${missingVoiceReference}”尚未生成全片音色参考；请先在第 3 步锁定一次 Fish Audio 音色`);
      }
      const portableVoiceEntries = videoProvider === 'comfyui'
        ? await Promise.all(speakingCharacters.map(async character => {
            const source = voiceReferencesRef.current?.[character];
            return source
              ? [character, await makePortableMediaSource(source, `${character} 声音参考`, true)] as const
              : undefined;
          }))
        : [];
      const portableVoiceReferences = Object.fromEntries(portableVoiceEntries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
      const voiceProfiles = Object.fromEntries(effectiveStoryCast(charactersRef.current, storyPlanRef.current?.characters)
        .filter(character => character.voiceProfile)
        .map(character => [character.name, character.voiceProfile!]));
      const storyboardForRequest = {
        ...portableSegment[0],
        continuousFromPrev: shouldContinuePreviousSegment,
        videoStartMode: shouldContinuePreviousSegment ? 'previous-segment-tail' : 'storyboard',
        videoDuration: duration,
        videoSegmentId: segmentId,
        videoSegmentStoryboardIds: segmentIds,
      };

      let firstFrameUrl: string | undefined;
      if (prevShot?.videoUrl) {
        // Extract a moving handoff frame from local or CORS-enabled remote video.
        // Cloudinary supports CORS, while its old so_100p still was too static.
        try {
          const extractedFrame = await extractVideoTailFrame(prevShot.videoUrl, `场景 ${prevShot.sceneNumber} 视频`);
          firstFrameUrl = await prepareStoryboardReference(extractedFrame, `场景 ${prevShot.sceneNumber} 运动交接帧`, projectAspectRatioRef.current);
        } catch (error) {
          if (!prevShot.videoUrl.includes('res.cloudinary.com')) throw error;
          // Compatibility fallback for legacy Cloudinary assets that cannot be
          // decoded by this browser. New Companion clips use the motion frame.
          firstFrameUrl = prevShot.videoUrl.replace('/video/upload/', '/video/upload/so_100p/').replace(/\.\w+$/, '.jpg');
        }
      }

      const generationUrl = videoProvider === 'comfyui'
        ? comfyUIApiUrl('/api/generate-video', activeSettings.comfyui)
        : '/api/generate-video';
      const response = await fetch(generationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleReference: styleReferenceRef.current, storyboard: storyboardForRequest, segmentStoryboards: portableSegment, isFilmEnding: finalSegment, language: projectLanguageRef.current, apiKey: activeSettings.apiKey, videoModel: activeSettings.videoModel, aspectRatio: projectAspectRatioRef.current, firstFrameUrl, motionContext, voiceReferences: videoProvider === 'comfyui' ? portableVoiceReferences : (voiceReferencesRef.current || {}), voiceProfiles: videoProvider === 'fal' ? voiceProfiles : {}, videoProvider, fal: activeSettings.fal, comfyui: localComfyUISettings(activeSettings.comfyui) })
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
          if (isImageSafetyRejection(error)) throw error;
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
        if (midjourneyRoleCardReady) continue;
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
      const effectiveVoiceCast = [
        ...charactersRef.current,
        ...(storyPlanRef.current?.characters || []).filter(planned => (
          !charactersRef.current.some(character => character.name === planned.name)
        )),
      ];
      for (const character of effectiveVoiceCast) {
        if (autoAbortRef.current) return;
        const speaks = storyboardsRef.current.some(storyboard => storyboardSpeech(storyboard).some(line => line.character === character.name));
        const autoVideoProvider = settingsRef.current.videoProvider || 'apimart';
        if (speaks && autoVideoProvider !== 'fal' && !character.voiceId) {
          throw new Error(`${character.name} 有台词但尚未确认性别与 Fish Audio 音色；请在第 3 步“全片音色选角”中确认`);
        }
        if (speaks && autoVideoProvider !== 'fal' && settingsRef.current.fishAudioKey && !voiceReferencesRef.current?.[character.name]) {
          await retryUntilCompleted(`生成 ${character.name} 音色参考`, async () => {
            await handleGenerateVoiceReference(character.name, { throwOnError: true });
            if (!voiceReferencesRef.current?.[character.name]) throw new Error('任务结束但没有返回音色参考');
          });
        }
      }
      if (autoAbortRef.current) return;

      setCurrentStep(4);
      await retryUntilCompleted(isMidjourneyImageModel(settingsRef.current.imageModel) ? 'MJ 逐镜生成与角色核验' : '九宫格生成分镜图', async () => {
        const { chunkGridBatch } = await import('@/lib/gridSplitter');
        const normalized = storyboardsRef.current.map(normalizeStoryboardImageArtifact);
        if (normalized.some((item, index) => item !== storyboardsRef.current[index])) {
          commitStoryboards(() => normalized);
          persistCurrentProject(normalized);
        }
        // Keep the director's original nine-shot batch boundaries. Filtering
        // failed cards first would shift panel indexes and can assign a crop to
        // the wrong scene on retry.
        for (const group of chunkGridBatch(storyboardsRef.current)) {
          const plan = planAutoImageBatch(group, settingsRef.current.imageModel);
          if (plan.kind === 'skip') continue;
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

      if (storyStorageKeys().isolated || isMidjourneyImageModel(settingsRef.current.imageModel)) {
        await retryUntilCompleted('核验分镜角色与固定道具一致性', async () => {
          const cast: ImageCastCharacter[] = charactersRef.current.map(c => ({ name: c.name, description: c.description, appearance: (c as ImageCastCharacter).appearance, imageUrl: costumeImagesRef.current[c.name] || c.imageUrl }));
          for (let round = 0; round <= 2; round++) {
            // A previous repair may have saved a cleared image before a worker
            // interruption. Complete those pending repairs before auditing.
            for (const missing of storyboardsRef.current.filter(b => !hasUsableStoryboardImage(b))) {
              if (autoAbortRef.current) return;
              await handleGenerateImage(missing, { throwOnError: true });
            }
            const checks: ImageCastCheck[] = [];
            const boards = storyboardsRef.current;
            for (let start = 0; start < boards.length; start += 3) {
              if (autoAbortRef.current) return;
              const batch = boards.slice(start, start + 3);
              setAutoStage(`角色/固定道具核验：镜头 ${start + 1}–${Math.min(start + 3, boards.length)}`);
              const active = settingsRef.current;
              const response = await fetchStoryApi('/api/series/audit-images', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boards: batch.map(b => ({ sceneNumber: b.sceneNumber, imageUrl: b.imageUrl, characters: b.characters, objects: b.objects, backgroundContext: isGptImage2Model(active.imageModel) ? b.prompt : undefined, requireSingleFrame: isMidjourneyImageModel(active.imageModel) })), characters: cast, objects: objectsRef.current, apiKey: active.apiKey, dmxApiKey: active.dmxApiKey, scriptProvider: active.scriptProvider || 'auto', scriptModel: active.scriptModel || 'gpt-4o' }),
              }, active.comfyui);
              const result = await readApiJson<{ checks: ImageCastCheck[] }>(response, '分镜视觉身份核验失败');
              if (result.checks?.length !== batch.length || batch.some(b => !result.checks.some(c => c.sceneNumber === b.sceneNumber && c.imageUrl === b.imageUrl && (typeof c.passed === 'boolean' || c.passed === null)))) throw new Error('角色核验未完整返回当前图片结果');
              checks.push(...result.checks);
              commitStoryboards(items => items.map(item => {
                const check = result.checks.find(c => c.sceneNumber === item.sceneNumber && c.imageUrl === item.imageUrl);
                if (!check) return item;
                const warning = check.passed === null ? check.issues.join('；') : undefined;
                return item.imageCastReviewWarning === warning ? item : { ...item, imageCastReviewWarning: warning };
              }));
              persistCurrentProject();
            }
            const failed = checks.filter(check => check.passed === false);
            if (!failed.length) return;
            for (const check of failed) {
              if (autoAbortRef.current) return;
              const current = storyboardsRef.current.find(b => b.sceneNumber === check.sceneNumber)!;
              const repaired = prepareImageCastRepair(current, check, cast);
              // React may defer state updater callbacks. The generator below
              // must see the cleared image synchronously, before its skip guard.
              const nextBoards = replaceStoryboardAndInvalidateChangedVideo(storyboardsRef.current, repaired);
              storyboardsRef.current = nextBoards;
              setStoryboards(nextBoards);
              persistCurrentProject();
              setAutoStage(`自动补图：镜头 ${check.sceneNumber} 角色不一致`);
              await handleGenerateImage(repaired, { throwOnError: true });
            }
          }
          throw new Error('分镜角色核验未通过，已保留断点');
        });
      }
      if (autoAbortRef.current) return;
      setCurrentStep(5);
      const videoProvider = settingsRef.current.videoProvider || 'apimart';
      const isH3SegmentProvider = videoProvider === 'comfyui' || videoProvider === 'fal';
      const videoGroups = isH3SegmentProvider
        ? resolveVideoSegmentGroups(
            storyboardsRef.current.filter(item => item.imageUrl),
            videoSegmentPlanRef.current,
            projectLanguageRef.current,
          )
        : storyboardsRef.current.filter(item => item.imageUrl).map(item => [item]);
      const deliveryAudit = auditStoryDelivery(storyPlanRef.current, storyboardsRef.current, videoGroups);
      if (deliveryAudit.errors.length) {
        throw new Error(`视频分段前故事交付校验失败：${deliveryAudit.errors.slice(0, 4).join('；')}`);
      }
      for (const group of videoGroups) {
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
            ? isCompletedPlannedVideoSegment(storyboardsRef.current, group)
            : completed.every(item => item.videoStatus === 'completed' && item.videoUrl);
          if (!isDone) throw new Error('任务结束但没有返回完整视频');
        };
        await retryUntilCompleted(groupLabel, completeGroup);
        if (videoProvider === 'comfyui') {
          for (let round = 0; round <= MAX_VIDEO_DUPLICATE_REPAIRS; round++) {
            if (autoAbortRef.current) return;
            let duplicateAudit: VideoDuplicateAudit | undefined;
            await retryUntilCompleted(`${groupLabel}：检查重复角色与烧录字幕`, async () => {
              const current = refreshPlannedVideoSegment(storyboardsRef.current, group), leader = current[0];
              const { names, context } = videoDuplicateAuditScope(current);
              if (!leader.videoTaskId) throw new Error('视频尚未返回任务编号');
              if (leader.videoDuplicateAudit?.taskId === leader.videoTaskId) { duplicateAudit = leader.videoDuplicateAudit; return; }
              const cached = leader.videoCacheKey ? await cachedVideoObjectUrl(leader.videoCacheKey) : undefined;
              const source = cached || leader.videoSourceUrl || leader.videoUrl || await downloadComfyUIVideo(leader.videoTaskId, settingsRef.current.comfyui, { smoothAudioTail: true });
              const ownsUrl = Boolean(cached || (!leader.videoSourceUrl && !leader.videoUrl));
              try {
                const media = await fetch(source);
                if (!media.ok) throw new Error('视频读取失败，保留当前任务后重试检查');
                const active = settingsRef.current, form = new FormData();
                form.append('video', await media.blob(), 'video.mp4');
                form.append('taskId', leader.videoTaskId);
                form.append('metadata', JSON.stringify({ names, context, apiKey: active.apiKey, dmxApiKey: active.dmxApiKey, provider: active.scriptProvider || 'auto', model: active.scriptModel || 'gpt-4o' }));
                const response = await fetchStoryApi('/api/series/audit-video-duplicates', { method: 'POST', body: form }, active.comfyui);
                const result = await readApiJson<{ audit: VideoDuplicateAudit }>(response, '视频角色检查失败');
                if (!result.audit || result.audit.taskId !== leader.videoTaskId || ![true, false, null].includes(result.audit.passed)) throw new Error('视频画面核验未返回当前任务结果');
                duplicateAudit = result.audit;
                commitStoryboards(items => items.map(b => b.id === leader.id ? { ...b, videoDuplicateAudit: result.audit } : b));
                persistCurrentProject();
              } finally { if (ownsUrl && source.startsWith('blob:')) URL.revokeObjectURL(source); }
            });
            if (!duplicateAudit) throw new Error('视频画面检查未完成');
            if (duplicateAudit.passed !== false) break;
            const repaired = prepareVideoDuplicateRepair(storyboardsRef.current, refreshPlannedVideoSegment(storyboardsRef.current, group), duplicateAudit);
            storyboardsRef.current = repaired; setStoryboards(repaired); persistCurrentProject();
            await retryUntilCompleted(`${groupLabel}：纠正重复角色或烧录字幕`, completeGroup);
          }
        }
        if (videoProvider === 'comfyui' && isFilmEndingSegment(storyboardsRef.current, group)) {
          // H3 already verifies the supplied dialogue while generating the clip. Fish ASR is
          // an additional timing audit for the requested quiet tail, so its absence must not
          // turn a completed H3 episode into a failed production or buy another video take.
          if (!settingsRef.current.fishAudioKey?.trim()) {
            const current = refreshPlannedVideoSegment(storyboardsRef.current, group);
            commitStoryboards(items => items.map(b => b.id === current[0].id ? {
              ...b, videoEndingWarning: FILM_ENDING_ASR_SKIPPED_WARNING,
            } : b));
            persistCurrentProject();
            continue;
          }
          for (let round = 0; round <= MAX_ENDING_REPAIRS; round++) {
            if (autoAbortRef.current) return;
            let audit: FilmEndingAudit | undefined;
            await retryUntilCompleted('核验整片末镜最后一秒', async () => {
              const current = refreshPlannedVideoSegment(storyboardsRef.current, group);
              const leader = current[0];
              if (!leader.videoTaskId) throw new Error('末镜尚未返回可核验的视频任务');
              if (leader.videoEndingAudit?.taskId === leader.videoTaskId) { audit = leader.videoEndingAudit; return; }
              const cached = leader.videoCacheKey ? await cachedVideoObjectUrl(leader.videoCacheKey) : undefined;
              const source = cached || leader.videoSourceUrl || leader.videoUrl
                || await downloadComfyUIVideo(leader.videoTaskId, settingsRef.current.comfyui, { smoothAudioTail: true });
              const ownsUrl = Boolean(cached || (!leader.videoSourceUrl && !leader.videoUrl));
              try {
                const media = await fetch(source);
                if (!media.ok) throw new Error('末镜视频读取失败；保留任务后重试');
                const form = new FormData();
                form.append('video', await media.blob(), 'ending.mp4');
                form.append('taskId', leader.videoTaskId);
                form.append('expected', current.flatMap(b => storyboardSpeech(b)).map(line => line.exactLine).join(' '));
                form.append('fishAudioKey', settingsRef.current.fishAudioKey || '');
                const response = await fetchStoryApi('/api/series/audit-video-ending', { method: 'POST', body: form }, settingsRef.current.comfyui);
                const result = await readApiJson<{ audit: FilmEndingAudit }>(response, '末镜核验失败');
                if (!result.audit || result.audit.taskId !== leader.videoTaskId || typeof result.audit.passed !== 'boolean') throw new Error('末镜核验未返回当前任务结果');
                audit = result.audit;
                commitStoryboards(items => items.map(b => b.id === leader.id ? { ...b, videoEndingAudit: result.audit } : b));
                persistCurrentProject();
              } finally { if (ownsUrl && source.startsWith('blob:')) URL.revokeObjectURL(source); }
            });
            if (!audit) throw new Error('末镜核验未完成');
            const current = refreshPlannedVideoSegment(storyboardsRef.current, group);
            const disposition = filmEndingDisposition(audit);
            if (disposition !== 'repair-dialogue') {
              commitStoryboards(items => items.map(b => b.id === current[0].id ? {
                ...b, videoEndingWarning: disposition === 'warning' ? FILM_ENDING_WARNING : undefined,
              } : b));
              persistCurrentProject();
              break;
            }
            const repaired = prepareFilmEndingRepair(storyboardsRef.current, current, audit);
            storyboardsRef.current = repaired;
            setStoryboards(repaired);
            persistCurrentProject();
            await retryUntilCompleted('自动修复末镜无配音结尾', completeGroup);
          }
        }
      }
      if (autoAbortRef.current) return;

      // A resumed batch can have every paid segment marked completed while its
      // ephemeral blob URL is absent from the new page. Step 6 only exports
      // leaders with a readable videoUrl, so entering it immediately used to
      // produce a plausible but truncated film (for example 9 of 18 clips).
      // Rehydrate every authoritative segment from IndexedDB or its existing
      // task before rendering the editor. This never submits a new video task.
      setAutoStage('恢复全部18段视频用于合成');
      let exportStoryboards = storyboardsRef.current;
      for (const planned of videoGroups) {
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
      const missingExportSegments = videoGroups.filter(group => {
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
            singleShotMode={isMidjourneyImageModel(settings.imageModel)}
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
                    <Grid3x3 size={14} />
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
                voiceReferences={voiceReferences || {}}
                voiceGenerating={voiceGenerating}
                onGenerateVoiceReference={handleGenerateVoiceReference}
                onClearVoiceReference={(name) => setVoiceReferences(prev => { const n = { ...(prev || {}) }; delete n[name]; return n; })}
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
                singleShotMode={isMidjourneyImageModel(settings.imageModel)}
              />
            )}
            {currentStep === 5 && (
              <Step5
                storyboards={storyboards}
                characters={characters}
                videoModel={settings.videoModel}
                videoProvider={settings.videoProvider || 'apimart'}
                aspectRatio={projectAspectRatio}
                language={projectLanguage}
                voiceReferences={voiceReferences || {}}
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
