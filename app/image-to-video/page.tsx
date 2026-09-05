'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Upload, Video, X, Settings, Home, ChevronDown, ChevronUp, Edit, Clock3, Volume2, Layers3 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DevToolsLayout from '@/components/DevToolsLayout';
import CameraSelector from '@/components/CameraSelector';
import SettingsModal from '@/components/SettingsModal';
import { useSettings } from '@/hooks/useSettings';
import { companionVersionAtLeast, comfyUIApiUrl, downloadComfyUIVideo, H3_DIRECTOR_COMPANION_MIN_VERSION, isComfyUIClientTask, localComfyUISettings, videoStatusResponseError } from '@/lib/comfyuiClient';
import { enforceNoSubtitles } from '@/lib/videoTextPolicy';
import { DIRECTOR_DURATIONS, validateDirectorPlan, type DirectorPlan } from '@/lib/h3Director';
import { readApiJson } from '@/lib/apiResponse';

const MAX_COMFYUI_REFERENCE_IMAGES = 5;
const I2V_TASK_STORAGE = 'aid:i2v:task:v1';
type SavedVideoTask = { taskId: string; backend: string; state: 'pending' | 'completed' | 'failed'; totalSegments?: number };

export default function ImageToVideoPage() {
  const router = useRouter();
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);
  const [mainImage, setMainImage] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [secondImage, setSecondImage] = useState<string | null>(null);
  const [videoFiles, setVideoFiles] = useState<string[]>([]);
  const [audioFiles, setAudioFiles] = useState<string[]>([]);
  const [audioDurations, setAudioDurations] = useState<number[]>([]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [cameraParams, setCameraParams] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [duration, setDuration] = useState(5);
  const [quality, setQuality] = useState<'480p' | '720p'>('480p');
  const [comfyWorkflowMode, setComfyWorkflowMode] = useState<'single_reference' | 'multi_reference' | 'first_last' | 'director_continuous'>('single_reference');
  const [isGenerating, setIsGenerating] = useState(false);
  const [directorPlan, setDirectorPlan] = useState<DirectorPlan | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [activeTask, setActiveTask] = useState<SavedVideoTask | null>(null);
  const [taskMessage, setTaskMessage] = useState('');
  const pollController = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(I2V_TASK_STORAGE) || 'null');
      if (saved && typeof saved.taskId === 'string' && typeof saved.backend === 'string' && ['pending', 'completed', 'failed'].includes(saved.state)) {
        setActiveTask(saved);
        setTaskMessage('已保留任务编号，可继续查询或取回视频，不会重新提交生成。');
      }
    } catch { /* A broken local record must not block the page. */ }
    return () => pollController.current?.abort();
  }, []);
  const saveTask = (task: SavedVideoTask) => {
    setActiveTask(task);
    try { localStorage.setItem(I2V_TASK_STORAGE, JSON.stringify(task)); }
    catch { setTaskMessage('浏览器无法保存任务记录，请保留下方任务编号。'); }
  };

  useLayoutEffect(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    const minHeight = 192;
    const maxHeight = 512;
    textarea.style.height = 'auto';
    const contentHeight = Math.max(minHeight, textarea.scrollHeight);
    textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  }, [prompt]);

  // 根据 videoModel 动态调整参数
  const videoProvider = settings.videoProvider || 'apimart';
  const isComfyUI = videoProvider === 'comfyui';
  const isFal = videoProvider === 'fal';
  const isDirector = isComfyUI && comfyWorkflowMode === 'director_continuous';
  const taskBackend = isComfyUI
    ? JSON.stringify([comfyUIApiUrl('', settings.comfyui), settings.comfyui?.sshHost || '', settings.comfyui?.sshPort || '', settings.comfyui?.comfyPort || '', settings.comfyui?.workflowRoot || ''])
    : videoProvider;
  const fullVideoPrompt = enforceNoSubtitles(cameraParams ? `${prompt}. ${cameraParams}` : prompt);
  const currentDirectorPlan = directorPlan?.sourcePrompt === fullVideoPrompt && directorPlan?.duration === duration ? directorPlan : null;
  const hasDirectorExtraMedia = Boolean(secondImage || referenceImages.length || audioFiles.length || audioUrls.length || videoFiles.length || videoUrls.length);
  const modelName = settings.videoModel?.toLowerCase() || '';
  const isOmniFlashExt = !isComfyUI && !isFal && modelName.includes('omni-flash-ext');
  const isGrokImagine = !isComfyUI && !isFal && modelName.includes('grok-imagine');
  const isMiniMaxH3 = isComfyUI || isFal || modelName.includes('minimax-h3');
  const supportsH3VoiceReference = isComfyUI || (!isFal && modelName.includes('minimax-h3'));

  useLayoutEffect(() => {
    if (isFal) setQuality(settings.fal?.resolution === '480P' ? '480p' : '720p');
  }, [isFal, settings.fal?.resolution]);

  // 第二张图的语义按模型区分：
  // - seedance/doubao/wan/veo 支持首尾帧 → last_frame
  // - grok-imagine 只有参考图概念 → reference
  // - sora-2 最多 1 张图、omni-flash-ext 不支持 2 张图、happyhorse 首帧与参考图互斥 → none
  const secondImageMode: 'last_frame' | 'reference' | 'none' =
    isComfyUI
      ? comfyWorkflowMode === 'first_last' ? 'last_frame' : 'none'
      : isFal
        ? 'last_frame'
      : modelName.includes('seedance') || modelName.includes('doubao') || modelName.includes('wan') ||
    modelName.includes('veo') || isMiniMaxH3
      ? 'last_frame'
      : isGrokImagine
        ? 'reference'
        : 'none';
  const durationMin = isComfyUI ? 2 : (isOmniFlashExt ? 4 : (isGrokImagine ? 6 : (isFal ? 5 : (isMiniMaxH3 ? 4 : 5))));
  const durationMax = isDirector ? 60 : isOmniFlashExt ? 10 : (isGrokImagine ? 30 : 15);
  const durationOptions = isDirector ? DIRECTOR_DURATIONS : isOmniFlashExt ? [4, 6, 8, 10] : undefined;

  // 当切换到 Omni-Flash-Ext 时，自动调整 duration
  if (isOmniFlashExt && ![4, 6, 8, 10].includes(duration)) {
    setDuration(6);
  }
  // 当切换到 Grok Imagine 时，自动调整 duration
  if (isGrokImagine && (duration < 6 || duration > 30)) {
    setDuration(6);
  }
  useLayoutEffect(() => {
    if (isDirector) {
      if (duration !== 30 && duration !== 60) setDuration(30);
    } else if (duration > durationMax || duration < durationMin) setDuration(Math.max(durationMin, Math.min(durationMax, duration)));
  }, [duration, isDirector, durationMin, durationMax]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handleMainImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const maxSize = 6 * 1024 * 1024; // 6MB in bytes
      if (file.size > maxSize) {
        alert('Warning: Image size exceeds 6MB. Please upload a smaller image.');
        e.target.value = ''; // Clear the input
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => setMainImage(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSecondImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const maxSize = 6 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('Warning: Image size exceeds 6MB. Please upload a smaller image.');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => setSecondImage(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleReferenceImagesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const available = MAX_COMFYUI_REFERENCE_IMAGES - 1 - referenceImages.length;
    if (available <= 0) {
      alert(`MiniMax H3 多图参考最多使用 ${MAX_COMFYUI_REFERENCE_IMAGES} 张图片`);
      e.target.value = '';
      return;
    }
    const accepted = files.slice(0, available);
    if (files.length > available) {
      alert(`最多还能添加 ${available} 张图片（总计上限 ${MAX_COMFYUI_REFERENCE_IMAGES} 张）`);
    }
    const maxSize = 6 * 1024 * 1024;
    const oversized = accepted.find(file => file.size > maxSize);
    if (oversized) {
      alert(`${oversized.name} 超过 6MB，请选择更小的图片`);
      e.target.value = '';
      return;
    }
    const values = await Promise.all(accepted.map(file => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target?.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    setReferenceImages(previous => [...previous, ...values].slice(0, MAX_COMFYUI_REFERENCE_IMAGES - 1));
    e.target.value = '';
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => setVideoFiles(prev => [...prev, e.target?.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    try {
      const files = Array.from(input.files || []);
      if (isComfyUI) {
        const available = 3 - audioFiles.length;
        if (available <= 0) throw new Error('MiniMax H3 最多使用 3 条参考音频');
        if (files.length > available) throw new Error(`最多还能添加 ${available} 条参考音频`);
        const oversized = files.find(file => file.size > 20 * 1024 * 1024);
        if (oversized) throw new Error(`${oversized.name} 超过 20MB`);
      }

      const durations = isComfyUI
        ? await Promise.all(files.map(file => new Promise<number>((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const audio = document.createElement('audio');
            audio.preload = 'metadata';
            audio.onloadedmetadata = () => {
              const value = audio.duration;
              URL.revokeObjectURL(url);
              Number.isFinite(value) && value > 0 ? resolve(value) : reject(new Error(`${file.name} 无法读取时长`));
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              reject(new Error(`${file.name} 无法解析，请转换为 WAV、MP3 或 M4A`));
            };
            audio.src = url;
          })))
        : [];

      if (isComfyUI) {
        const invalidIndex = durations.findIndex(value => value < 2 || value > 15.05);
        if (invalidIndex >= 0) throw new Error(`${files[invalidIndex].name} 时长需在 2–15 秒之间`);
        const total = [...audioDurations, ...durations].reduce((sum, value) => sum + value, 0);
        if (total > 15.05) throw new Error(`参考音频总长 ${total.toFixed(1)} 秒，不能超过 15 秒`);
      }

      const values = await Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target?.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })));
      setAudioFiles(prev => [...prev, ...values]);
      if (isComfyUI) setAudioDurations(prev => [...prev, ...durations]);
    } catch (error) {
      alert(error instanceof Error ? error.message : '参考音频读取失败');
    } finally {
      input.value = '';
    }
  };

  const pollTaskStatus = async (task: SavedVideoTask) => {
    if (task.backend !== taskBackend) {
      alert('生成后已切换视频后端或云端实例，请恢复提交时的设置再继续查询，避免查错任务。');
      setIsGenerating(false);
      return;
    }
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    const { signal } = controller;
    const taskId = task.taskId;
    const maxAttempts = task.totalSegments ? 720 : 180;
    const isComfyTask = isComfyUIClientTask(taskId);
    setIsGenerating(true);
    let consecutiveErrors = 0;
    for (let i = 0; i < maxAttempts; i++) {
      if (i) await new Promise(resolve => setTimeout(resolve, 10000));
      if (signal.aborted) return;
      try {
        const statusUrl = isComfyTask
          ? comfyUIApiUrl('/api/check-video-status', settings.comfyui)
          : '/api/check-video-status';
        const response = await fetch(statusUrl, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            apiKey: settings.apiKey,
            fal: settings.fal,
            localDelivery: isComfyTask,
            comfyui: localComfyUISettings(settings.comfyui),
          })
        });
        if (!response.ok) throw new Error(await videoStatusResponseError(response));

        const data = await response.json();
        if (signal.aborted) return;
        if (data.status === 'processing') {
          setTaskMessage(data.stage === 'queued' ? '云端排队中' : data.stage === 'merging' ? '正在合并连续片段与音频' : data.totalSegments
            ? `连续生成中${Number.isInteger(data.completedSegments) ? `，已完成 ${data.completedSegments}/${data.totalSegments} 段` : `（共 ${data.totalSegments} 段）`}`
            : '云端生成中');
        }

        if (isComfyTask && data.status === 'completed' && data.readyForDownload) {
          const localVideoUrl = await downloadComfyUIVideo(taskId, settings.comfyui);
          if (signal.aborted) return;
          setVideoUrl(localVideoUrl);
          saveTask({ ...task, state: 'completed' });
          setTaskMessage('完整视频已生成，可预览、下载或进入编辑器。');
          setIsGenerating(false);
          return;
        }
        if (data.status === 'completed' && data.videoUrl) {
          setVideoUrl(data.videoUrl);
          saveTask({ ...task, state: 'completed' });
          setTaskMessage('视频已生成。');
          setIsGenerating(false);
          return;
        }
        if (data.status === 'failed') {
          saveTask({ ...task, state: 'failed' });
          setTaskMessage(`生成失败：${data.error || '未知错误'}。任务编号已保留，不会自动重提。`);
          alert(`Video generation failed: ${data.error || 'Unknown error'}`);
          setIsGenerating(false);
          return;
        }
        consecutiveErrors = 0;
      } catch (error) {
        if (signal.aborted) return;
        console.error('Polling error:', error);
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) {
          setTaskMessage(`查询或下载暂时中断：${error instanceof Error ? error.message : '无法连接本地 Companion'}。任务编号已保存，请点“继续查询”，不会重新生成。`);
          setIsGenerating(false);
          return;
        }
      }
    }
    setTaskMessage('等待时间较长，已暂停查询；任务编号保留，后台任务不会被取消。可继续查询。');
    setIsGenerating(false);
  };

  const assertDirectorSupport = async () => {
    const response = await fetch(comfyUIApiUrl('/api/companion/status', settings.comfyui), { cache: 'no-store' });
    const status = await readApiJson<{ h3DirectorLongVideo?: boolean; version?: string }>(response, '检查长视频支持失败');
    if (!status.h3DirectorLongVideo) throw new Error('当前 Companion/服务端尚不支持 H3 Director 连续长视频，请先更新；不会退回生成 15 秒短片');
    if (!companionVersionAtLeast(String(status.version || ''), H3_DIRECTOR_COMPANION_MIN_VERSION)) {
      throw new Error(`H3 Director 长视频采样已修正，请先更新 Companion 至 v${H3_DIRECTOR_COMPANION_MIN_VERSION.join('.')} 或更高版本；不会使用旧工作流提交`);
    }
  };

  const prepareDirectorPlan = async () => {
    await assertDirectorSupport();
    const response = await fetch(comfyUIApiUrl('/api/prepare-long-video', settings.comfyui), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullVideoPrompt, duration, apiKey: settings.apiKey, dmxApiKey: settings.dmxApiKey, scriptProvider: settings.scriptProvider, scriptModel: settings.scriptModel }),
    });
    const { plan } = await readApiJson<{ plan: DirectorPlan }>(response, '长视频分段整理失败');
    const valid = validateDirectorPlan(plan, duration, fullVideoPrompt);
    setDirectorPlan(valid);
    return valid;
  };

  const handleGenerate = async () => {
    if (isGenerating || isPlanning) return;
    if (activeTask?.state === 'pending') {
      alert('已有任务编号，请先继续查询。若要另起任务，请明确清除记录；清除记录不会取消后台任务。');
      return;
    }
    if (!mainImage || !prompt) {
      alert('Please upload main image and enter motion description');
      return;
    }

    if (videoProvider === 'apimart' && !settings.apiKey) {
      alert('Please configure API Key in settings');
      return;
    }
    if (isFal && !settings.fal?.apiKey) {
      alert('请先在设置中配置 fal API Key');
      return;
    }
    if (isComfyUI && comfyWorkflowMode === 'first_last' && !secondImage) {
      alert('首尾帧工作流需要上传尾帧');
      return;
    }
    if (isComfyUI && comfyWorkflowMode === 'multi_reference' && referenceImages.length < 1) {
      alert('多图参考工作流至少需要 2 张参考图');
      return;
    }
    if (isComfyUI && audioFiles.length + audioUrls.length > 3) {
      alert('ComfyUI MiniMax H3 最多使用 3 条参考音频');
      return;
    }
    if (isDirector && hasDirectorExtraMedia) {
      alert('连续长视频当前使用一张起始图与原生声音。请先清除额外参考素材，或切回短视频模式。');
      return;
    }

    setIsGenerating(true);
    try {
      const fullPrompt = fullVideoPrompt;
      let plan: DirectorPlan | undefined;
      if (isDirector) {
        setTaskMessage('正在按原提示词整理连续分段…');
        if (currentDirectorPlan) { await assertDirectorSupport(); plan = currentDirectorPlan; }
        else plan = await prepareDirectorPlan();
      }
      setTaskMessage('正在上传素材并提交视频任务…');

      const generationUrl = videoProvider === 'comfyui'
        ? comfyUIApiUrl('/api/image-to-video', settings.comfyui)
        : '/api/image-to-video';
      const response = await fetch(generationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainImage,
          referenceImages: isComfyUI && comfyWorkflowMode === 'multi_reference'
            ? referenceImages
            : secondImage ? [secondImage] : [],
          secondImageRole: isComfyUI && comfyWorkflowMode === 'multi_reference'
            ? 'reference'
            : secondImage ? secondImageMode : undefined,
          comfyWorkflowMode: isComfyUI ? comfyWorkflowMode : undefined,
          directorPlan: plan,
          prompt: fullPrompt,
          aspectRatio,
          duration,
          quality: isGrokImagine || isFal ? quality : undefined,
          apiKey: settings.apiKey,
          dmxApiKey: settings.dmxApiKey,
          scriptProvider: settings.scriptProvider,
          scriptModel: settings.scriptModel,
          videoModel: settings.videoModel,
          videoFiles,
          audioFiles,
          videoUrls,
          audioUrls,
          videoProvider,
          fal: isFal ? {
            ...settings.fal,
            resolution: quality === '480p' ? '480P' : '768P',
          } : settings.fal,
          comfyui: localComfyUISettings(settings.comfyui),
        })
      });

      if (!response.ok) {
        let errorMessage = 'Generation failed';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error (${response.status})`;
        }
        throw new Error(errorMessage);
      }

      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error('Server returned invalid response. Please check Netlify logs.');
      }

      if (!data.taskId) throw new Error('提交结果缺少任务编号，请检查后台队列后再操作，避免重复生成');
      const task: SavedVideoTask = { taskId: data.taskId, backend: taskBackend, state: 'pending', totalSegments: data.totalSegments };
      saveTask(task);
      void pollTaskStatus(task);
    } catch (error) {
      alert(`Video generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsGenerating(false);
    }
  };

  const toolbar = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex items-center gap-2 md:gap-4">
        <Link href="/">
          <img src="/logo.png" alt="AI Video Studio" className="h-6 md:h-8 cursor-pointer" />
        </Link>
        <span className="hidden h-5 w-px bg-[var(--border-color)] md:inline" />
        <div className="min-w-0">
          <span className="block truncate text-xs font-medium text-[var(--text-primary)]">图生视频</span>
          <span className="hidden font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)] sm:block">Image to Video</span>
        </div>
      </div>
      <div className="flex items-center gap-1 md:gap-2">
        <button
          onClick={() => setShowSettings(true)}
          className="flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 text-xs hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] md:gap-2 md:px-3"
        >
          <Settings size={14} />
          <span className="hidden md:inline">设置</span>
        </button>
        <Link href="/">
          <button className="flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 text-xs hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] md:gap-2 md:px-3">
            <Home size={14} />
            <span className="hidden md:inline">首页</span>
          </button>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="aid-theme-pink contents">
      <DevToolsLayout toolbar={toolbar}>
        <div className="mx-auto flex min-h-full max-w-[1500px] flex-col xl:flex-row">
          {/* Left: Input Controls */}
          <div className="min-w-0 flex-1 border-[var(--border-color)] p-4 md:p-7 xl:border-r">
            <div className="aid-page-lead mb-6">
              <div>
                <p className="aid-eyebrow">Video creation console</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">把参考素材变成完整镜头</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">依次选择工作流、上传素材、设定画面与声音。右侧会持续显示生成状态和最终视频。</p>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] font-mono text-[var(--text-secondary)]">
                <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5">{isComfyUI ? 'COMFYUI · H3' : isFal ? 'FAL · H3 MAX' : 'APIMART'}</span>
                <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5">{duration}s · {aspectRatio}</span>
              </div>
            </div>
            <fieldset disabled={isGenerating || isPlanning} className="aid-form-stack min-w-0 space-y-4 md:space-y-5">
              {isComfyUI && (
                <div className="space-y-4 !border-[var(--accent-green)]/35">
                  <div className="flex items-start gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]"><Layers3 size={17} /></div>
                    <div><p className="aid-step-kicker">01 · 选择生成方式</p>
                    <h2 className="mt-1 text-base font-semibold text-white">MiniMax H3 工作流</h2>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {isDirector ? 'Director 连续长视频 · 480P 级 · 分段续接并输出一条完整视频' : '仙宫云 4-step LoRA · 约 720P · 原生生成同步对白、环境声和音乐'}
                    </p></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {[
                      { value: 'single_reference' as const, label: '单图参考', detail: 'Ref2VA · 1 张参考图' },
                      { value: 'multi_reference' as const, label: '多图参考', detail: 'Ref2VA · 2–5 张参考图' },
                      { value: 'first_last' as const, label: '首尾帧', detail: 'FL2VA · 精确首帧和尾帧' },
                      { value: 'director_continuous' as const, label: '连续长视频 · 实验', detail: 'H3 Director · 约 30 / 60 秒' },
                    ].map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setComfyWorkflowMode(option.value);
                          setSecondImage(null);
                          setReferenceImages([]);
                        }}
                        className={`min-h-[76px] rounded-xl border p-3 text-left ${
                          comfyWorkflowMode === option.value
                            ? 'border-[var(--accent-green)] bg-[var(--accent-green)]/10 shadow-[inset_0_0_0_1px_rgba(88,210,189,.08)]'
                            : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <span className="block text-xs font-mono text-[var(--text-primary)]">{option.label}</span>
                        <span className="block mt-1 text-[10px] font-mono text-[var(--text-secondary)]">{option.detail}</span>
                      </button>
                    ))}
                  </div>
                  {isDirector && (
                    <div className="text-xs leading-6 text-[var(--text-secondary)]">
                      一张图作为开场，后段承接上一段动作与声音。先按原稿分配动作和台词，不重复开场，不增加成片质检。实际时长随 H3 帧对齐略有浮动；暂不启用高清二采。
                      {hasDirectorExtraMedia && <div className="mt-2 text-amber-300">
                        当前还有额外参考素材，长视频暂不接受外部音轨、多图或尾帧。
                        <button type="button" className="ml-2 underline" onClick={() => { setSecondImage(null); setReferenceImages([]); setAudioFiles([]); setAudioDurations([]); setAudioUrls([]); setVideoFiles([]); setVideoUrls([]); }}>清除额外参考素材</button>
                      </div>}
                    </div>
                  )}
                </div>
              )}

              {/* First Frame and Second Image (Last Frame / Reference) */}
              <div className={`grid grid-cols-1 ${secondImageMode !== 'none' ? 'md:grid-cols-2' : ''} gap-4`}>
                {/* First Frame */}
                <div>
                  <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">
                    {isComfyUI && comfyWorkflowMode !== 'first_last' && !isDirector ? 'Reference Image 1' : 'First Frame'}
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)] mb-2">Image size &lt; 6MB</p>
                  <div className="border-2 border-dashed border-[var(--border-color)] rounded-lg p-6 text-center bg-[var(--bg-secondary)]">
                    {mainImage ? (
                      <img src={mainImage} alt="First Frame" className="max-h-48 mx-auto rounded" />
                    ) : (
                      <div>
                        <Upload className="w-10 h-10 mx-auto mb-3 text-[var(--text-secondary)]" />
                        <p className="text-[var(--text-secondary)] text-sm mb-3">
                          {isComfyUI && comfyWorkflowMode !== 'first_last' && !isDirector ? 'Upload reference image' : 'Upload first frame'}
                        </p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleMainImageUpload}
                      className="hidden"
                      id="main-image-upload"
                    />
                    <label
                      htmlFor="main-image-upload"
                      className="inline-block px-4 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      {mainImage ? 'Change' : 'Select'}
                    </label>
                  </div>
                </div>

                {/* Second Image: Last Frame or Reference Image, depending on model support */}
                {secondImageMode !== 'none' && (
                <div>
                  <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">
                    {secondImageMode === 'last_frame'
                      ? isComfyUI ? 'Last Frame (Required)' : 'Last Frame (Optional)'
                      : isComfyUI ? 'Reference Image 2 (Required)' : 'Reference Image (Optional)'}
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)] mb-2">
                    {secondImageMode === 'last_frame'
                      ? isComfyUI ? 'H3 FL2VA 会把两张图片作为精确首帧和尾帧。Image size < 6MB' : 'Image size < 6MB'
                      : isComfyUI ? 'H3 Ref2VA 的第二张独立参考图。Image size < 6MB' : 'Used as style/subject reference, not as last frame. Image size < 6MB'}
                  </p>
                  <div className="border-2 border-dashed border-[var(--border-color)] rounded-lg p-6 text-center bg-[var(--bg-secondary)]">
                    {secondImage ? (
                      <img src={secondImage} alt={secondImageMode === 'last_frame' ? 'Last Frame' : 'Reference Image'} className="max-h-48 mx-auto rounded" />
                    ) : (
                      <div>
                        <Upload className="w-10 h-10 mx-auto mb-3 text-[var(--text-secondary)]" />
                        <p className="text-[var(--text-secondary)] text-sm mb-3">
                          {secondImageMode === 'last_frame' ? 'Upload last frame' : 'Upload reference image'}
                        </p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleSecondImageUpload}
                      className="hidden"
                      id="second-image-upload"
                    />
                    <label
                      htmlFor="second-image-upload"
                      className="inline-block px-4 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      {secondImage ? 'Change' : 'Select'}
                    </label>
                  </div>
                </div>
                )}
              </div>

              {isComfyUI && comfyWorkflowMode === 'multi_reference' && (
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-mono text-[var(--text-primary)]">Additional Reference Images</h2>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        再添加 1–4 张；与 Reference Image 1 合计 2–5 张，每张小于 6MB
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-mono text-[var(--accent-green)]">
                      已选择 {(mainImage ? 1 : 0) + referenceImages.length} / {MAX_COMFYUI_REFERENCE_IMAGES}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {referenceImages.map((image, index) => (
                      <div key={`${index}-${image.slice(-16)}`} className="relative aspect-square overflow-hidden rounded border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                        <img src={image} alt={`Reference Image ${index + 2}`} className="h-full w-full object-cover" />
                        <div className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-mono text-white">
                          #{index + 2}
                        </div>
                        <button
                          type="button"
                          onClick={() => setReferenceImages(images => images.filter((_, imageIndex) => imageIndex !== index))}
                          className="absolute right-1.5 top-1.5 rounded bg-black/70 p-1 text-white hover:bg-red-500"
                          title={`移除 Reference Image ${index + 2}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {referenceImages.length < MAX_COMFYUI_REFERENCE_IMAGES - 1 && (
                      <label
                        htmlFor="comfyui-reference-images-upload"
                        className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-secondary)] text-center hover:border-[var(--accent-blue)]"
                      >
                        <Upload className="mb-2 h-7 w-7 text-[var(--text-secondary)]" />
                        <span className="text-xs font-mono text-[var(--text-secondary)]">添加参考图</span>
                        <span className="mt-1 text-[10px] font-mono text-[var(--text-secondary)]">可多选</span>
                      </label>
                    )}
                  </div>
                  <input
                    id="comfyui-reference-images-upload"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleReferenceImagesUpload}
                    className="hidden"
                  />
                </div>
              )}

              {/* Aspect Ratio */}
              <div>
                <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">Aspect Ratio</h2>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: '16:9' as const, label: '16:9 Landscape' },
                    { value: '9:16' as const, label: '9:16 Portrait' },
                    { value: '1:1' as const, label: '1:1 Square (Not for Veo)' }
                  ].map((ratio) => (
                    <button
                      key={ratio.value}
                      onClick={() => setAspectRatio(ratio.value)}
                      className={`p-2 text-xs font-mono rounded border ${
                        aspectRatio === ratio.value
                          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                          : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                      }`}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">Duration</h2>
                <div className="flex items-center gap-3">
                  {durationOptions ? (
                    <select
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="px-3 py-1.5 text-sm font-mono bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                    >
                      {durationOptions.map(d => (
                        <option key={d} value={d}>{isDirector ? '约 ' : ''}{d}s</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        type="range"
                        min={durationMin}
                        max={durationMax}
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        className="flex-1"
                      />
                      <input
                        type="number"
                        min={durationMin}
                        max={durationMax}
                        value={duration}
                        onChange={(e) => setDuration(Math.min(durationMax, Math.max(durationMin, Number(e.target.value))))}
                        className="w-16 px-2 py-1 text-sm font-mono bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                      />
                    </>
                  )}
                  <span className="text-sm font-mono text-[var(--text-secondary)]">seconds</span>
                </div>
              </div>

              {/* Quality - Grok Imagine / fal H3 Max */}
              {(isGrokImagine || isFal) && (
                <div>
                  <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">Quality</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: '480p' as const, label: '480p (Default)' },
                      { value: '720p' as const, label: isFal ? '768P · 推荐' : '720p' }
                    ].map((q) => (
                      <button
                        key={q.value}
                        onClick={() => setQuality(q.value)}
                        className={`p-2 text-xs font-mono rounded border ${
                          quality === q.value
                            ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                            : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                        }`}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Motion Description */}
              <div>
                <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">
                  {isComfyUI || isFal ? 'Video & Sound Prompt' : 'Motion Description'}
                </h2>
                <textarea
                  ref={promptTextareaRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={isComfyUI || isFal
                    ? '描述画面动作、镜头、角色对白、环境声和音乐。H3 会原生生成同步音视频。'
                    : 'Describe the motion effect you want, e.g., camera slowly pushes in, person smiles and turns head...'}
                  className="w-full min-h-48 max-h-[32rem] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-3 text-sm leading-6 text-[var(--text-primary)] resize-y focus:outline-none focus:border-[var(--accent-blue)] font-mono"
                />
                {(isComfyUI || isFal) && (
                  <p className="mt-2 text-xs font-mono text-[var(--text-secondary)]">
                    建议同时写清：谁说什么、声音出现时间、环境声和是否需要背景音乐。
                  </p>
                )}
              </div>

              {isDirector && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm text-[var(--text-primary)]">连续分段 · {duration / 10} 段</h2>
                    <button type="button" disabled={!prompt.trim() || isPlanning || isGenerating} className="rounded border border-[var(--border-color)] px-3 py-2 text-xs disabled:opacity-40"
                      onClick={async () => {
                        setIsPlanning(true);
                        try { await prepareDirectorPlan(); }
                        catch (error) { alert(error instanceof Error ? error.message : '分段整理失败'); }
                        finally { setIsPlanning(false); }
                      }}>{isPlanning ? '整理中…' : '按原稿整理分段'}</button>
                  </div>
                  <p className="text-xs leading-5 text-[var(--text-secondary)]">可先整理并调整每段动作；直接开始生成也会自动整理。每段内时间从 00:00 开始，每句台词只分配一次。修改原提示词、运镜或时长后需重新整理。</p>
                  {currentDirectorPlan?.segments.map((segment, i) => (
                    <label key={i} className="block text-xs text-[var(--text-secondary)]">
                      第 {i + 1} 段 · 约 {i * 10}–{(i + 1) * 10} 秒{ i ? ' · 承接前段' : ' · 从原图开始'}
                      <textarea value={segment.prompt} maxLength={6000} rows={4} className="mt-2 w-full rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-sm text-[var(--text-primary)]"
                        onChange={event => setDirectorPlan(previous => previous ? { ...previous, segments: previous.segments.map((s, index) => index === i ? { prompt: event.target.value } : s) } : previous)} />
                    </label>
                  ))}
                </div>
              )}

              {/* Camera Parameters */}
              <CameraSelector onParamsChange={setCameraParams} />

              {/* MiniMax-H3 native audio / optional voice references */}
              {supportsH3VoiceReference && !isDirector && (
                <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
                  <h2 className="text-sm font-mono text-[var(--accent-green)]">
                    {isComfyUI ? 'Native Audio Generation' : 'MiniMax-H3 Audio Sync'}
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {isComfyUI
                      ? '不需要上传成品音轨。MiniMax H3 会根据提示词原生生成同步声音；如需保持角色音色，可选上传最多 3 条声音参考。'
                      : 'Upload reference audio (WAV/MP3, 2–15s each, max 3 clips, total ≤15s). When provided, the model generates video in R2V mode and clones the voice/tone from the reference audio.'}
                  </p>
                  <div>
                    <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
                      {isComfyUI ? 'Voice / Sound References (Optional, Max 3)' : 'Reference Audio (Max 3, Total ≤15s)'}
                    </label>
                    <input
                      type="file"
                      accept="audio/*"
                      multiple
                      onChange={handleAudioUpload}
                      className="hidden"
                      id="minimax-audio-upload"
                    />
                    <label
                      htmlFor="minimax-audio-upload"
                      className="inline-block px-3 py-1.5 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      Upload Audio ({audioFiles.length})
                    </label>
                    {audioFiles.length > 0 && (
                      <button
                        onClick={() => {
                          setAudioFiles([]);
                          setAudioDurations([]);
                        }}
                        className="ml-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isFal && (
                <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                  <h2 className="text-sm font-mono text-[var(--accent-green)]">H3 Max Native Audio</h2>
                  <p className="text-xs leading-5 text-[var(--text-secondary)]">fal H3 Max 会直接按提示词生成对白、环境声和拟音。此 endpoint 不接受参考音频；固定 Seed 和一致的声音画像只能降低随机漂移，不能替代 Fish Voice ID。</p>
                </div>
              )}

              {/* Seedance 2.0 Enhanced Features */}
              {!isComfyUI && settings.videoModel?.includes('seedance-2') && (
                <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
                  <h2 className="text-sm font-mono text-[var(--accent-green)]">Seedance 2.0 Enhanced Features</h2>

                  <div>
                    <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
                      Reference Videos (Max 3, Total ≤15s)
                    </label>
                    <input
                      type="file"
                      accept="video/*"
                      multiple
                      onChange={handleVideoUpload}
                      className="hidden"
                      id="video-upload"
                    />
                    <label
                      htmlFor="video-upload"
                      className="inline-block px-3 py-1.5 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      Upload Videos ({videoFiles.length})
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
                      Reference Audio (Max 3, Total ≤15s)
                    </label>
                    <input
                      type="file"
                      accept="audio/*"
                      multiple
                      onChange={handleAudioUpload}
                      className="hidden"
                      id="audio-upload"
                    />
                    <label
                      htmlFor="audio-upload"
                      className="inline-block px-3 py-1.5 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      Upload Audio ({audioFiles.length})
                    </label>
                  </div>
                </div>
              )}

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || isPlanning || activeTask?.state === 'pending' || !mainImage || !prompt || (isComfyUI && comfyWorkflowMode === 'first_last' && !secondImage) || (isComfyUI && comfyWorkflowMode === 'multi_reference' && referenceImages.length < 1) || (isDirector && hasDirectorExtraMedia)}
                className="w-full py-3 bg-[var(--accent-blue)] hover:bg-[#006bb3] disabled:opacity-50 disabled:cursor-not-allowed rounded font-mono text-sm text-white flex items-center justify-center gap-2"
              >
                <Video className="w-4 h-4" />
                {isGenerating ? '正在生成视频…' : isDirector ? `开始连续生成约 ${duration} 秒` : '开始生成视频'}
              </button>
            </fieldset>
          </div>

          {/* Right: Video Preview */}
          <aside className="w-full border-t border-[var(--border-color)] bg-[var(--bg-primary)] p-4 md:p-6 xl:w-[420px] xl:shrink-0 xl:border-t-0">
            <div className="xl:sticky xl:top-6">
            <div className="mb-3 flex items-center justify-between">
              <div><p className="aid-eyebrow">Output</p><h2 className="mt-1 text-sm font-medium text-white">视频预览</h2></div>
              <button
                onClick={() => setIsPreviewOpen(!isPreviewOpen)}
                className="grid h-9 w-9 place-items-center rounded-lg hover:bg-[var(--bg-hover)] xl:hidden"
              >
                {isPreviewOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
            <div className={`${isPreviewOpen ? 'block' : 'hidden'} xl:block`}>
            {(taskMessage || activeTask) && (
              <div className="aid-panel mb-4 space-y-3 p-4 text-xs leading-6" aria-live="polite">
                <p>{taskMessage}</p>
                {activeTask && <>
                  <p className="break-all font-mono text-[var(--text-secondary)]">任务：{activeTask.taskId}</p>
                  <div className="flex flex-wrap gap-3">
                    <button disabled={isGenerating || isPlanning} className="underline disabled:opacity-40" onClick={() => void pollTaskStatus(activeTask)}>{activeTask.state === 'completed' ? '重新取回视频' : '继续查询（不重新生成）'}</button>
                    <button disabled={isGenerating || isPlanning} className="underline disabled:opacity-40" onClick={() => {
                      if (!confirm('清除本页任务记录不会取消后台任务。确定清除吗？')) return;
                      setActiveTask(null); setTaskMessage('');
                      try { localStorage.removeItem(I2V_TASK_STORAGE); } catch { /* Current in-memory record is cleared. */ }
                    }}>清除记录</button>
                  </div>
                </>}
              </div>
            )}
            <div className={`aid-panel mb-4 flex items-center justify-center overflow-hidden bg-black/25 ${
              aspectRatio === '16:9' ? 'aspect-video' :
              aspectRatio === '9:16' ? 'aspect-[9/16]' :
              'aspect-square'
            }`} style={{ maxHeight: aspectRatio === '9:16' ? '600px' : '400px' }}>
              {videoUrl ? (
                <video src={videoUrl} controls className="w-full h-full rounded-lg" />
              ) : (
                <div className="text-center text-[var(--text-secondary)]">
                  <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)]"><Video className="h-5 w-5 opacity-70" /></div>
                  <p className="text-sm text-[var(--text-primary)]">{isGenerating ? '正在生成' : '等待生成'}</p>
                  <p className="mt-1 text-xs">完成后可预览、编辑和下载</p>
                </div>
              )}
            </div>

            <div className="aid-panel mb-4 divide-y divide-[var(--border-color)] px-4">
              <div className="flex items-center justify-between py-3 text-xs"><span className="flex items-center gap-2 text-[var(--text-secondary)]"><Layers3 size={14} />引擎</span><span className="font-mono text-white">{isDirector ? 'H3 Director 连续长视频' : isComfyUI ? 'MiniMax H3' : isFal ? 'MiniMax H3 Max · fal' : settings.videoModel}</span></div>
              <div className="flex items-center justify-between py-3 text-xs"><span className="flex items-center gap-2 text-[var(--text-secondary)]"><Clock3 size={14} />输出规格</span><span className="font-mono text-white">{duration}s · {aspectRatio}{isFal ? ` · ${quality === '480p' ? '480P' : '768P'}` : ''}</span></div>
              <div className="flex items-center justify-between py-3 text-xs"><span className="flex items-center gap-2 text-[var(--text-secondary)]"><Volume2 size={14} />声音</span><span className="font-mono text-white">{isMiniMaxH3 ? '原生音频' : audioFiles.length ? `${audioFiles.length} 条参考` : '按模型设置'}</span></div>
            </div>

            {/* Action Buttons */}
            {videoUrl && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    const videos = JSON.stringify([videoUrl]);
                    router.push(`/editor?videos=${encodeURIComponent(videos)}`);
                  }}
                  className="w-full py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#059669] text-white rounded flex items-center justify-center gap-2"
                >
                  <Edit size={14} />
                  进入视频编辑器
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(videoUrl);
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `video-${Date.now()}.mp4`;
                        a.click();
                        window.URL.revokeObjectURL(url);
                      } catch (error) {
                        console.error('Download failed:', error);
                        alert('Download failed');
                      }
                    }}
                    className="flex-1 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded"
                  >
                    下载视频
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="flex-1 py-2 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded disabled:opacity-50"
                  >
                    重新生成
                  </button>
                </div>
              </div>
            )}
            </div>
            </div>
          </aside>
        </div>
      </DevToolsLayout>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />
    </div>
  );
}
