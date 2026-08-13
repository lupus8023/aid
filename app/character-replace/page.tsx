'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileVideo2,
  Home,
  ImagePlus,
  Loader2,
  Play,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  X,
} from 'lucide-react';
import DevToolsLayout from '@/components/DevToolsLayout';
import SettingsModal from '@/components/SettingsModal';
import { useSettings } from '@/hooks/useSettings';
import {
  comfyUIApiUrl,
  downloadComfyUIVideo,
  localComfyUISettings,
  videoStatusResponseError,
} from '@/lib/comfyuiClient';

const MAX_VIDEO_SIZE = 500 * 1024 * 1024;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const FRAME_OPTIONS = ['full', '17', '33', '49', '65', '81'] as const;

type TaskState = 'idle' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';
type ProductMode = 'preserve' | 'replace' | 'none';

interface MediaValue {
  file: File;
  previewUrl: string;
}

interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

interface TaskProgress {
  progress: number;
  currentSegment: number;
  completedSegments: number;
  totalSegments: number;
  productMode?: ProductMode;
  stage: string;
}

interface RunParameters {
  width: number;
  height: number;
  frameCount: number;
  sourceFrames: number;
  fps: number;
  duration: number;
  totalSegments: number;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default function CharacterReplacePage() {
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [drivingVideo, setDrivingVideo] = useState<MediaValue | null>(null);
  const [referenceImage, setReferenceImage] = useState<MediaValue | null>(null);
  const [productReferenceImage, setProductReferenceImage] = useState<MediaValue | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [prompt, setPrompt] = useState(
    '将驱动视频中的人物替换为参考图人物。完整保留原视频的动作、镜头运动、构图、光线和背景；人物面部、发型和服装在所有帧中保持一致，写实自然。',
  );
  const [videoSubject, setVideoSubject] = useState('person');
  const [referenceSubject, setReferenceSubject] = useState('person');
  const [productMode, setProductMode] = useState<ProductMode>('replace');
  const [productSubject, setProductSubject] = useState('product package');
  const [productReferenceSubject, setProductReferenceSubject] = useState('product package');
  const [frameCount, setFrameCount] = useState<(typeof FRAME_OPTIONS)[number]>('full');
  const [seed, setSeed] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [taskState, setTaskState] = useState<TaskState>('idle');
  const [taskId, setTaskId] = useState('');
  const [error, setError] = useState('');
  const [outputUrl, setOutputUrl] = useState('');
  const [parameters, setParameters] = useState<RunParameters | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => {
    if (drivingVideo?.previewUrl) URL.revokeObjectURL(drivingVideo.previewUrl);
  }, [drivingVideo?.previewUrl]);

  useEffect(() => () => {
    if (referenceImage?.previewUrl) URL.revokeObjectURL(referenceImage.previewUrl);
  }, [referenceImage?.previewUrl]);

  useEffect(() => () => {
    if (productReferenceImage?.previewUrl) URL.revokeObjectURL(productReferenceImage.previewUrl);
  }, [productReferenceImage?.previewUrl]);

