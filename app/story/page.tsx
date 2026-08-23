'use client';

import { useState, useEffect, useRef } from 'react';
import DevToolsLayout from '@/components/DevToolsLayout';
import Toolbar from '@/components/Toolbar';
import StatusBar from '@/components/StatusBar';
import StepIndicator from '@/components/StepIndicator';
import Step1 from '@/components/Step1';
import Step2 from '@/components/Step2';
import Step3 from '@/components/Step3';
import Step4 from '@/components/Step4';
import Step5 from '@/components/Step5';
import Step6 from '@/components/Step6';
import SettingsModal from '@/components/SettingsModal';
import CanvasMode from '@/components/CanvasMode';
import { Character, ObjectItem, Storyboard, VisualStyle } from '@/types';
import { StoryPlan } from '@/lib/pipeline/types';
import { useProject } from '@/hooks/useProject';
import { useSettings } from '@/hooks/useSettings';
import { comfyUIApiUrl, companionVersionAtLeast, downloadComfyUIVideo, fetchStoryApi, isComfyUIClientTask, localComfyUISettings, SEGMENT_VIDEO_COMPANION_MIN_VERSION, videoStatusResponseError } from '@/lib/comfyuiClient';
import { Grid3x3 } from 'lucide-react';
import { readApiJson } from '@/lib/apiResponse';
import { buildShotCountContract, DEFAULT_TARGET_SHOT_COUNT, normalizeTargetShotCount, storyPlanBeatCount, targetDurationSeconds } from '@/lib/pipeline/shotCount';
import { cacheVideoSource, cachedVideoObjectUrl, requestPersistentVideoStorage, videoCacheKeyForStoryboard } from '@/lib/videoCache';
import { DEFAULT_VISUAL_STYLE, normalizeVisualStyle } from '@/lib/promptArchitecture';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds, isCompletedVideoSegment, resolveVideoSegmentGroups, restoredStoryStep, validateVideoSegment, videoSegmentGenerationSignature, type VideoSegmentPlan } from '@/lib/videoSegments';
import { CONTINUITY_HANDOFF_LEAD_SECONDS } from '@/lib/videoContinuity';
import { prepareStoryboardReference } from '@/lib/storyboardImagePreprocess';
import { analyzeImagePromptSafety, extractImageTaskError, imageSafetyReasonLabel, isImageSafetyRejection, rewriteImagePromptForSafety } from '@/lib/imagePromptSafety';
import { normalizeSavedImageFailureReason, planInterruptedGridRecovery } from '@/lib/gridRecovery';
import { compileTimedSpeech, segmentSpeechSignature, storyboardSpeech } from '@/lib/speechAudioContract';
import { castStoryVoices, lockStoryboardVoiceIds } from '@/lib/voiceCasting';
import { applyStoryAspectRatio, hasStoryMedia, projectStoryAspectRatio, type StoryAspectRatio } from '@/lib/storyAspectRatio';
import { getImageModelCapabilities } from '@/lib/imageModels';
import { autoProductionLockName, autoRetryDelayMs, hasUsableStoryboardImage, normalizeStoryboardImageArtifact, planAutoImageBatch } from '@/lib/autoProduction';

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

const AUTO_PRODUCTION_STORAGE_KEY = 'aid:auto-production';

type SavedAutoProduction = {
  projectId: string;
  status: 'running' | 'paused';
  updatedAt: number;
};

function savedAutoProduction(): SavedAutoProduction | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTO_PRODUCTION_STORAGE_KEY) || 'null');
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
    localStorage.setItem(AUTO_PRODUCTION_STORAGE_KEY, JSON.stringify({ projectId, status, updatedAt: Date.now() }));
  } catch {}
}

function clearAutoProduction(projectId: string): void {
  try {
    if (savedAutoProductionProjectId() === projectId) localStorage.removeItem(AUTO_PRODUCTION_STORAGE_KEY);
  } catch {}
}

