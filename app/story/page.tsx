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
import { Character, ObjectItem, Storyboard } from '@/types';
import { StoryPlan } from '@/lib/pipeline/types';
import { useProject } from '@/hooks/useProject';
import { useSettings } from '@/hooks/useSettings';
import { comfyUIApiUrl, downloadComfyUIVideo, fetchStoryApi, isComfyUIClientTask, localComfyUISettings, videoStatusResponseError } from '@/lib/comfyuiClient';
import { Grid3x3 } from 'lucide-react';
import { readApiJson } from '@/lib/apiResponse';
import { buildShotCountContract, DEFAULT_TARGET_SHOT_COUNT, normalizeTargetShotCount, storyPlanBeatCount, targetDurationSeconds } from '@/lib/pipeline/shotCount';
import { cacheVideoSource, cachedVideoObjectUrl, requestPersistentVideoStorage, videoCacheKeyForStoryboard } from '@/lib/videoCache';

async function makePortableMediaSource(source: string, label: string): Promise<string> {
  if (!source.startsWith('blob:')) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${label}读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
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

    // Seek just before the media endpoint. The exact endpoint can be an empty
    // decoder frame on some MP4s, while one frame earlier is the true visible tail.
    const tailTime = Math.max(0, video.duration - Math.min(1 / 30, video.duration / 2));
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

export default function StoryPage() {
  const { projectName, setProjectName, saveProject, loadProject, exportProject, newProject } = useProject();
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [isCanvasMode, setIsCanvasMode] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [objects, setObjects] = useState<ObjectItem[]>([]);
  const [storyContent, setStoryContent] = useState('');
  const [targetShotCount, setTargetShotCount] = useState(DEFAULT_TARGET_SHOT_COUNT);
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [storyPlan, setStoryPlan] = useState<StoryPlan | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [costumeImages, setCostumeImages] = useState<Record<string, string>>({}); // { 角色名: URL }
  const [costumeGenerating, setCostumeGenerating] = useState<Record<string, boolean>>({}); // { 角色名: bool }
  const [voiceReferences, setVoiceReferences] = useState<Record<string, string>>(); // { 角色名: Cloudinary URL }
  const [voiceGenerating, setVoiceGenerating] = useState<Record<string, boolean>>({}); // { 角色名: bool }
  const [sceneImages, setSceneImages] = useState<string[]>([]);
  const [sceneGenerating, setSceneGenerating] = useState(false);
  const [isGeneratingGrid, setIsGeneratingGrid] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoStage, setAutoStage] = useState('');
  const autoAbortRef = useRef(false);
  const videoRecoveryRef = useRef(new Set<string>());

  const cacheCompletedVideo = async (storyboardId: string, sourceUrl: string): Promise<string> => {
    const cacheKey = videoCacheKeyForStoryboard(storyboardId);
    setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? {
      ...sb,
      videoStatus: 'completed',
      videoUrl: sourceUrl,
      videoSourceUrl: sourceUrl.startsWith('http') ? sourceUrl : sb.videoSourceUrl,
      videoCacheKey: cacheKey,
      videoCacheStatus: 'caching',
    } : sb));

    try {
      void requestPersistentVideoStorage();
      const cached = await cacheVideoSource(cacheKey, sourceUrl);
      const cachedAt = new Date().toISOString();
      setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? {
        ...sb,
        videoStatus: 'completed',
        videoUrl: cached.objectUrl,
        videoSourceUrl: sourceUrl.startsWith('http') ? sourceUrl : sb.videoSourceUrl,
        videoCacheKey: cacheKey,
        videoCacheStatus: 'completed',
        videoCachedAt: cachedAt,
      } : sb));
      return cached.objectUrl;
    } catch (error) {
      console.error(`场景 ${storyboardId} 本地视频缓存失败:`, error);
      setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? {
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

  const recoverProjectVideos = async (sourceStoryboards: Storyboard[]) => {
    for (const storyboard of sourceStoryboards) {
      // Probe the deterministic cache key for every shot. This also recovers a
      // clip completed less than 30 seconds before refresh, before autosave had
      // time to persist its final videoStatus/cache metadata.
      if (videoRecoveryRef.current.has(storyboard.id)) continue;
      videoRecoveryRef.current.add(storyboard.id);
      const cacheKey = storyboard.videoCacheKey || videoCacheKeyForStoryboard(storyboard.id);
      try {
        const cachedUrl = await cachedVideoObjectUrl(cacheKey);
        if (cachedUrl) {
          setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? {
            ...sb,
            videoStatus: 'completed',
            videoUrl: cachedUrl,
            videoCacheKey: cacheKey,
            videoCacheStatus: 'completed',
          } : sb));
          continue;
        }

        const remoteUrl = storyboard.videoSourceUrl
          || (storyboard.videoUrl?.startsWith('http') ? storyboard.videoUrl : undefined);
        if (remoteUrl) {
          await cacheCompletedVideo(storyboard.id, remoteUrl);
          continue;
        }

        // Compatibility recovery for projects created before local caching:
        // a saved ComfyUI task id can still be downloaded again from 仙宫云.
        if (storyboard.videoTaskId && isComfyUIClientTask(storyboard.videoTaskId)) {
          const recoveredUrl = await downloadComfyUIVideo(storyboard.videoTaskId, settingsRef.current.comfyui);
          await cacheCompletedVideo(storyboard.id, recoveredUrl);
        }
      } catch (error) {
        console.warn(`场景 ${storyboard.sceneNumber} 视频恢复失败:`, error);
        setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? {
          ...sb,
          videoUrl: sb.videoUrl?.startsWith('blob:') ? undefined : sb.videoUrl,
          videoCacheKey: cacheKey,
          videoCacheStatus: 'failed',
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
  useEffect(() => {
    storyboardsRef.current = storyboards;
    charactersRef.current = characters;
    objectsRef.current = objects;
    costumeImagesRef.current = costumeImages;
    voiceReferencesRef.current = voiceReferences;
    sceneImagesRef.current = sceneImages;
    settingsRef.current = settings;
  }, [storyboards, characters, objects, costumeImages, voiceReferences, sceneImages, settings]);

  useEffect(() => {
    const savedProject = loadProject();
    if (savedProject) {
      setCharacters(savedProject.characters || []);
      setObjects(savedProject.objects || []);
      setStoryContent(savedProject.storyContent || '');
      setTargetShotCount(normalizeTargetShotCount(savedProject.targetShotCount));
      const savedStoryboards = savedProject.storyboards || [];
      setStoryboards(savedStoryboards);
      void recoverProjectVideos(savedStoryboards);
      setVoiceReferences(savedProject.voiceReferences);
      setCostumeImages(savedProject.costumeImages || {});
      setSceneImages(savedProject.sceneImages || []);
      setStoryPlan(savedProject.storyPlan);
      if (savedProject.storyboards?.length > 0) setCurrentStep(4);
      else if (savedProject.storyContent && savedProject.characters?.length > 0) setCurrentStep(2);
    }
  }, [loadProject]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (characters.length > 0 || storyContent || storyboards.length > 0) {
        saveProject({ characters, objects, storyContent, targetShotCount, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, createdAt: new Date().toISOString() });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [characters, objects, storyContent, targetShotCount, storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, saveProject]);

  const handleSave = () => {
    saveProject({ characters, objects, storyContent, targetShotCount, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, createdAt: new Date().toISOString() });
    alert('Project saved!');
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
        setProjectName(data.name || 'Untitled Project');
        setCharacters(data.characters || []);
        setObjects(data.objects || []);
        setStoryContent(data.storyContent || '');
        setTargetShotCount(normalizeTargetShotCount(data.targetShotCount));
        const importedStoryboards = data.storyboards || [];
        setStoryboards(importedStoryboards);
        void recoverProjectVideos(importedStoryboards);
        setVoiceReferences(data.voiceReferences);
        setCostumeImages(data.costumeImages || {});
        setSceneImages(data.sceneImages || []);
        setStoryPlan(data.storyPlan);
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
    exportProject({ name: projectName, characters, objects, storyContent, targetShotCount, storyOutline: '', storyboards, voiceReferences, costumeImages, sceneImages, storyPlan, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  const handleUpdateStoryboard = (updated: Storyboard) => {
    setStoryboards(prev => prev.map(sb => sb.id === updated.id ? updated : sb));
  };

  // Step2 → Step3: generate shot script from story + characters
  // ① 编剧 + ② 导演：梗概 → StoryPlan → 分镜。返回生成的分镜数组供编排器使用。
  const runScript = async (): Promise<Storyboard[]> => {
    // Never send uploaded image/base64/File fields to the text-only screenplay
    // endpoints. Besides wasting bandwidth, large character images can make a
    // hosting gateway reject the request with an HTML 413/5xx page.
    const writerCharacters = characters.map(({ name, description, voiceId }) => ({ name, description, voiceId }));
    const writerObjects = objects.map(({ name, description }) => ({ name, description }));
    const language = settings.language || 'zh';
    // Older Companion builds ignore the structured field below, so append the
    // same production spec to the brief as a backwards-compatible contract.
    const planningSynopsis = `${storyContent.trim()}\n\n${buildShotCountContract(targetShotCount, language)}`;
    const planRes = await fetchStoryApi('/api/generate-story-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synopsis: planningSynopsis, targetShotCount, characters: writerCharacters, objects: writerObjects, apiKey: settings.apiKey, language, scriptModel: settings.scriptModel || 'gpt-4o', dmxApiKey: settings.dmxApiKey })
    }, settings.comfyui);
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
    setStoryPlan(storyPlan);

    const dirRes = await fetchStoryApi('/api/direct-storyboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyPlan, characters: writerCharacters, objects: writerObjects, apiKey: settings.apiKey, aspectRatio: settings.aspectRatio, language, scriptModel: settings.scriptModel || 'gpt-4o', dmxApiKey: settings.dmxApiKey })
    }, settings.comfyui);
    const { storyboards } = await readApiJson<{ storyboards: Storyboard[] }>(dirRes, '分镜导演失败');
    setStoryboards(storyboards);
    storyboardsRef.current = storyboards;
    return storyboards;
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
  const handleGenerateGrid = async (batch: Storyboard[]) => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
    const { buildGridPrompt, splitGridImage } = await import('@/lib/gridSplitter');
    const aspectRatio = settings.aspectRatio;
    // Process in groups of 9
    for (let i = 0; i < batch.length; i += 9) {
      const group = batch.slice(i, i + 9);
      setIsGeneratingGrid(true);
      setStoryboards(prev => prev.map(sb =>
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
        const groupCharacters = characters.filter(character =>
          group.some(sb => mentionsEntity(sb, character.name, sb.characters))
        );
        const groupObjects = objects.filter(object =>
          group.some(sb => mentionsEntity(sb, object.name, sb.objects))
        );
        const summarize = (value: string, maxLength = 160) =>
          value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

        // Build grid prompt from group's prompts
        const sceneStyle = group[0]?.sceneStyle || '';
        const charDescs = groupCharacters
          .map(c => `${c.name}: ${summarize(c.description)}`)
          .join('\n');
        const shotDescs = group.map(sb => {
          const cleanPrompt = sb.prompt.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]/g, '$1');
          const requiredCharacters = groupCharacters
            .filter(character => mentionsEntity(sb, character.name, sb.characters))
            .map(character => character.name);
          const requiredObjects = groupObjects
            .filter(object => mentionsEntity(sb, object.name, sb.objects))
            .map(object => object.name);
          const panelChars = requiredCharacters.length
            ? `REQUIRED CHARACTERS (all must be visible): ${requiredCharacters.join(', ')}.`
            : 'REQUIRED CHARACTERS: none.';
          const panelObjs = requiredObjects.length
            ? `REQUIRED OBJECTS (all must be visible): ${requiredObjects.join(', ')}.`
            : '';
          return `${summarize(cleanPrompt, 220)} ${panelChars} ${panelObjs}`.trim();
        });

        // Keep labels and images in exactly the same order. Text-only entities
        // stay in the prompt but must not consume a reference image number.
        const characterReferences = groupCharacters
          .map(character => ({
            image: costumeImages[character.name] || character.imageUrl || character.imageBase64,
            label: `${character.name} — ${summarize(character.description)}`
          }))
          .filter((reference): reference is { image: string; label: string } => Boolean(reference.image));
        const objectReferences = groupObjects
          .map(object => ({
            image: object.imageUrl || object.imageBase64,
            label: `${object.name} — ${summarize(object.description)}`
          }))
          .filter((reference): reference is { image: string; label: string } => Boolean(reference.image));
        const sceneReference = sceneImages[0]
          ? [{ image: sceneImages[0], label: 'Scene/environment reference' }]
          : [];
        const references = [...characterReferences, ...sceneReference, ...objectReferences];
        const refLabels = references.map(reference => reference.label);
        const gridPrompt = buildGridPrompt(sceneStyle, charDescs, shotDescs, aspectRatio, refLabels);

        const refImages = references.map(reference => reference.image);
        const gridStoryboard = {
          ...group[0],
          prompt: gridPrompt,
          characters: groupCharacters.map(character => character.name),
          objects: groupObjects.map(object => object.name)
        };

        // Generate grid image
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyboard: gridStoryboard,
            characters: groupCharacters,
            objects: groupObjects,
            aspectRatio,
            imageModel: settings.imageModel,
            apiKey: settings.apiKey,
            costumeImages,
            sceneImage: sceneImages[0] || '',
            // 传递所有参考图（角色 + 场景 + 物体）
            referenceImages: refImages,
            referenceImageLabels: refLabels,
            visualStyle: settings.visualStyle
          })
        });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(errorText || 'Grid generation failed');
        }
        const { taskId } = await res.json();
        setStoryboards(prev => prev.map(sb =>
          group.some(g => g.id === sb.id) ? { ...sb, taskId } : sb
        ));

        // Poll for grid image
        let gridUrl = '';
        for (let j = 0; j < 90; j++) {
          await new Promise(r => setTimeout(r, 3000));
          const statusRes = await fetch('/api/check-image-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, apiKey: settings.apiKey })
          });
          if (!statusRes.ok) continue;
          const statusData = await statusRes.json();
          if (statusData.status === 'completed' && statusData.imageUrl) { gridUrl = statusData.imageUrl; break; }
          if (statusData.status === 'failed') {
            console.error('Grid generation failed:', statusData);
            throw new Error(statusData.error || statusData.details?.message || 'Grid image failed');
          }
        }
        if (!gridUrl) throw new Error('Grid image timeout');

        // Split grid into 9 cells and upload to Cloudinary
        const cells = await splitGridImage(gridUrl, aspectRatio);
        console.log('Split cells:', cells.length);
        const uploadedCells = await Promise.all(cells.slice(0, group.length).map(async (cell, idx) => {
          if (!cell.startsWith('data:')) return cell;
          try {
            const uploadRes = await fetch('/api/upload-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageData: cell })
            });
            if (!uploadRes.ok) {
              console.error(`Upload failed for cell ${idx}:`, await uploadRes.text());
              return cell;
            }
            const { url } = await uploadRes.json();
            console.log(`Cell ${idx} uploaded:`, url);
            return url;
          } catch (error) {
            console.error(`Upload error for cell ${idx}:`, error);
            return cell;
          }
        }));
        console.log('Uploaded cells:', uploadedCells);
        setStoryboards(prev => prev.map(sb => {
          const idx = group.findIndex(g => g.id === sb.id);
          if (idx === -1) return sb;
          const newImageUrl = uploadedCells[idx];
          if (!newImageUrl) {
            console.warn(`No image URL for ${sb.id} at index ${idx}`);
            return sb;
          }
          console.log(`Setting imageUrl for ${sb.id}:`, newImageUrl);
          return { ...sb, imageUrl: newImageUrl, status: 'completed' as const };
        }));
      } catch (error) {
        console.error('Grid generation failed:', error);
        setStoryboards(prev => prev.map(sb =>
          group.some(g => g.id === sb.id) ? { ...sb, status: 'failed' } : sb
        ));
        alert(`Grid generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setIsGeneratingGrid(false);
      }
    }
  };

  // Step4: individual image generation
  const handleGenerateImage = async (storyboard: Storyboard) => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, status: 'generating' } : sb));
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard, characters, objects, aspectRatio: storyboard.aspectRatio || settings.aspectRatio, imageModel: settings.imageModel, apiKey: settings.apiKey, costumeImages: costumeImagesRef.current, sceneImage: storyboard.sceneImageOverride || sceneImagesRef.current[0] || '', visualStyle: settings.visualStyle })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed to generate image');
      const data = await response.json();
      await pollImageStatus(storyboard.id, data.taskId);
    } catch (error) {
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, status: 'failed' } : sb));
    }
  };

  const pollImageStatus = async (storyboardId: string, taskId: string) => {
    for (let i = 0; i < 90; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      try {
        const response = await fetch('/api/check-image-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey: settings.apiKey })
        });
        if (!response.ok) continue;
        const data = await response.json();
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
          setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, status: 'completed', imageUrl, taskId } : sb));
          storyboardsRef.current = storyboardsRef.current.map(sb => sb.id === storyboardId ? { ...sb, status: 'completed', imageUrl, taskId } : sb);
          return;
        }
        if (data.status === 'failed') {
          setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, status: 'failed' } : sb));
          return;
        }
      } catch { /* continue polling */ }
    }
    setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, status: 'failed' } : sb));
  };

  const handleGenerateCostume = async (type: 'costume' | 'scene', characterName?: string) => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
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
          aspectRatio: settings.aspectRatio,
          imageModel: settings.imageModel,
          apiKey: settings.apiKey,
          visualStyle: settings.visualStyle
        })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed');
      const { taskId } = await response.json();

      // Poll for completion
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch('/api/check-image-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey: settings.apiKey })
        });
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        if (statusData.status === 'completed' && statusData.imageUrl) {
          if (type === 'costume' && characterName) {
            setCostumeImages(prev => ({ ...prev, [characterName]: statusData.imageUrl }));
          } else {
            setSceneImages(prev => [...prev, statusData.imageUrl]);
          }
          return;
        }
        if (statusData.status === 'failed') throw new Error('Image generation failed');
      }
      throw new Error('Timeout');
    } catch (error) {
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (type === 'costume' && characterName) {
        setCostumeGenerating(prev => ({ ...prev, [characterName]: false }));
      } else {
        setSceneGenerating(false);
      }
    }
  };

  const handleGenerateVoiceReference = async (characterName: string) => {
    if (!settings.fishAudioKey) { alert('Please configure Fish Audio API Key in settings'); return; }
    const character = characters.find(c => c.name === characterName);
    if (!character) return;
    setVoiceGenerating(prev => ({ ...prev, [characterName]: true }));
    try {
      // 取描述前80字，不足时补一句兜底语保证TTS时长 >= 1.8s
      const sampleText = `${character.description.slice(0, 80)}` || `你好，我是${characterName}，很高兴认识你们。`;
      const res = await fetch('/api/generate-voice-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterName,
          sampleText,
          voiceId: character.voiceId,
          fishAudioKey: settings.fishAudioKey,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const { url } = await res.json();
      setVoiceReferences(prev => ({ ...(prev || {}), [characterName]: url }));
    } catch (err) {
      alert(`Voice reference failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setVoiceGenerating(prev => ({ ...prev, [characterName]: false }));
    }
  };

  const handleGenerateVideoPrompt = async (storyboard: Storyboard) => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: 'generating...' } : sb));
    try {
      const response = await fetch('/api/generate-video-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard, apiKey: settings.apiKey })
      });
      if (!response.ok) throw new Error('Failed to generate video prompt');
      const data = await response.json();
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: data.videoPrompt } : sb));
    } catch (error) {
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: '' } : sb));
      alert(`Failed to generate video prompt`);
    }
  };

  const handleGenerateAudio = async (storyboard: Storyboard) => {
    if (!settings.fishAudioKey) { alert('Please configure Fish Audio API Key in settings'); return; }
    const hasLines = (storyboard.dialogueLines?.length ?? 0) > 0 || Object.keys(storyboard.dialogue || {}).length > 0;
    if (!hasLines) return;

    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, audioStatus: 'generating' } : sb));
    try {
      // Use ordered dialogueLines if available, fall back to dialogue object
      const rawLines = storyboard.dialogueLines?.length
        ? storyboard.dialogueLines
        : Object.entries(storyboard.dialogue || {}).map(([character, text]) => ({ character, text }));

      const lines = rawLines
        .filter(l => l.text?.trim())
        .map(l => {
          const charName = l.character?.trim().toLowerCase();
          const matched = characters.find(c => c.name.trim().toLowerCase() === charName);
          return {
            character: l.character,
            text: l.text,
            voiceId: matched?.voiceId
          };
        });

      const response = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, fishAudioKey: settings.fishAudioKey })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed');
      const { characterAudios, audioUrl } = await response.json();

      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id
        ? { ...sb, audioStatus: 'completed', characterAudios, audioUrl }
        : sb
      ));
    } catch (error) {
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, audioStatus: 'failed' } : sb));
      alert(`Audio generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleGenerateVideo = async (storyboard: Storyboard) => {
    const videoProvider = settings.videoProvider || 'apimart';
    if (videoProvider === 'apimart' && !settings.apiKey) { alert('Please configure API Key in settings'); return; }
    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoStatus: 'generating' } : sb));
    try {
      // Buttons and the auto pipeline may hold a storyboard object created
      // before image polling finished. Always resolve the authoritative copy.
      const latestStoryboard = storyboardsRef.current.find(sb => sb.id === storyboard.id) || storyboard;
      if (!latestStoryboard.imageUrl) throw new Error(`场景 ${latestStoryboard.sceneNumber} 尚未生成分镜图`);
      const portableImageUrl = videoProvider === 'comfyui'
        ? await makePortableMediaSource(latestStoryboard.imageUrl, `场景 ${latestStoryboard.sceneNumber} 分镜图`)
        : latestStoryboard.imageUrl;
      const storyboardForRequest = { ...latestStoryboard, imageUrl: portableImageUrl };

      // Get last frame of previous shot's video for continuity (first_frame of current shot)
      const currentShots = storyboardsRef.current;
      const idx = currentShots.findIndex(sb => sb.id === latestStoryboard.id);
      const prevShot = latestStoryboard.continuousFromPrev && idx > 0 ? currentShots[idx - 1] : undefined;
      let firstFrameUrl: string | undefined;
      if (prevShot?.videoUrl?.includes('res.cloudinary.com')) {
        // Extract last frame from Cloudinary video URL
        // Format: so_100p = start offset 100% (last frame)
        firstFrameUrl = prevShot.videoUrl.replace('/video/upload/', '/video/upload/so_100p/').replace(/\.\w+$/, '.jpg');
      } else if (videoProvider === 'comfyui' && prevShot?.videoUrl) {
        // Companion returns a browser-local blob URL. Extract the actual visible
        // tail in the browser and send that still to Companion as the next shot's
        // first frame; this needs no Companion update and avoids falling back to
        // the older storyboard still.
        firstFrameUrl = await extractVideoTailFrame(prevShot.videoUrl, `场景 ${prevShot.sceneNumber} 视频`);
      } else if (videoProvider === 'comfyui' && prevShot?.imageUrl) {
        firstFrameUrl = await makePortableMediaSource(prevShot.imageUrl, `场景 ${prevShot.sceneNumber} 分镜图`);
      }

      const generationUrl = videoProvider === 'comfyui'
        ? comfyUIApiUrl('/api/generate-video', settings.comfyui)
        : '/api/generate-video';
      const response = await fetch(generationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard: storyboardForRequest, apiKey: settings.apiKey, videoModel: settings.videoModel, aspectRatio: latestStoryboard.aspectRatio || settings.aspectRatio, characterAudios: latestStoryboard.characterAudios || [], firstFrameUrl, voiceReferences: voiceReferencesRef.current || {}, videoProvider, comfyui: localComfyUISettings(settings.comfyui) })
      });
      const data = await readApiJson<{ taskId: string }>(response, '视频任务创建失败');
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoTaskId: data.taskId } : sb));
      await pollVideoStatus(storyboard.id, data.taskId);
    } catch (error) {
      console.error('Video generation failed:', error);
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoStatus: 'failed' } : sb));
      alert(`视频生成失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const pollVideoStatus = async (storyboardId: string, taskId: string) => {
    const isComfyTask = isComfyUIClientTask(taskId);
    let consecutiveErrors = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      try {
        const statusUrl = isComfyTask
          ? comfyUIApiUrl('/api/check-video-status', settings.comfyui)
          : '/api/check-video-status';
        const response = await fetch(statusUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            apiKey: settings.apiKey,
            localDelivery: isComfyTask,
            comfyui: localComfyUISettings(settings.comfyui),
          })
        });
        if (!response.ok) throw new Error(await videoStatusResponseError(response));

        const data = await response.json();

        if (isComfyTask && data.status === 'completed' && data.readyForDownload) {
          const localVideoUrl = await downloadComfyUIVideo(taskId, settings.comfyui);
          await cacheCompletedVideo(storyboardId, localVideoUrl);
          return;
        }
        if (data.status === 'completed' && data.videoUrl) {
          await cacheCompletedVideo(storyboardId, data.videoUrl);
          return;
        }
        if (data.status === 'failed') {
          setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, videoStatus: 'failed' } : sb));
          return;
        }
        consecutiveErrors = 0;
      } catch (error) {
        console.error('Video status polling error:', error);
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) {
          alert(`视频回传失败：${error instanceof Error ? error.message : '无法连接本地 Companion'}`);
          setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, videoStatus: 'failed' } : sb));
          return;
        }
      }
    }
    setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, videoStatus: 'failed' } : sb));
  };

  // 一键成片：编剧 → 定妆/音色 → 图片 → 视频 → 成片，全自动顺序执行。
  const handleAutoGenerate = async () => {
    if (!settings.apiKey && !settings.dmxApiKey) { alert('Please configure API Key in settings'); return; }
    setAutoRunning(true);
    setAutoStage('编剧 + 分镜');
    autoAbortRef.current = false;
    try {
      // ① 剧本（若尚未生成）
      let shots = storyboardsRef.current;
      if (shots.length === 0) {
        shots = await runScript();
        setCurrentStep(3);
      }
      if (autoAbortRef.current) return;

      // ② 定妆 + 场景 + 音色参考（每角色/每场景生成一次，复用）
      setAutoStage('生成定妆与音色参考');
      for (const c of charactersRef.current) {
        if (autoAbortRef.current) return;
        if (!costumeImagesRef.current[c.name]) await handleGenerateCostume('costume', c.name);
      }
      if (sceneImagesRef.current.length === 0) {
        if (autoAbortRef.current) return;
        await handleGenerateCostume('scene');
      }
      for (const c of charactersRef.current) {
        if (autoAbortRef.current) return;
        if (settings.fishAudioKey && !voiceReferencesRef.current?.[c.name]) await handleGenerateVoiceReference(c.name);
      }

      // ③ 图片（顺序生成，尊重每镜 prompt/时长/场景）
      setAutoStage('生成分镜图');
      for (const sb of shots) {
        if (autoAbortRef.current) return;
        if (sb.status !== 'completed') await handleGenerateImage(sb);
      }

      // ④ 视频（顺序生成，连续镜头自动接上一镜尾帧；读最新状态，图片阶段刚生成完）
      setAutoStage('生成视频');
      for (const sb of storyboardsRef.current) {
        if (autoAbortRef.current) return;
        if (sb.videoStatus !== 'completed' && sb.imageUrl) await handleGenerateVideo(sb);
      }

      // ⑤ 成片
      setAutoStage('成片');
      setCurrentStep(6);
    } catch (error) {
      alert(`自动生成中断：${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setAutoRunning(false);
      setAutoStage('');
    }
  };

  const handleAutoStop = () => {
    autoAbortRef.current = true;
    setAutoRunning(false);
    setAutoStage('');
  };

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
            storyContent={storyContent}
            storyboards={storyboards}
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
                      ⏹ 停止
                    </button>
                  ) : (
                    <button
                      onClick={handleAutoGenerate}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#5dd18d] text-[var(--bg-primary)] border border-[var(--border-color)] rounded transition-colors"
                    >
                      ✨ 一键成片
                    </button>
                  )
                )}
                {autoRunning && (
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
              />
            )}
            {currentStep === 2 && (
              <Step1
                storyContent={storyContent}
                onStoryLoad={setStoryContent}
                onNext={handleGenerateScript}
                onBack={() => setCurrentStep(1)}
                isLoading={isLoading}
                language={settings.language || 'zh'}
                onLanguageChange={(lang) => saveSettings({ ...settings, language: lang })}
                targetShotCount={targetShotCount}
                onTargetShotCountChange={setTargetShotCount}
                apiKey={settings.apiKey}
                scriptModel={settings.scriptModel}
                dmxApiKey={settings.dmxApiKey}
                companionSettings={settings.comfyui}
              />
            )}
            {currentStep === 3 && (
              <Step3
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
        onSave={saveSettings}
      />
    </DevToolsLayout>
    </div>
  );
}