  useEffect(() => () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }, [outputUrl]);

  useEffect(() => () => {
    cancelledRef.current = true;
  }, []);

  const replaceMedia = async (
    file: File,
    kind: 'video' | 'image',
    setter: (value: MediaValue | null) => void,
    previous: MediaValue | null,
  ) => {
    const limit = kind === 'video' ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > limit) throw new Error(`${file.name} 超过 ${kind === 'video' ? '500MB' : '8MB'} 限制`);
    if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
    setter({ file, previewUrl: URL.createObjectURL(file) });
  };

  const handleVideo = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      await replaceMedia(file, 'video', setDrivingVideo, drivingVideo);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '驱动视频读取失败');
    }
  };

  const handleImage = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      await replaceMedia(file, 'image', setReferenceImage, referenceImage);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '人物参考图读取失败');
    }
  };

  const handleProductImage = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      await replaceMedia(file, 'image', setProductReferenceImage, productReferenceImage);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '产品参考图读取失败');
    }
  };

  const pollStatus = async (id: string) => {
    setTaskState('processing');
    let consecutiveErrors = 0;
    for (let attempt = 0; attempt < 720 && !cancelledRef.current; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        const response = await fetch(comfyUIApiUrl('/api/check-video-status', settings.comfyui), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: id,
            localDelivery: true,
            comfyui: localComfyUISettings(settings.comfyui),
          }),
        });
        if (!response.ok) throw new Error(await videoStatusResponseError(response));
        const data = await response.json();
        if (data.totalSegments) {
          setTaskProgress({
            progress: Number(data.progress || 0),
            currentSegment: Number(data.currentSegment || 0),
            completedSegments: Number(data.completedSegments || 0),
            totalSegments: Number(data.totalSegments || 0),
            stage: String(data.stage || 'segment'),
          });
        }
        if (data.status === 'failed') throw new Error(data.error || 'ComfyUI 执行失败');
        if (data.status === 'completed' && data.readyForDownload) {
          const url = await downloadComfyUIVideo(id, settings.comfyui);
          if (outputUrl) URL.revokeObjectURL(outputUrl);
          setOutputUrl(url);
          setTaskState('completed');
          return;
        }
        consecutiveErrors = 0;
      } catch (pollError) {
        consecutiveErrors += 1;
        if (consecutiveErrors < 3) continue;
        setError(pollError instanceof Error ? pollError.message : '任务状态读取失败');
        setTaskState('failed');
        return;
      }
    }
    if (!cancelledRef.current) {
      setError('任务等待超时，请稍后通过任务 ID 继续检查');
      setTaskState('failed');
    }
  };

  const submit = async () => {
    if (!drivingVideo || !referenceImage || !prompt.trim()) {
      setError('请先上传驱动视频、替换人物图，并填写替换描述');
      return;
    }
    if (productMode !== 'none' && !productSubject.trim()) {
      setError('请填写原视频产品检测词，例如 mask package、bottle 或 handbag');
      return;
    }
    if (productMode === 'replace' && !productReferenceImage) {
      setError('同时替换产品时，请上传单独的产品参考图');
      return;
    }
    setError('');
    setOutputUrl(previous => {
      if (previous) URL.revokeObjectURL(previous);
      return '';
    });
    setParameters(null);
    setTaskProgress(null);
    setTaskState('uploading');
    cancelledRef.current = false;
    try {
      const form = new FormData();
      form.append('drivingVideo', drivingVideo.file, drivingVideo.file.name);
      form.append('referenceImage', referenceImage.file, referenceImage.file.name);
      if (productReferenceImage) form.append('productReferenceImage', productReferenceImage.file, productReferenceImage.file.name);
      form.append('prompt', prompt);
      form.append('videoSubject', videoSubject);
      form.append('referenceSubject', referenceSubject);
      form.append('productMode', productMode);
      form.append('productSubject', productSubject);
      form.append('productReferenceSubject', productReferenceSubject);
      form.append('frameCount', frameCount);
      form.append('seed', seed);
      form.append('comfyui', JSON.stringify(localComfyUISettings(settings.comfyui)));
      const response = await fetch(comfyUIApiUrl('/api/comfyui/character-replace', settings.comfyui), {
        method: 'POST',
        body: form,
      });
      if (!response.ok) throw new Error(await videoStatusResponseError(response));
      const data = await response.json();
      setTaskId(data.taskId);
      setParameters(data.parameters);
      setTaskState('queued');
      await pollStatus(data.taskId);
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message === 'Failed to fetch'
          ? '无法连接本机 AID Companion，请在 /Users/yao/Desktop/aid 运行 npm run companion'
          : submitError instanceof Error ? submitError.message : '换人物任务提交失败',
      );
      setTaskState('failed');
    }
  };

  const downloadOutput = () => {
    if (!outputUrl) return;
    const anchor = document.createElement('a');
    anchor.href = outputUrl;
    anchor.download = `aid-character-replace-${taskId.replace(/^comfyui(?:-long)?:/, '') || Date.now()}.mp4`;
    anchor.click();
  };

  const isBusy = ['uploading', 'queued', 'processing'].includes(taskState);
  const stateLabel: Record<TaskState, string> = {
    idle: '等待素材',
    uploading: '正在上传到仙宫云',
    queued: '已进入 ComfyUI 队列',
    processing: 'SAM3 / SCAIL2 处理中',
    completed: '生成完成',
    failed: '任务失败',
  };

  const toolbar = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex items-center gap-2 md:gap-4">
        <Link href="/"><img src="/logo.png" alt="AID" className="h-6 cursor-pointer md:h-8" /></Link>
        <span className="hidden h-5 w-px bg-[var(--border-color)] md:inline" />
        <div className="min-w-0">
          <span className="block truncate text-xs font-medium text-white">视频换人物</span>
          <span className="hidden font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)] sm:block">SCAIL2 Character Replace</span>
        </div>
      </div>
      <div className="flex items-center gap-1 md:gap-2">
        <button onClick={() => setShowSettings(true)} className="flex min-h-9 items-center gap-2 border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs hover:border-[var(--workspace-accent)]/50">
          <Settings size={14} /><span className="hidden md:inline">连接设置</span>
        </button>
        <Link href="/" className="flex min-h-9 items-center gap-2 border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs hover:border-[var(--workspace-accent)]/50">
          <Home size={14} /><span className="hidden md:inline">首页</span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="aid-theme-blue contents">
      <DevToolsLayout toolbar={toolbar}>
        <div className="mx-auto grid min-h-full max-w-[1500px] xl:grid-cols-[minmax(0,1fr)_460px]">
          <section className="min-w-0 p-4 md:p-7 xl:border-r xl:border-[var(--border-color)]">
            <div className="aid-page-lead mb-6">
              <div>
                <p className="aid-eyebrow">Character replacement console</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">保留原视频表演，替换画面人物</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">驱动视频决定动作、镜头和背景；单人物参考图决定新角色的身份与外观。</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 border border-[var(--workspace-accent)]/30 bg-[var(--workspace-accent)]/10 px-3 py-2 font-mono text-[10px] text-[var(--workspace-accent)]">
                <ShieldCheck size={14} /> COMFYUI · SCAIL2 INT8
              </div>
            </div>

            <div className="aid-form-stack space-y-4">
              <section>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div><p className="aid-step-kicker">01 · 必填素材</p><h2 className="mt-1 text-base font-semibold text-white">驱动视频与替换人物</h2></div>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">2 FILES</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)]">
                    <div className="flex min-h-[230px] items-center justify-center bg-black/30">
                      {drivingVideo ? (
                        <video
                          src={drivingVideo.previewUrl}
                          controls
                          muted
                          className="max-h-[300px] w-full object-contain"
                          onLoadedMetadata={event => setVideoMeta({
                            width: event.currentTarget.videoWidth,
                            height: event.currentTarget.videoHeight,
                            duration: event.currentTarget.duration,
                          })}
                        />
                      ) : (
                        <div className="px-6 text-center"><FileVideo2 className="mx-auto h-9 w-9 text-[var(--workspace-accent)]" /><p className="mt-3 text-sm text-white">动作参考视频</p><p className="mt-1 text-xs text-[var(--text-muted)]">MP4 / MOV / WebM · 最多 500MB</p></div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-[var(--border-color)] p-3">
                      <div className="min-w-0"><p className="truncate text-xs text-[var(--text-secondary)]">{drivingVideo?.file.name || '尚未选择'}</p>{drivingVideo && <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">{formatBytes(drivingVideo.file.size)}{videoMeta ? ` · ${videoMeta.width}×${videoMeta.height} · ${videoMeta.duration.toFixed(1)}s` : ''}</p>}</div>
                      <label htmlFor="scail-video" className="shrink-0 cursor-pointer bg-[var(--workspace-accent)] px-3 py-2 text-xs font-medium text-[var(--workspace-on-accent)]">{drivingVideo ? '更换' : '选择视频'}</label>
                      <input id="scail-video" type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={event => { handleVideo(event.target.files?.[0]); event.target.value = ''; }} />
                    </div>
                  </div>

                  <div className="overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)]">
                    <div className="flex min-h-[230px] items-center justify-center bg-black/30">
                      {referenceImage ? <img src={referenceImage.previewUrl} alt="替换人物参考" className="max-h-[300px] w-full object-contain" /> : <div className="px-6 text-center"><ImagePlus className="mx-auto h-9 w-9 text-[var(--workspace-accent)]" /><p className="mt-3 text-sm text-white">单人物参考图</p><p className="mt-1 text-xs text-[var(--text-muted)]">JPG / PNG / WebP · 最多 8MB</p></div>}
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-[var(--border-color)] p-3">
                      <div className="min-w-0"><p className="truncate text-xs text-[var(--text-secondary)]">{referenceImage?.file.name || '尚未选择'}</p>{referenceImage && <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">{formatBytes(referenceImage.file.size)} · 建议单人半身或全身</p>}</div>
                      <label htmlFor="scail-image" className="shrink-0 cursor-pointer bg-[var(--workspace-accent)] px-3 py-2 text-xs font-medium text-[var(--workspace-on-accent)]">{referenceImage ? '更换' : '选择图片'}</label>
                      <input id="scail-image" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { handleImage(event.target.files?.[0]); event.target.value = ''; }} />
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-[var(--text-secondary)] md:grid-cols-3">
                  <p className="border-l-2 border-[var(--workspace-accent)]/55 pl-3">源视频只放一个主要人物，遮挡越少越稳定。</p>
                  <p className="border-l-2 border-[var(--workspace-accent)]/55 pl-3">参考图避免拼图、多人、过度裁切和大面积遮脸。</p>
                  <p className="border-l-2 border-[var(--workspace-accent)]/55 pl-3">原视频音轨、帧率和镜头环境会保留到输出。</p>
                </div>
              </section>

              <section>
                <p className="aid-step-kicker">02 · 替换描述</p>
                <div className="mt-3">
                  <label className="aid-field-label" htmlFor="scail-prompt">最终人物与画面要求</label>
                  <textarea id="scail-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} rows={5} className="w-full resize-y border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm leading-6 text-white focus:border-[var(--workspace-accent)]" placeholder="描述替换后人物、服装，以及需要保留的镜头、背景和光线。" />
                  <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">这不是 SAM3 检测词。这里描述最终视频；人物身份主要来自右侧参考图。</p>
                </div>
              </section>

              <section>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div><p className="aid-step-kicker">03 · 产品处理</p><h2 className="mt-1 text-base font-semibold text-white">指定产品是保留还是替换</h2></div>
                  <span className="font-mono text-[10px] text-[var(--workspace-accent)]">PRODUCT LOCK</span>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  {([
                    ['replace', '上传产品参考图（推荐）', '人物与产品使用两张独立参考图，边缘自然，不做原视频硬抠图'],
                    ['preserve', '原像素抠图保留（实验）', '直接贴回原视频产品；文字较准，但遮挡时可能出现白边、黑边或矩形底'],
                    ['none', '画面中没有产品', '不增加产品检测与保护步骤，生成速度更快'],
                  ] as const).map(([value, label, description]) => (
                    <button key={value} type="button" onClick={() => setProductMode(value)} className={`border p-3 text-left transition-colors ${productMode === value ? 'border-[var(--workspace-accent)] bg-[var(--workspace-accent)]/10' : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--workspace-accent)]/50'}`}>
                      <span className="block text-sm font-medium text-white">{label}</span>
                      <span className="mt-1.5 block text-[11px] leading-5 text-[var(--text-muted)]">{description}</span>
                    </button>
                  ))}
                </div>
                {productMode !== 'none' && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="aid-field-label" htmlFor="product-subject">原视频产品检测词</label>
                      <input id="product-subject" value={productSubject} onChange={event => setProductSubject(event.target.value)} placeholder="例如 mask package、bottle、handbag" className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm focus:border-[var(--workspace-accent)]" />
                      <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">使用可见类别或外观，不要只填品牌名。这个视频可填写 `yellow facial mask package`。</p>
                    </div>
                    {productMode === 'preserve' && (
                      <div className="border-l-2 border-[var(--error)]/55 bg-[var(--error)]/5 px-4 py-3 text-xs leading-6 text-[var(--text-secondary)]">
                        实验模式会恢复原视频产品像素。反光包装、手指遮挡或产品贴近身体时，可能产生白框、黑边和破损遮罩；此类素材建议改用产品参考图。
                      </div>
                    )}
                  </div>
                )}
                {productMode === 'replace' && (
                  <div className="mt-4 grid gap-4 border-t border-[var(--border-color)] pt-4 md:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)]">
                      <div className="flex aspect-square items-center justify-center bg-black/30">
                        {productReferenceImage ? <img src={productReferenceImage.previewUrl} alt="产品参考" className="h-full w-full object-contain" /> : <div className="px-4 text-center"><ImagePlus className="mx-auto h-8 w-8 text-[var(--workspace-accent)]" /><p className="mt-2 text-xs text-white">上传单独产品图</p><p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">正面、清晰、单产品<br />背景尽量干净</p></div>}
                      </div>
                      <label htmlFor="scail-product-image" className="block cursor-pointer border-t border-[var(--border-color)] bg-[var(--workspace-accent)] px-3 py-2 text-center text-xs font-medium text-[var(--workspace-on-accent)]">{productReferenceImage ? '更换产品图' : '选择产品图'}</label>
                      <input id="scail-product-image" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { handleProductImage(event.target.files?.[0]); event.target.value = ''; }} />
                    </div>
                    <div>
                      <label className="aid-field-label" htmlFor="product-reference-subject">产品参考图检测词</label>
                      <input id="product-reference-subject" value={productReferenceSubject} onChange={event => setProductReferenceSubject(event.target.value)} placeholder="通常与原视频产品检测词相同" className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm focus:border-[var(--workspace-accent)]" />
                      <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">人物图和产品图会作为两张独立参考图输入 SCAIL2。原视频只提供产品的位置、角度和运动，不需要把产品拼进人物图。</p>
                      <div className="mt-3 border-l-2 border-[var(--workspace-accent)]/55 pl-3 text-[11px] leading-5 text-[var(--text-secondary)]">生成边缘比硬抠图自然；若包装文字必须逐字一致，请使用高分辨率正面产品图，并在提示词中写明“保持包装版式、Logo 和文字”。</div>
                    </div>
                  </div>
                )}
              </section>

              <section>
                <button type="button" onClick={() => setAdvancedOpen(value => !value)} className="flex w-full items-center justify-between gap-3 text-left">
                  <div><p className="aid-step-kicker">04 · 处理范围</p><h2 className="mt-1 text-base font-semibold text-white">SCAIL2 参数</h2></div>
                  {advancedOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                </button>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="aid-field-label" htmlFor="scail-frames">处理帧数</label>
                    <select id="scail-frames" value={frameCount} onChange={event => setFrameCount(event.target.value as typeof frameCount)} className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm focus:border-[var(--workspace-accent)]">
                      <option value="full">完整视频 · 自动分段续写</option>
                      {FRAME_OPTIONS.slice(1).map(value => <option key={value} value={value}>{value} 帧</option>)}
                    </select>
                    <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">完整视频按首段 81 帧、后续每段新增 76 帧处理；相邻段用 5 帧连续上下文。</p>
                  </div>
                  <div>
                    <label className="aid-field-label" htmlFor="scail-seed">随机种子（可选）</label>
                    <input id="scail-seed" type="number" min="0" step="1" value={seed} onChange={event => setSeed(event.target.value)} placeholder="留空则自动生成" className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm focus:border-[var(--workspace-accent)]" />
                    <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">复用同一个种子有助于比较提示词变化。</p>
                  </div>
                </div>
                {advancedOpen && (
                  <div className="mt-4 grid gap-4 border-t border-[var(--border-color)] pt-4 md:grid-cols-2">
                    <div><label className="aid-field-label" htmlFor="video-subject">源视频人物检测词</label><input id="video-subject" value={videoSubject} onChange={event => setVideoSubject(event.target.value)} className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm focus:border-[var(--workspace-accent)]" /><p className="mt-2 text-[11px] text-[var(--text-muted)]">SAM3 开放词汇检测；单人视频建议 `person`。</p></div>
                    <div><label className="aid-field-label" htmlFor="reference-subject">参考图人物检测词</label><input id="reference-subject" value={referenceSubject} onChange={event => setReferenceSubject(event.target.value)} className="w-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm focus:border-[var(--workspace-accent)]" /><p className="mt-2 text-[11px] text-[var(--text-muted)]">参考图同样建议 `person`；不要填人物姓名。</p></div>
                  </div>
                )}
              </section>
            </div>

            {error && <div className="mt-4 flex items-start gap-3 border border-[var(--error)]/40 bg-[var(--error)]/10 p-4 text-sm text-[var(--error)]"><AlertCircle className="mt-0.5 shrink-0" size={16} /><div className="min-w-0"><p className="font-medium">{error}</p>{taskId && <p className="mt-1 break-all font-mono text-[10px] opacity-80">{taskId}</p>}</div><button onClick={() => setError('')} className="ml-auto shrink-0"><X size={15} /></button></div>}

            <button type="button" disabled={isBusy || !drivingVideo || !referenceImage || !prompt.trim()} onClick={submit} className="mt-5 flex min-h-14 w-full items-center justify-center gap-3 bg-[var(--workspace-accent)] px-5 text-sm font-semibold text-[var(--workspace-on-accent)] hover:bg-[var(--workspace-accent-strong)] active:translate-y-px disabled:cursor-not-allowed">
              {isBusy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}{isBusy ? stateLabel[taskState] : '开始替换人物'}
            </button>
          </section>

          <aside className="min-w-0 bg-[var(--bg-secondary)] p-4 md:p-7">
            <div className="sticky top-0">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] pb-4">
                <div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--workspace-accent)]">Output monitor</p><h2 className="mt-1 text-lg font-semibold text-white">任务监控与下载</h2></div>
                <span className={`h-2.5 w-2.5 ${taskState === 'completed' ? 'bg-[var(--success)]' : taskState === 'failed' ? 'bg-[var(--error)]' : isBusy ? 'animate-pulse bg-[var(--workspace-accent)]' : 'bg-[var(--text-muted)]'}`} />
              </div>

              <div className="mt-4 border border-[var(--border-color)] bg-[var(--bg-primary)]">
                <div className="flex aspect-[9/12] max-h-[620px] items-center justify-center overflow-hidden bg-black">
                  {outputUrl ? <video src={outputUrl} controls autoPlay loop className="h-full w-full object-contain" /> : drivingVideo ? <video src={drivingVideo.previewUrl} controls muted className="h-full w-full object-contain opacity-60" /> : <div className="px-8 text-center"><UserRoundCog className="mx-auto h-12 w-12 text-[var(--workspace-accent)]/60" /><p className="mt-4 text-sm text-[var(--text-secondary)]">生成结果将在这里出现</p><p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">先上传驱动视频和单人物参考图</p></div>}
                </div>
                <div className="border-t border-[var(--border-color)] p-4">
                  <div className="flex items-center gap-2 text-sm text-white">
                    {taskState === 'completed' ? <CheckCircle2 size={16} className="text-[var(--success)]" /> : isBusy ? <Loader2 size={16} className="animate-spin text-[var(--workspace-accent)]" /> : taskState === 'failed' ? <AlertCircle size={16} className="text-[var(--error)]" /> : <Play size={16} className="text-[var(--text-muted)]" />}
                    {stateLabel[taskState]}
                  </div>
                  {taskId && <p className="mt-2 break-all font-mono text-[10px] text-[var(--text-muted)]">{taskId}</p>}
                  {taskProgress && taskState === 'processing' && (
                    <div className="mt-3">
                      <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[10px] text-[var(--text-muted)]">
                        <span>{taskProgress.stage === 'stitching' ? '正在拼接并恢复音轨' : `正在处理第 ${taskProgress.currentSegment} / ${taskProgress.totalSegments} 段`}</span>
                        <span>{taskProgress.progress}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden bg-[var(--bg-tertiary)]"><div className="h-full bg-[var(--workspace-accent)] transition-[width] duration-500" style={{ width: `${Math.max(2, taskProgress.progress)}%` }} /></div>
                    </div>
                  )}
                </div>
              </div>

              {parameters && (
                <div className="mt-3 grid grid-cols-3 divide-x divide-[var(--border-color)] border border-[var(--border-color)] bg-[var(--bg-primary)] text-center">
                  <div className="p-3"><p className="font-mono text-sm text-white">{parameters.width}×{parameters.height}</p><p className="mt-1 text-[10px] text-[var(--text-muted)]">输出尺寸</p></div>
                  <div className="p-3"><p className="font-mono text-sm text-white">{parameters.frameCount}</p><p className="mt-1 text-[10px] text-[var(--text-muted)]">处理帧数 · {parameters.totalSegments} 段</p></div>
                  <div className="p-3"><p className="font-mono text-sm text-white">{parameters.duration.toFixed(2)}s</p><p className="mt-1 text-[10px] text-[var(--text-muted)]">输出时长</p></div>
                </div>
              )}

              <button type="button" onClick={downloadOutput} disabled={!outputUrl} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 border border-[var(--workspace-accent)] bg-[var(--workspace-accent)]/10 text-sm font-medium text-[var(--workspace-accent)] hover:bg-[var(--workspace-accent)] hover:text-[var(--workspace-on-accent)] disabled:cursor-not-allowed"><Download size={16} />下载 MP4</button>
              <div className="mt-4 space-y-2 text-[11px] leading-5 text-[var(--text-muted)]">
                <p>尺寸由源视频自动缩放并对齐到 32 的倍数，最长边不超过 896。</p>
                <p>长视频会在云端按 Base + Extend 自动续写；段间重叠 5 帧并在拼接时去重，最终恢复原视频音轨。</p>
                <p>{productMode === 'preserve' ? `实验性抠图保护：用 “${productSubject || '未填写'}” 跟踪并贴回原产品。` : productMode === 'replace' ? '推荐模式：人物与产品使用两张独立参考图生成，不做原产品硬抠图。' : '产品保护未开启。'}</p>
              </div>
            </div>
          </aside>
        </div>
      </DevToolsLayout>
      <SettingsModal isOpen={showSettings} settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