export default function StoryPage() {
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
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [storyPlan, setStoryPlan] = useState<StoryPlan | undefined>();
  const [videoSegmentPlan, setVideoSegmentPlan] = useState<VideoSegmentPlan | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [costumeImages, setCostumeImages] = useState<Record<string, string>>({}); // { 角色名: URL }
  const [costumeGenerating, setCostumeGenerating] = useState<Record<string, boolean>>({}); // { 角色名: bool }
  const [voiceReferences, setVoiceReferences] = useState<Record<string, string>>(); // { 角色名: Cloudinary URL }
  const [voiceGenerating, setVoiceGenerating] = useState<Record<string, boolean>>({}); // { 角色名: bool }
  const [sceneImages, setSceneImages] = useState<string[]>([]);
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

  const cacheCompletedVideo = async (
    storyboardId: string,
    sourceUrl: string,
    segmentStoryboardIds: string[] = [storyboardId],
    cacheProjectId = projectId,
    generationSignature?: string,
  ): Promise<string> => {
    const cacheKey = videoCacheKeyForStoryboard(cacheProjectId, storyboardId, generationSignature);
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
      const cacheKey = videoCacheKeyForStoryboard(cacheProjectId, storyboard.id, generationSignature);
      try {
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
          await cacheCompletedVideo(storyboard.id, remoteUrl, segmentIds, cacheProjectId, generationSignature);
          continue;
        }

        // Resume the saved ComfyUI task instead of downloading immediately.
        // A refresh can happen while ComfyUI is still processing; the old
        // implementation treated "视频仍在生成中" as a recovery failure and
        // permanently stranded the UI in the generating state even after the
        // remote task subsequently completed.
        if (storyboard.videoTaskId && isComfyUIClientTask(storyboard.videoTaskId)) {
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
        const isTaskRecovery = Boolean(storyboard.videoTaskId && isComfyUIClientTask(storyboard.videoTaskId));
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
  }, [storyboards, characters, objects, costumeImages, voiceReferences, sceneImages, settings, projectLanguage, projectAspectRatio, videoSegmentPlan, storyPlan]);

  const persistCurrentProject = (nextStoryboards = storyboardsRef.current) => {
    saveProject({
      characters: charactersRef.current,
      objects: objectsRef.current,
      storyContent,
      language: projectLanguageRef.current,
      targetShotCount,
      aspectRatio: projectAspectRatioRef.current,
      visualStyle,
      storyOutline: '',
      storyboards: nextStoryboards,
      voiceReferences: voiceReferencesRef.current,
      costumeImages: costumeImagesRef.current,
      sceneImages: sceneImagesRef.current,
      storyPlan: storyPlanRef.current,
      videoSegmentPlan: videoSegmentPlanRef.current,
      createdAt: new Date().toISOString(),
    });
  };

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
      const savedObjects = savedProject.objects || [];
      const savedCostumeImages = savedProject.costumeImages || {};
      const savedSceneImages = savedProject.sceneImages || [];
      charactersRef.current = savedCharacters;
      objectsRef.current = savedObjects;
      costumeImagesRef.current = savedCostumeImages;
      voiceReferencesRef.current = savedProject.voiceReferences;
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
      const savedStoryboards = lockStoryboardVoiceIds<Storyboard>((savedProject.storyboards || []).map(item => normalizeStoryboardImageArtifact({
        ...item,
        aspectRatio: savedAspectRatio,
        imageFailureReason: normalizeSavedImageFailureReason(item.imageFailureReason)
          || (item.status === 'failed' ? '上次分镜生成未完成；请重新生成，系统会定位具体原因并自动修正可恢复的提示词问题' : undefined),
      })), savedCharacters);
      storyboardsRef.current = savedStoryboards;
      setStoryboards(savedStoryboards);
      void recoverProjectVideos(savedStoryboards, savedProject.id!);
      // A refresh used to strand a paid 3×3 task in "generating" forever.
      // Resume polling a batch when all its shots share the same saved task id.
      for (let index = 0; index < savedStoryboards.length; index += 9) {
        const group = savedStoryboards.slice(index, index + 9);
        const gridRecoveryGroup = group.filter(item => item.imageTaskMode !== 'single');
        const taskIds = [...new Set(gridRecoveryGroup.map(item => item.taskId).filter(Boolean))];
        const recoveryPlan = planInterruptedGridRecovery(gridRecoveryGroup);
        const usesDurableGridCrops = group.length > 0 && group.every(item =>
          item.imageUrl?.includes('/aid-grid-sources/') && item.imageUrl.includes('/c_crop,'),
        );
        // Migrate completed legacy browser-canvas crops too. Their saved task
        // ids still point to the correct APIMart mother grids, so re-splitting
        // fixes wrongly repeated batches without purchasing another generation.
        const needsDurableResplit = group.length > 0
          && group.every(item => Boolean(item.imageUrl))
          && !usesDurableGridCrops;
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
        const recoverableTaskId = recoveryPlan.kind === 'resume'
          ? recoveryPlan.taskId
          : needsDurableResplit && taskIds.length === 1 ? taskIds[0] : undefined;
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
                for (let attempt = 0; attempt < 40 && !settingsRef.current.apiKey; attempt++) {
                  await new Promise(resolve => window.setTimeout(resolve, 250));
                }
                const recoveryApiKey = settingsRef.current.apiKey;
                if (!recoveryApiKey) throw new Error('APIMart API Key 尚未加载');
                const response = await fetch('/api/check-image-status', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId, apiKey: recoveryApiKey })
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
      setVoiceReferences(savedProject.voiceReferences);
      setCostumeImages(savedCostumeImages);
      setSceneImages(savedSceneImages);
      setStoryPlan(savedProject.storyPlan);
      storyPlanRef.current = savedProject.storyPlan;
      setVideoSegmentPlan(savedProject.videoSegmentPlan);
      videoSegmentPlanRef.current = savedProject.videoSegmentPlan;
      const savedAuto = savedAutoProduction();
      if (savedAuto && savedAuto.projectId === savedProject.id) {
        if (savedAuto.status === 'running') setAutoResumeRequested(true);
        else setAutoPaused(true);
      }
      if (savedProject.storyboards?.length > 0) setCurrentStep(restoredStoryStep(savedStoryboards, savedProject.videoSegmentPlan));
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
        saveProject({ characters, objects, storyContent, language: projectLanguage, targetShotCount, aspectRatio: projectAspectRatio, visualStyle, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, videoSegmentPlan, createdAt: new Date().toISOString() });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [characters, objects, storyContent, projectLanguage, targetShotCount, projectAspectRatio, visualStyle, storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, videoSegmentPlan, saveProject]);

  const handleSave = () => {
    saveProject({ characters, objects, storyContent, language: projectLanguage, targetShotCount, aspectRatio: projectAspectRatio, visualStyle, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, videoSegmentPlan, createdAt: new Date().toISOString() });
    alert('Project saved!');
  };

  const handleVideoSegmentPlanChange = (plan: VideoSegmentPlan) => {
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
      storyOutline: '',
      storyboards: storyboardsRef.current,
      voiceReferences: voiceReferencesRef.current,
      costumeImages: costumeImagesRef.current,
      sceneImages: sceneImagesRef.current,
      storyPlan,
      videoSegmentPlan: plan,
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
        charactersRef.current = importedCharacters;
        objectsRef.current = importedObjects;
        costumeImagesRef.current = importedCostumeImages;
        voiceReferencesRef.current = data.voiceReferences;
        sceneImagesRef.current = importedSceneImages;
        setCharacters(importedCharacters);
        setObjects(importedObjects);
        setStoryContent(data.storyContent || '');
        const importedLanguage = data.language === 'en' || data.language === 'zh'
          ? data.language
          : (settingsRef.current.language === 'en' ? 'en' : 'zh');
        projectLanguageLockedRef.current = Boolean(data.language);
        projectLanguageRef.current = importedLanguage;
        setProjectLanguage(importedLanguage);
        setTargetShotCount(normalizeTargetShotCount(data.targetShotCount));
        const importedAspectRatio = projectStoryAspectRatio(data.aspectRatio, data.storyboards || [], settingsRef.current.aspectRatio);
        projectAspectLockedRef.current = Boolean(data.aspectRatio || (data.storyboards || []).some((item: Storyboard) => item.aspectRatio));
        projectAspectRatioRef.current = importedAspectRatio;
        setProjectAspectRatio(importedAspectRatio);
        setVisualStyle(normalizeVisualStyle(data.visualStyle || settings.visualStyle));
        const importedStoryboards = lockStoryboardVoiceIds<Storyboard>((data.storyboards || []).map((item: Storyboard) => ({ ...item, aspectRatio: importedAspectRatio })), importedCharacters);
        storyboardsRef.current = importedStoryboards;
        setStoryboards(importedStoryboards);
        void recoverProjectVideos(importedStoryboards, importedProjectId);
        setVoiceReferences(data.voiceReferences);
        setCostumeImages(importedCostumeImages);
        setSceneImages(importedSceneImages);
        setStoryPlan(data.storyPlan);
        storyPlanRef.current = data.storyPlan;
        setVideoSegmentPlan(data.videoSegmentPlan);
        videoSegmentPlanRef.current = data.videoSegmentPlan;
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
          storyOutline: '',
          storyboards: importedStoryboards,
          voiceReferences: data.voiceReferences,
          costumeImages: importedCostumeImages,
          sceneImages: importedSceneImages,
          storyPlan: data.storyPlan,
          videoSegmentPlan: data.videoSegmentPlan,
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
    exportProject({ name: projectName, characters, objects, storyContent, language: projectLanguage, targetShotCount, aspectRatio: projectAspectRatio, visualStyle, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, videoSegmentPlan, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  const handleUpdateStoryboard = (updated: Storyboard) => {
    setStoryboards(prev => {
      const next = replaceStoryboardAndInvalidateChangedVideo(prev, updated);
      storyboardsRef.current = next;
      return next;
    });
  };

  const handleVisualStyleChange = (style: VisualStyle) => {
    const normalized = normalizeVisualStyle(style);
    setVisualStyle(normalized);
    setStoryboards(prev => {
      const next = prev.map(storyboard => storyboard.visualStyle === normalized
        ? storyboard
        : clearGeneratedVideo({ ...storyboard, visualStyle: normalized }));
      storyboardsRef.current = next;
      return next;
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
  const runScript = async (): Promise<Storyboard[]> => {
    // Never send uploaded image/base64/File fields to the text-only screenplay
    // endpoints. Besides wasting bandwidth, large character images can make a
    // hosting gateway reject the request with an HTML 413/5xx page.
    const language = projectLanguageRef.current;
    const voiceLockedCharacters = castStoryVoices(characters, language);
    charactersRef.current = voiceLockedCharacters;
    setCharacters(voiceLockedCharacters);
    const writerCharacters = voiceLockedCharacters.map(({ name, description, voiceId, voiceProfile, voiceSource }) => ({ name, description, voiceId, voiceProfile, voiceSource }));
    const writerObjects = objects.map(({ name, description }) => ({ name, description }));
    const activeSettings = settingsRef.current;
    // Older Companion builds ignore the structured field below, so append the
    // same production spec to the brief as a backwards-compatible contract.
    const planningSynopsis = `${storyContent.trim()}\n\n${buildShotCountContract(targetShotCount, language)}`;
    const planRes = await fetchStoryApi('/api/generate-story-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synopsis: planningSynopsis, targetShotCount, characters: writerCharacters, objects: writerObjects, apiKey: activeSettings.apiKey, language, scriptProvider: activeSettings.scriptProvider || 'auto', scriptModel: activeSettings.scriptModel || 'gpt-4o', dmxApiKey: activeSettings.dmxApiKey })
    }, activeSettings.comfyui);
    const { storyPlan: generatedPlan } = await readApiJson<{ storyPlan: StoryPlan }>(planRes, '剧本规划失败');
    const actualShotCount = storyPlanBeatCount(generatedPlan);
    if (actualShotCount !== targetShotCount) {
      throw new Error(`剧本规划返回了 ${actualShotCount} 个镜头，但你选择的是 ${targetShotCount} 个，请重试`);
    }
    const storyPlan: StoryPlan = {
      ...generatedPlan,
      targetShotCount,
      targetDurationSeconds: targetDurationSeconds(targetShotCount),
      estimatedDurationSeconds: generatedPlan.sequences.reduce((total, sequence) => (
        total + sequence.beats.reduce((sum, beat) => sum + beat.durationHint, 0)
      ), 0),
    };
    storyPlanRef.current = storyPlan;
    setStoryPlan(storyPlan);

    const dirRes = await fetchStoryApi('/api/direct-storyboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyPlan, characters: writerCharacters, objects: writerObjects, apiKey: activeSettings.apiKey, aspectRatio: projectAspectRatioRef.current, language, visualStyle, scriptProvider: activeSettings.scriptProvider || 'auto', scriptModel: activeSettings.scriptModel || 'gpt-4o', dmxApiKey: activeSettings.dmxApiKey })
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
    const styledStoryboards = lockStoryboardVoiceIds(
      storyboards.map(storyboard => ({ ...storyboard, visualStyle })),
      effectiveVoiceCast,
    );
    setVideoSegmentPlan(undefined);
    videoSegmentPlanRef.current = undefined;
    setStoryboards(styledStoryboards);
    storyboardsRef.current = styledStoryboards;
    persistCurrentProject(styledStoryboards);
    return styledStoryboards;
  };

  const handleGenerateScript = async () => {
    if (!settings.apiKey && !settings.dmxApiKey) { alert('Please configure API Key in settings'); return; }
    setIsLoading(true);
    try {
      await runScript();
      setCurrentStep(3);
    } catch (error) {
      alert(`剧本生成失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Step4: batch generate via 3x3 grid
  const handleGenerateGrid = async (batch: Storyboard[], options: { throwOnError?: boolean; resumeTaskId?: string } = {}) => {
    const activeSettings = settingsRef.current;
    if (!activeSettings.apiKey) {
      const error = new Error('Please configure API Key in settings');
      if (options.throwOnError) throw error;
      if (options.resumeTaskId) return;
      alert(error.message);
      return;
    }
    if (batch.length === 0) return;
    const { buildGridPrompt, chunkGridBatch } = await import('@/lib/gridSplitter');
    const aspectRatio = projectAspectRatioRef.current;
    const generationProjectId = projectIdRef.current;
    const updateGridStoryboards = (updater: (items: Storyboard[]) => Storyboard[]) => {
      if (generationProjectId !== projectIdRef.current) return;
      const next = updater(storyboardsRef.current);
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
        // Grid generation must consider the cast from every panel, not only the
        // first storyboard in the group. Otherwise later character references
        // are uploaded without a matching prompt label and can be ignored.
        const mentionsEntity = (sb: Storyboard, name: string, listedNames?: string[]) =>
          listedNames?.includes(name) ||
          sb.prompt.includes(`[${name}]`) ||
          sb.prompt.includes(name) ||
          sb.description.includes(name);
        const groupCharacters = charactersRef.current.filter(character =>
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
        const sceneStyle = group[0]?.sceneStyle || '';
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
          const sourcePrompt = shouldRewrite
            ? rewriteImagePromptForSafety(sb.prompt, safetyLevel).replace(/^[\s\S]*?\n\n/, '')
            : sb.prompt;
          const cleanPrompt = sourcePrompt.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]/g, '$1');
          const requiredCharacters = [...new Set([
            ...(sb.characters || []),
            ...groupCharacters
              .filter(character => mentionsEntity(sb, character.name, sb.characters))
              .map(character => character.name),
          ])];
          const requiredObjects = groupObjects
            .filter(object => mentionsEntity(sb, object.name, sb.objects))
            .map(object => object.name);
          const panelChars = requiredCharacters.length
            ? `CAST[${requiredCharacters.length}]: ${requiredCharacters.join(', ')}; each exactly once.`
            : 'CAST[0]: none.';
          const panelObjs = requiredObjects.length
            ? `PROPS: ${requiredObjects.join(', ')}.`
            : '';
          return `${summarize(cleanPrompt, 210)} ${panelChars} ${panelObjs}`.trim();
        });

        // Keep labels and images in exactly the same order. Text-only entities
        // stay in the prompt but must not consume a reference image number.
        const characterReferences = groupCharacters
          .map(character => ({
            image: costumeImagesRef.current[character.name] || character.imageUrl || character.imageBase64,
            label: `${character.name} — ${summarize(character.description)}`
          }))
          .filter((reference): reference is { image: string; label: string } => Boolean(reference.image));
        const objectReferences = groupObjects
          .map(object => ({
            image: object.imageUrl || object.imageBase64,
            label: `${object.name} — ${summarize(object.description)}`
          }))
          .filter((reference): reference is { image: string; label: string } => Boolean(reference.image));
        const sceneReference = sceneImagesRef.current[0]
          ? [{ image: sceneImagesRef.current[0], label: 'Scene/environment reference' }]
          : [];
        const referenceLimit = getImageModelCapabilities(activeSettings.imageModel).maxReferenceImages;
        const references = [...characterReferences, ...sceneReference, ...objectReferences].slice(0, referenceLimit);
        const refLabels = references.map(reference => reference.label);
        const refImages = references.map(reference => reference.image);
        let gridUrl = '';
        let lastGridError: unknown;
        const maxSafetyAttempts = safetyFindings.length > 0 ? 2 : 3;
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
            // Resume an already-paid task only on the first attempt. A safety
            // rejection creates a fresh task with the corrected panel prompts.
            let taskId = safetyAttempt === 0 && options.resumeTaskId && batch.length <= 9 ? options.resumeTaskId : '';
            if (!taskId) {
              const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  storyboard: gridStoryboard,
                  characters: groupCharacters,
                  objects: groupObjects,
                  aspectRatio,
                  imageModel: activeSettings.imageModel,
                  apiKey: activeSettings.apiKey,
                  costumeImages: costumeImagesRef.current,
                  sceneImage: sceneImagesRef.current[0] || '',
                  referenceImages: refImages,
                  referenceImageLabels: refLabels,
                  visualStyle
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
              const statusRes = await fetch('/api/check-image-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, apiKey: activeSettings.apiKey })
              });
              if (!statusRes.ok) continue;
              const statusData = await statusRes.json();
              if (generationProjectId !== projectIdRef.current) throw new Error('项目已切换，旧项目的九宫格任务已停止回写');
              if (statusData.status === 'completed' && statusData.imageUrl) { gridUrl = statusData.imageUrl; break; }
              if (statusData.status === 'failed') throw new TerminalImageTaskError(extractImageTaskError(statusData));
            }
            if (!gridUrl) throw new Error('Grid image timeout');
          } catch (error) {
            lastGridError = error;
            if (!isImageSafetyRejection(error) || safetyAttempt >= maxSafetyAttempts - 1) throw error;
            const candidateScenes = safetyFindings.length
              ? safetyFindings.map(finding => finding.storyboard.sceneNumber)
              : group.map(storyboard => storyboard.sceneNumber);
            const diagnosis = safetyFindings.length
              ? imageSafetyReasonLabel([...new Set(safetyFindings.flatMap(finding => finding.risks))])
              : '供应商内容安全策略（未命中本地词表）';
            updateGridStoryboards(items => items.map(sb => group.some(g => g.id === sb.id) ? {
              ...sb,
              status: 'generating' as const,
              imageFailureReason: `内容安全拒绝；候选镜头 ${candidateScenes.join('、')}：${diagnosis}；正在自动修正并重试`,
              imageRetryCount: (sb.imageRetryCount || 0) + 1,
              imagePromptOverride: rewriteImagePromptForSafety(sb.prompt, safetyAttempt === 0 ? 1 : 2),
            } : sb));
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
          console.error('Grid generation failed:', error);
          const terminalTaskFailure = error instanceof TerminalImageTaskError;
          updateGridStoryboards(items => items.map(sb => group.some(g => g.id === sb.id) ? {
            ...sb,
            // A polling timeout or split/upload failure does not prove that the
            // paid image task failed. Keep it recoverable and reattach to the
            // same id; only an explicit provider failure permits resubmission.
            status: !terminalTaskFailure && sb.taskId ? 'generating' : 'failed',
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
    if (!activeSettings.apiKey) {
      const error = new Error('Please configure API Key in settings');
      if (options.throwOnError) throw error;
      alert(error.message);
      return;
    }
    const generationProjectId = projectIdRef.current;
    try {
      const latestBeforeStart = storyboardsRef.current.find(item => item.id === storyboard.id) || storyboard;
      if (hasUsableStoryboardImage(latestBeforeStart)) return;
      const initialRisks = analyzeImagePromptSafety(`${storyboard.prompt}\n${storyboard.description}`);
      const maxSafetyAttempts = initialRisks.length > 0 ? 2 : 3;
      for (let safetyAttempt = 0; safetyAttempt < maxSafetyAttempts; safetyAttempt += 1) {
        const shouldRewrite = initialRisks.length > 0 || safetyAttempt > 0 || Boolean(storyboard.imagePromptOverride);
        const safetyLevel: 1 | 2 = initialRisks.length > 0 && safetyAttempt === 0 || safetyAttempt === 1 ? 1 : 2;
        const prompt = shouldRewrite ? rewriteImagePromptForSafety(storyboard.prompt, safetyLevel) : storyboard.prompt;
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
            const response = await fetch('/api/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ storyboard: { ...storyboard, prompt }, characters: charactersRef.current, objects: objectsRef.current, aspectRatio: projectAspectRatioRef.current, imageModel: activeSettings.imageModel, apiKey: activeSettings.apiKey, costumeImages: costumeImagesRef.current, sceneImage: storyboard.sceneImageOverride || sceneImagesRef.current[0] || '', visualStyle })
            });
            const data = await readApiJson<{ taskId: string }>(response, '启动单张分镜生成失败');
            taskId = data.taskId;
            if (!taskId) throw new Error('生图接口没有返回任务 ID');
            commitStoryboards(items => items.map(item => item.id === storyboard.id ? {
              ...item,
              taskId,
              imageTaskMode: 'single' as const,
              status: 'generating' as const,
            } : item));
            // Persist immediately after the billable task is accepted. A
            // refresh can now reconnect to this exact task instead of paying
            // for a duplicate single-image repair.
            persistCurrentProject();
          }
          await pollImageStatus(storyboard.id, taskId, generationProjectId, activeSettings.apiKey);
          persistCurrentProject();
          return;
        } catch (error) {
          if (!isImageSafetyRejection(error) || safetyAttempt >= maxSafetyAttempts - 1) throw error;
        }
      }
    } catch (error) {
      if (generationProjectId !== projectIdRef.current) return;
      const terminalTaskFailure = error instanceof TerminalImageTaskError;
      commitStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? {
        ...sb,
        status: !terminalTaskFailure && sb.taskId ? 'generating' : 'failed',
        taskId: terminalTaskFailure ? undefined : sb.taskId,
        imageTaskMode: terminalTaskFailure ? undefined : sb.imageTaskMode,
        imageFailureReason: error instanceof Error ? error.message : 'Unknown image generation error',
      } : sb));
      persistCurrentProject();
      if (options.throwOnError) throw error;
    }
  };

  const pollImageStatus = async (storyboardId: string, taskId: string, generationProjectId = projectIdRef.current, apiKey = settingsRef.current.apiKey) => {
    for (let i = 0; i < 90; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (generationProjectId !== projectIdRef.current) return;
      let response: Response;
      try {
        response = await fetch('/api/check-image-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey })
        });
      } catch {
        continue;
      }
      if (!response.ok) continue;
      const data = await response.json().catch(() => undefined);
      if (!data) continue;
      if (generationProjectId !== projectIdRef.current) return;
      if (data.status === 'completed' && data.imageUrl) {
          let imageUrl = data.imageUrl;
          // 确保 imageUrl 是公网 URL：base64 数据 URL 会上传到 Cloudinary，否则 ComfyUI LoadImage 拿不到文件
          if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
            try {
              const uploadRes = await fetch('/api/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageData: imageUrl })
              });
              if (uploadRes.ok) {
                const { url } = await uploadRes.json();
                imageUrl = url;
              }
            } catch (e) { console.error('Upload image to Cloudinary failed:', e); }
          }
          setStoryboards(prev => {
            const previous = prev.find(sb => sb.id === storyboardId);
            if (!previous) return prev;
            const updated = { ...previous, status: 'completed' as const, imageUrl, taskId, imageFailureReason: undefined };
            const next = replaceStoryboardAndInvalidateChangedVideo(prev, updated);
            storyboardsRef.current = next;
            return next;
          });
          return;
      }
      if (data.status === 'failed') throw new TerminalImageTaskError(extractImageTaskError(data) || 'Image generation failed');
    }
    if (generationProjectId !== projectIdRef.current) return;
    throw new Error('Image generation timeout');
  };

  const handleGenerateCostume = async (
    type: 'costume' | 'scene',
    characterName?: string,
    options: { throwOnError?: boolean } = {},
  ) => {
    const activeSettings = settingsRef.current;
    if (!activeSettings.apiKey) {
      const error = new Error('请先在设置中配置 APIMart API Key');
      if (options.throwOnError) throw error;
      alert(error.message);
      return;
    }
    const generationProjectId = projectIdRef.current;
    const character = characterName ? charactersRef.current.find(c => c.name === characterName) : undefined;
    const sceneStyle = storyboardsRef.current[0]?.sceneStyle;

    if (type === 'costume' && characterName) {
      setCostumeGenerating(prev => ({ ...prev, [characterName]: true }));
    } else {
      setSceneGenerating(true);
    }

    try {
      const response = await fetch('/api/generate-costume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, name: characterName,
          description: character?.description || '',
          costumeDesc: characterName ? storyboardsRef.current[0]?.characterCostume?.[characterName] : undefined,
          sceneStyle,
          // 场景参考用第一个角色的定妆/参考图当风格锚点，保证场景媒介和角色一致
          referenceImageUrl: type === 'scene'
            ? (costumeImagesRef.current[charactersRef.current[0]?.name || ''] || charactersRef.current[0]?.imageUrl)
            : character?.imageUrl,
          aspectRatio: projectAspectRatioRef.current,
          imageModel: activeSettings.imageModel,
          apiKey: activeSettings.apiKey,
          visualStyle
        })
      });
      const { taskId } = await readApiJson<{ taskId: string }>(response, type === 'costume' ? '生成角色定妆失败' : '生成场景参考失败');
      if (!taskId) throw new Error('生图接口没有返回任务 ID');

      // Poll for completion
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 3000));
        if (generationProjectId !== projectIdRef.current) return;
        const statusRes = await fetch('/api/check-image-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey: activeSettings.apiKey })
        });
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        if (generationProjectId !== projectIdRef.current) return;
        if (statusData.status === 'completed' && statusData.imageUrl) {
          if (type === 'costume' && characterName) {
            const nextCostumeImages = { ...costumeImagesRef.current, [characterName]: statusData.imageUrl };
            costumeImagesRef.current = nextCostumeImages;
            setCostumeImages(nextCostumeImages);
          } else {
            const nextSceneImages = [...sceneImagesRef.current, statusData.imageUrl];
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
    const character = characters.find(c => c.name === characterName);
    if (!character) return;
    setVoiceGenerating(prev => ({ ...prev, [characterName]: true }));
    try {
      // Description text can leak wardrobe/appearance words into H3's native
      // soundtrack. Keep the voice sample short, neutral, and unrelated to plot.
      const sampleText = projectLanguageRef.current === 'en'
        ? 'Morning light moves softly across the quiet room. I speak clearly, calmly, and naturally.'
        : '清晨的光线缓缓穿过安静房间，我用自然、清晰、平稳的语气说话。';
      const res = await fetch('/api/generate-voice-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterName,
          sampleText,
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
    } catch (err) {
      if (generationProjectId !== projectIdRef.current) return;
      if (options.throwOnError) throw err;
      alert(`Voice reference failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setVoiceGenerating(prev => ({ ...prev, [characterName]: false }));
    }
  };

  const handleGenerateVideoPrompt = async (storyboard: Storyboard, requestedSegment?: Storyboard[]) => {
    const generationProjectId = projectIdRef.current;
    const segmentIds = (requestedSegment?.length ? requestedSegment : [storyboard]).map(item => item.id);
    const segmentStoryboards = storyboardsRef.current
      .filter(item => segmentIds.includes(item.id))
      .sort((a, b) => a.sceneNumber - b.sceneNumber)
      .map(item => ({ ...item, visualStyle }));
    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: 'generating...' } : sb));
    try {
      const response = await fetch('/api/generate-video-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard: { ...storyboard, visualStyle }, segmentStoryboards, language: projectLanguageRef.current, apiKey: settings.apiKey })
      });
      const data = await readApiJson<{ videoPrompt: string }>(response, '视频提示词生成失败');
      if (generationProjectId !== projectIdRef.current) return;
      // Generated previews are informative. The final H3 request is rebuilt
      // with the current segment members and runtime voice references unless
      // the user explicitly edits and saves an override.
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: data.videoPrompt, videoPromptOverride: false } : sb));
    } catch (error) {
      if (generationProjectId !== projectIdRef.current) return;
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: '' } : sb));
      alert(`视频提示词生成失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleGenerateAudio = async (storyboard: Storyboard) => {
    if (!settings.fishAudioKey) { alert('Please configure Fish Audio API Key in settings'); return; }
    const generationProjectId = projectIdRef.current;
    const speech = storyboardSpeech(storyboard);
    if (!speech.length) return;

    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, audioStatus: 'generating' } : sb));
    try {
      const lines = speech.map(line => {
          const charName = line.character.trim().toLowerCase();
          const matched = characters.find(c => c.name.trim().toLowerCase() === charName);
          return {
            character: line.character,
            text: line.exactLine,
            voiceId: line.voiceId || matched?.voiceId,
          };
        });

      const response = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, fishAudioKey: settings.fishAudioKey })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed');
      const { characterAudios, audioUrl } = await response.json();
      if (generationProjectId !== projectIdRef.current) return;

      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id
        ? { ...sb, audioStatus: 'completed', characterAudios, audioUrl }
        : sb
      ));
    } catch (error) {
      if (generationProjectId !== projectIdRef.current) return;
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, audioStatus: 'failed' } : sb));
      alert(`Audio generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const currentShots = storyboardsRef.current;
    const requestedIds = (requestedSegment?.length ? requestedSegment : [storyboard]).map(item => item.id);
    const segment = currentShots.filter(item => requestedIds.includes(item.id)).sort((a, b) => a.sceneNumber - b.sceneNumber);
    const validationError = validateVideoSegment(segment, projectLanguageRef.current);
    if (validationError) {
      failBeforeSubmission(validationError);
      return;
    }
    if (segment.length > 1 && videoProvider !== 'comfyui') {
      failBeforeSubmission('多分镜单片段目前使用 MiniMax H3 多图工作流，请先在设置中选择仙宫云 ComfyUI');
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
    const speechSignature = segmentSpeechSignature(segment);
    let exactCharacterAudios = leader.audioSpeechSignature === speechSignature
      ? (leader.characterAudios || [])
      : [];
    let exactDialogueTrack = leader.audioSpeechSignature === speechSignature && leader.audioTrackVersion === 'locked-v1'
      ? leader.audioUrl
      : undefined;
    let exactDialogueTrackDuration = leader.audioSpeechSignature === speechSignature && leader.audioTrackVersion === 'locked-v1'
      ? leader.audioDuration
      : undefined;
    const segmentId = `segment-${Date.now()}-${leader.sceneNumber}`;
    const duration = estimateVideoSegmentSeconds(segment);
    const leaderIndex = currentShots.findIndex(item => item.id === leader.id);
    const immediatePrevious = leaderIndex > 0 ? currentShots[leaderIndex - 1] : undefined;
    const shouldContinuePreviousSegment = Boolean(leader.continuousFromPrev || (immediatePrevious
      && immediatePrevious.sequenceId === leader.sequenceId
      && immediatePrevious.locationId === leader.locationId
      && immediatePrevious.transition !== 'fade'));
    const generationSignature = videoSegmentGenerationSignature(segment.map(item => item.id === leader.id
      ? { ...item, continuousFromPrev: shouldContinuePreviousSegment }
      : item));
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
          videoStatus: 'generating' as const,
          videoUrl: undefined,
          videoSourceUrl: undefined,
          videoCacheKey: undefined,
          videoCacheStatus: undefined,
          videoCachedAt: undefined,
          videoTaskId: undefined,
          videoSegmentId: segmentId,
          videoSegmentStoryboardIds: item.id === leader.id ? segmentIds : undefined,
          videoGenerationSignature: item.id === leader.id ? generationSignature : undefined,
          videoDuration: duration,
          continuousFromPrev: item.id === leader.id ? shouldContinuePreviousSegment : item.continuousFromPrev,
        };
      });
    });
    try {
      // A generic voice sample contains unrelated words and can leak fragments
      // into Ref2VA's native soundtrack. When Fish Audio is configured, create
      // one clean reference per speaking character from this segment's exact
      // authoritative lines. If H3 follows either timbre or source content, it
      // can only hear words that are already allowed in the segment.
      if (videoProvider === 'comfyui' && speechSignature !== '[]' && !exactDialogueTrack && !activeSettings.fishAudioKey) {
        throw new Error('有台词的 H3 片段需要 Fish Audio Key 生成可锁定的精确对白音轨');
      }
      if (videoProvider === 'comfyui' && speechSignature !== '[]' && activeSettings.fishAudioKey && !exactDialogueTrack) {
        commitStoryboards(prev => prev.map(item => item.id === leader.id ? { ...item, audioStatus: 'generating' as const } : item));
        const timedSpeech = compileTimedSpeech(segment, allocateSegmentTimeline(segment, duration));
        const lines = timedSpeech.map(line => {
          const matched = charactersRef.current.find(character => character.name.trim().toLowerCase() === line.character.trim().toLowerCase());
          return {
            character: line.character,
            text: line.exactLine,
            voiceId: line.voiceId || matched?.voiceId,
            startSeconds: line.start,
          };
        });
        const audioResponse = await fetchStoryApi('/api/generate-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines, duration, fishAudioKey: activeSettings.fishAudioKey }),
        }, activeSettings.comfyui);
        const audioData = await readApiJson<{ characterAudios: { character: string; audioUrl: string; audioDuration?: number }[]; audioUrl?: string; audioDuration?: number }>(audioResponse, '准确台词音频生成失败');
        exactCharacterAudios = audioData.characterAudios || [];
        exactDialogueTrack = audioData.audioUrl;
        exactDialogueTrackDuration = audioData.audioDuration;
        if (!exactDialogueTrack) throw new Error('准确台词音频生成成功但没有返回锁定音轨');
        commitStoryboards(prev => prev.map(item => item.id === leader.id ? {
          ...item,
          audioStatus: 'completed' as const,
          characterAudios: exactCharacterAudios,
          audioUrl: exactDialogueTrack,
          audioDuration: exactDialogueTrackDuration,
          audioTrackVersion: 'locked-v1',
          audioSpeechSignature: speechSignature,
        } : item));
      }

      const portableSegment = await Promise.all(segment.map(async item => ({
        ...item,
        visualStyle,
        imageUrl: videoProvider === 'comfyui'
          // Crop once to the project ratio and use a quality/size ladder before
          // inlining. H3 receives a sharp standalone frame instead of a huge
          // 4K mother grid or a soft low-resolution crop.
          ? await prepareStoryboardReference(item.imageUrl!, `场景 ${item.sceneNumber} 分镜图`, projectAspectRatioRef.current)
          : item.imageUrl,
      })));
      const speakingCharacters = [...new Set(segment.flatMap(item => {
        const lines = item.dialogueLines?.length
          ? item.dialogueLines
          : Object.entries(item.dialogue || {}).map(([character, text]) => ({ character, text }));
        return lines.filter(line => String(line.text || '').trim()).map(line => line.character);
      }))];
      const portableVoiceEntries = videoProvider === 'comfyui'
        ? await Promise.all(speakingCharacters.map(async character => {
            const source = voiceReferencesRef.current?.[character];
            return source
              ? [character, await makePortableMediaSource(source, `${character} 声音参考`, true)] as const
              : undefined;
          }))
        : [];
      const portableVoiceReferences = Object.fromEntries(portableVoiceEntries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
      const portableCharacterAudios = videoProvider === 'comfyui'
        ? await Promise.all(exactCharacterAudios.map(async audio => ({
            ...audio,
            audioUrl: await makePortableMediaSource(audio.audioUrl, `${audio.character} 准确台词音频`, true),
          })))
        : exactCharacterAudios;
      const portableDialogueTrack = videoProvider === 'comfyui' && exactDialogueTrack
        ? await makePortableMediaSource(exactDialogueTrack, '准确台词锁定音轨', true)
        : undefined;
      const storyboardForRequest = {
        ...portableSegment[0],
        videoDuration: duration,
        videoSegmentId: segmentId,
        videoSegmentStoryboardIds: segmentIds,
      };

      // A previous generated segment may cover several storyboards, so use the
      // nearest preceding segment leader that actually owns a video URL.
      const prevShot = shouldContinuePreviousSegment && leaderIndex > 0
        ? currentShots.slice(0, leaderIndex).reverse().find(item => item.videoUrl)
        : undefined;
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
      } else if (videoProvider === 'comfyui' && prevShot?.imageUrl) {
        firstFrameUrl = await prepareStoryboardReference(prevShot.imageUrl, `场景 ${prevShot.sceneNumber} 分镜图`, projectAspectRatioRef.current);
      }

      const generationUrl = videoProvider === 'comfyui'
        ? comfyUIApiUrl('/api/generate-video', activeSettings.comfyui)
        : '/api/generate-video';
      const response = await fetch(generationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard: storyboardForRequest, segmentStoryboards: portableSegment, language: projectLanguageRef.current, apiKey: activeSettings.apiKey, videoModel: activeSettings.videoModel, aspectRatio: projectAspectRatioRef.current, characterAudios: portableCharacterAudios, driveAudio: portableDialogueTrack, lockDialogueAudio: videoProvider === 'comfyui', firstFrameUrl, voiceReferences: videoProvider === 'comfyui' ? portableVoiceReferences : (voiceReferencesRef.current || {}), videoProvider, comfyui: localComfyUISettings(activeSettings.comfyui) })
      });
      const data = await readApiJson<{ taskId: string }>(response, '视频任务创建失败');
      if (generationProjectId !== projectIdRef.current) return;
      const submittedStoryboards = storyboardsRef.current.map(sb => segmentIds.includes(sb.id) ? {
        ...sb,
        videoTaskId: sb.id === leader.id ? data.taskId : undefined,
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
        storyOutline: '',
        storyboards: submittedStoryboards,
        voiceReferences: voiceReferencesRef.current,
        costumeImages: costumeImagesRef.current,
        sceneImages: sceneImagesRef.current,
        storyPlan,
        videoSegmentPlan: videoSegmentPlanRef.current,
        createdAt: new Date().toISOString(),
      });
      await pollVideoStatus(leader.id, data.taskId, segmentIds, generationProjectId, generationSignature);
    } catch (error) {
      console.error('Video generation failed:', error);
      if (generationProjectId !== projectIdRef.current) return;
      commitStoryboards(prev => prev.map(sb => segmentIds.includes(sb.id) ? { ...sb, videoStatus: 'failed' } : sb));
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
              localDelivery: isComfyTask,
              comfyui: localComfyUISettings(currentSettings.comfyui),
            })
          });
          if (!response.ok) throw new Error(await videoStatusResponseError(response));

          const data = await response.json();
          if (generationProjectId !== projectIdRef.current) return;

          if (isComfyTask && data.status === 'completed' && data.readyForDownload) {
            const localVideoUrl = await downloadComfyUIVideo(taskId, currentSettings.comfyui);
            await cacheCompletedVideo(storyboardId, localVideoUrl, segmentStoryboardIds, generationProjectId, generationSignature);
            return;
          }
          if (data.status === 'completed' && data.videoUrl) {
            await cacheCompletedVideo(storyboardId, data.videoUrl, segmentStoryboardIds, generationProjectId, generationSignature);
            return;
          }
          if (data.status === 'failed') throw new TerminalVideoTaskError(data.error || '仙宫云视频任务执行失败');
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
    if (!initialSettings.apiKey) { alert('一键成片需要先配置 APIMart API Key（剧本单独使用 DMX 也不能替代生图 Key）'); return; }
    if (charactersRef.current.length === 0) { alert('一键成片至少需要一个角色'); return; }
    if (storyboardsRef.current.length === 0 && !storyContent.trim()) { alert('请先填写故事内容'); return; }
    autoRunLockRef.current = true;
    markAutoProduction(projectIdRef.current, 'running');
    setAutoPaused(false);
    setAutoRunning(true);
    setAutoStage('编剧 + 分镜');
    autoAbortRef.current = false;

    const waitBeforeRetry = async (milliseconds: number) => {
      const deadline = Date.now() + milliseconds;
      while (!autoAbortRef.current && Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, Math.min(1000, deadline - Date.now())));
      }
    };
    const retryUntilCompleted = async <T,>(label: string, operation: () => Promise<T>): Promise<T | undefined> => {
      let failureCount = 0;
      while (!autoAbortRef.current) {
        try {
          setAutoStage(failureCount ? `${label}（第 ${failureCount + 1} 次尝试）` : label);
          const result = await operation();
          persistCurrentProject();
          return result;
        } catch (error) {
          if (autoAbortRef.current) return undefined;
          failureCount += 1;
          persistCurrentProject();
          const delayMilliseconds = autoRetryDelayMs(failureCount);
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
          const generated = await runScript();
          if (!generated.length) throw new Error('导演阶段没有返回任何分镜');
          return generated;
        });
        if (autoAbortRef.current) return;
        setCurrentStep(3);
      }

      for (const character of charactersRef.current) {
        if (autoAbortRef.current) return;
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
      for (const character of charactersRef.current) {
        if (autoAbortRef.current) return;
        if (settingsRef.current.fishAudioKey && !voiceReferencesRef.current?.[character.name]) {
          await retryUntilCompleted(`生成 ${character.name} 音色参考`, async () => {
            await handleGenerateVoiceReference(character.name, { throwOnError: true });
            if (!voiceReferencesRef.current?.[character.name]) throw new Error('任务结束但没有返回音色参考');
          });
        }
      }
      if (autoAbortRef.current) return;

      setCurrentStep(4);
      await retryUntilCompleted('九宫格生成分镜图', async () => {
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
          const plan = planAutoImageBatch(group);
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
            await handleGenerateImage(missing, { throwOnError: true });
          }
        }
        const unfinished = storyboardsRef.current.filter(sb => !hasUsableStoryboardImage(sb));
        if (unfinished.length) throw new Error(`仍有 ${unfinished.length} 个分镜未完成`);
      });
      if (autoAbortRef.current) return;

      setCurrentStep(5);
      const videoProvider = settingsRef.current.videoProvider || 'apimart';
      const videoGroups = videoProvider === 'comfyui'
        ? resolveVideoSegmentGroups(
            storyboardsRef.current.filter(item => item.imageUrl),
            videoSegmentPlanRef.current,
            projectLanguageRef.current,
          )
        : storyboardsRef.current.filter(item => item.imageUrl).map(item => [item]);
      for (const group of videoGroups) {
        if (autoAbortRef.current) return;
        const groupLabel = `视频片段 ${group.map(item => item.sceneNumber).join('·')}`;
        await retryUntilCompleted(groupLabel, async () => {
          const latestGroup = group.map(item => storyboardsRef.current.find(current => current.id === item.id) || item);
          const latestLeader = latestGroup[0];
          const alreadyDone = videoProvider === 'comfyui'
            ? isCompletedVideoSegment(latestGroup)
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
            const recoveredDone = videoProvider === 'comfyui'
              ? isCompletedVideoSegment(recovered)
              : recovered.every(item => item.videoStatus === 'completed' && item.videoUrl);
            if (recoveredDone) return;
          }

          await handleGenerateVideo(latestLeader, latestGroup, { throwOnError: true });
          const completed = latestGroup.map(item => storyboardsRef.current.find(current => current.id === item.id) || item);
          const isDone = videoProvider === 'comfyui'
            ? isCompletedVideoSegment(completed)
            : completed.every(item => item.videoStatus === 'completed' && item.videoUrl);
          if (!isDone) throw new Error('任务结束但没有返回完整视频');
        });
      }
      if (autoAbortRef.current) return;

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
      alert(`自动生成中断：${error instanceof Error ? error.message : 'Unknown error'}`);
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
    persistCurrentProject();
    markAutoProduction(projectIdRef.current, 'paused');
    setAutoPaused(true);
    setAutoRunning(false);
    setAutoStage('已暂停；已提交的任务仍会在后台完成');
  };

  const handleAutoExportComplete = () => {
    const completion = autoExportCompletionRef.current;
    autoExportCompletionRef.current = undefined;
    completion?.resolve();
  };

  const handleAutoExportError = (error: unknown) => {
    const completion = autoExportCompletionRef.current;
    autoExportCompletionRef.current = undefined;
    completion?.reject(error);
  };

  useEffect(() => {
    if (!autoResumeRequested || autoRunLockRef.current) return;
    if (!settings.apiKey || projectIdRef.current !== savedAutoProductionProjectId()) return;
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
          currentTask={isLoading ? 'Generating script...' : undefined}
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
            onGenerateAudio={handleGenerateAudio}
            onGenerateVideo={handleGenerateVideo}
            onGenerateGrid={handleGenerateGrid}
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
                onVideoSegmentPlanChange={handleVideoSegmentPlanChange}
                onBack={() => setCurrentStep(4)}
                onNext={() => setCurrentStep(6)}
                onGenerateVideo={handleGenerateVideo}
                onGenerateVideoPrompt={handleGenerateVideoPrompt}
                onGenerateAudio={handleGenerateAudio}
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
