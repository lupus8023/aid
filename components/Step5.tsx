'use client';

import { useEffect, useMemo, useState } from 'react';
import { Character, ProjectProductionTiming, Storyboard } from '@/types';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Film,
  HardDrive,
  Loader2,
  Merge,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  estimateVideoSegmentSeconds,
  createVideoSegmentPlan,
  isValidVideoSegmentPlan,
  persistedVideoClipCount,
  resolveVideoSegmentGroups,
  type VideoSegmentPlan,
  validateVideoSegment,
} from '@/lib/videoSegments';
import { storyboardAudioPlan, storyboardSpeech, storyboardSpeechWarnings } from '@/lib/speechAudioContract';
import { storyAspectClass, storyAspectRatioFromDimensions, type StoryAspectRatio } from '@/lib/storyAspectRatio';
import { formatProductionElapsed, productionElapsedMs } from '@/lib/productionTiming';
import { hasLegacyAutomaticContinuity, previousSegmentTailSource } from '@/lib/videoContinuity';
import { lockStoryboardVoiceIds } from '@/lib/voiceCasting';

interface Step5Props {
  storyboards: Storyboard[];
  characters: Character[];
  videoModel?: string;
  videoProvider?: 'apimart' | 'comfyui' | 'fal';
  voiceReferences?: Record<string, string>;
  aspectRatio?: StoryAspectRatio;
  language?: 'zh' | 'en';
  onBack: () => void;
  onNext: () => void;
  onGenerateVideo: (storyboard: Storyboard, segmentStoryboards?: Storyboard[]) => void;
  onGenerateVideoPrompt?: (storyboard: Storyboard, segmentStoryboards?: Storyboard[], rewriteDirection?: boolean) => string | undefined | Promise<string | undefined>;
  onUpdate?: (storyboard: Storyboard) => void;
  videoSegmentPlan?: VideoSegmentPlan;
  onVideoSegmentPlanChange?: (plan: VideoSegmentPlan) => void;
  productionTiming?: ProjectProductionTiming;
}

type SegmentStatus = 'ready' | 'generating' | 'completed' | 'failed' | 'outdated';

function segmentStatus(group: Storyboard[]): SegmentStatus {
  if (group.some(item => item.videoStatus === 'generating')) return 'generating';
  if (group.some(item => item.videoStatus === 'failed')) return 'failed';
  const leader = group[0];
  if (leader?.videoUrl && hasLegacyAutomaticContinuity(leader)) return 'outdated';
  const ids = group.map(item => item.id);
  const saved = leader?.videoSegmentStoryboardIds || [];
  if (leader?.videoUrl && saved.length === ids.length && saved.every((id, index) => id === ids[index])) return 'completed';
  return 'ready';
}

function StatusLabel({ status }: { status: SegmentStatus }) {
  const config = {
    ready: ['就绪', 'bg-emerald-400'],
    generating: ['生成中', 'bg-cyan-400 animate-pulse'],
    completed: ['已缓存', 'bg-blue-400'],
    failed: ['失败', 'bg-red-400'],
    outdated: ['旧版首帧接续 · 需重生成', 'bg-amber-400'],
  }[status];
  return <span className="inline-flex items-center gap-2 text-[11px] text-[var(--text-secondary)]"><i className={`h-2 w-2 rounded-full ${config[1]}`} />{config[0]}</span>;
}

export default function Step5({
  storyboards,
  characters,
  videoModel,
  videoProvider = 'apimart',
  voiceReferences = {},
  aspectRatio = '16:9',
  language = 'zh',
  onBack,
  onNext,
  onGenerateVideo,
  onGenerateVideoPrompt,
  onUpdate,
  videoSegmentPlan,
  onVideoSegmentPlanChange,
  productionTiming,
}: Step5Props) {
  const isComfyUI = videoProvider === 'comfyui';
  const isH3SegmentProvider = isComfyUI || videoProvider === 'fal';
  const withImages = useMemo(() => storyboards.filter(item => item.imageUrl), [storyboards]);
  const storyboardById = useMemo(() => new Map(withImages.map(item => [item.id, item])), [withImages]);
  const plannedGroups = useMemo(
    () => resolveVideoSegmentGroups(withImages, videoSegmentPlan, language),
    [language, videoSegmentPlan, withImages],
  );
  const groupIds = plannedGroups.map(group => group.map(item => item.id));
  const usesManualPlan = isValidVideoSegmentPlan(videoSegmentPlan, withImages, language)
    && videoSegmentPlan.source === 'manual';
  const [activeIndex, setActiveIndex] = useState(0);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [videoAspects, setVideoAspects] = useState<Record<string, StoryAspectRatio>>({});
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    setClockNow(Date.now());
    if (productionTiming?.status !== 'running') return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [productionTiming?.status, productionTiming?.startedAt, productionTiming?.pausedDurationMs]);

  const detectedVideoAspect = (url?: string, fallback: StoryAspectRatio = aspectRatio) => (
    (url && videoAspects[url]) || fallback
  );
  const rememberVideoAspect = (url: string | undefined, video: HTMLVideoElement) => {
    if (!url) return;
    const detected = storyAspectRatioFromDimensions(video.videoWidth, video.videoHeight, aspectRatio);
    setVideoAspects(current => current[url] === detected ? current : { ...current, [url]: detected });
  };

  // Resolved groups are materialized from the segment plan. Each ordered
  // dialogue event is anchored once to its visual start beat; all other beats
  // remain visual references and cannot revive legacy per-shot dialogue.
  // Segment plans keep their own speech snapshots. Rebind materialized groups
  // to the current approved cast before displaying validation or submitting.
  const groups = plannedGroups.map(group => lockStoryboardVoiceIds(group, characters));
  const safeActiveIndex = Math.min(Math.max(0, activeIndex), Math.max(0, groups.length - 1));
  const activeGroup = groups[safeActiveIndex] || [];
  const activeLeader = activeGroup[0];
  const activeStatus = segmentStatus(activeGroup);
  const activeSpeech = activeGroup.flatMap(storyboardSpeech);
  const activeSpeechWarnings = activeGroup.flatMap(storyboardSpeechWarnings);
  const activeValidationError = activeGroup.length ? validateVideoSegment(activeGroup, language) : undefined;
  const activeEnvironment = [...new Set(activeGroup.flatMap(item => storyboardAudioPlan(item).environment))];
  const activeFoley = [...new Set(activeGroup.flatMap(item => storyboardAudioPlan(item).foley))];
  const allowsBackgroundHuman = activeGroup.some(item => storyboardAudioPlan(item).backgroundHuman === 'indistinct_nonverbal');
  const totalSeconds = groups.reduce((sum, group) => sum + estimateVideoSegmentSeconds(group), 0);
  const completedCount = isH3SegmentProvider ? persistedVideoClipCount(storyboards) : storyboards.filter(item => item.videoStatus === 'completed').length;
  const cachingCount = storyboards.filter(item => item.videoCacheStatus === 'caching').length;
  const cachedCount = isH3SegmentProvider ? persistedVideoClipCount(storyboards, true) : storyboards.filter(item => item.videoCacheStatus === 'completed').length;
  const actualProductionTime = formatProductionElapsed(productionElapsedMs(productionTiming, clockNow));
  const productionTimeLabel = productionTiming?.status === 'running'
    ? `制作中 ${actualProductionTime}`
    : productionTiming?.status === 'paused'
      ? `已暂停 ${actualProductionTime}`
      : productionTiming?.status === 'completed'
        ? `实际制作 ${actualProductionTime}`
        : '实际制作 尚未开始';

  const commitGroups = (next: string[][], nextActive = safeActiveIndex) => {
    const nextGroups = next
      .filter(group => group.length)
      .map(ids => ids.map(id => storyboardById.get(id)).filter((item): item is Storyboard => Boolean(item)));
    onVideoSegmentPlanChange?.(createVideoSegmentPlan(withImages, nextGroups, 'manual'));
    setActiveIndex(Math.min(nextActive, Math.max(0, next.length - 1)));
  };

  const splitAfter = (segmentIndex: number, shotIndex: number) => {
    const source = groupIds[segmentIndex];
    if (!source || shotIndex >= source.length - 1) return;
    const next = [...groupIds];
    next.splice(segmentIndex, 1, source.slice(0, shotIndex + 1), source.slice(shotIndex + 1));
    commitGroups(next, segmentIndex);
  };

  const mergeWithNext = (segmentIndex: number) => {
    const mergedIds = [...(groupIds[segmentIndex] || []), ...(groupIds[segmentIndex + 1] || [])];
    const merged = mergedIds.map(id => storyboardById.get(id)).filter((item): item is Storyboard => Boolean(item));
    if (validateVideoSegment(merged, language)) return;
    const next = [...groupIds];
    next.splice(segmentIndex, 2, mergedIds);
    commitGroups(next, segmentIndex);
  };

  const moveBoundary = (segmentIndex: number, direction: 'left' | 'right') => {
    const left = [...(groupIds[segmentIndex] || [])];
    const right = [...(groupIds[segmentIndex + 1] || [])];
    if (!left.length || !right.length) return;
    if (direction === 'left') left.push(right.shift()!);
    else right.unshift(left.pop()!);
    if (!left.length || !right.length) return;
    const leftShots = left.map(id => storyboardById.get(id)).filter((item): item is Storyboard => Boolean(item));
    const rightShots = right.map(id => storyboardById.get(id)).filter((item): item is Storyboard => Boolean(item));
    if (validateVideoSegment(leftShots, language) || validateVideoSegment(rightShots, language)) return;
    const next = [...groupIds];
    next.splice(segmentIndex, 2, left, right);
    commitGroups(next, direction === 'left' ? segmentIndex : segmentIndex + 1);
  };

  const generateActive = () => {
    if (!activeLeader || validateVideoSegment(activeGroup, language)) return;
    onGenerateVideo(activeLeader, activeGroup);
  };

  const beginPromptEdit = async () => {
    if (!activeLeader) return;
    const prompt = activeLeader.videoPrompt || await onGenerateVideoPrompt?.(activeLeader, activeGroup);
    if (!prompt) return;
    setPromptDraft(prompt);
    setEditingPrompt(true);
  };

  if (!isH3SegmentProvider) {
    return (
      <div className="space-y-5">
        <div className="border-l-4 border-[var(--accent-purple)] pl-4"><h2 className="text-2xl font-mono text-[var(--accent-green)]"><span className="text-[var(--text-secondary)]">05.</span> Generate Videos</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">当前视频通道按单个分镜生成；选择仙宫云 ComfyUI 可启用 H3 片段编排。</p></div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{withImages.map(item => <article key={item.id} className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]"><img src={item.imageUrl} alt={`镜 ${item.sceneNumber}`} className={`${storyAspectClass(item.aspectRatio || aspectRatio)} w-full object-cover`} /><div className="p-3"><p className="text-xs text-[var(--text-secondary)]">镜 {String(item.sceneNumber).padStart(2, '0')}</p><button onClick={() => onGenerateVideo(item)} className="mt-3 w-full rounded-lg bg-[var(--accent-purple)] px-3 py-2 text-xs text-white">{item.videoStatus === 'generating' ? '生成中…' : '生成视频'}</button></div></article>)}</div>
        <div className="flex justify-between border-t border-[var(--border-color)] pt-4"><button onClick={onBack} className="rounded-lg border border-[var(--border-color)] px-5 py-2 text-sm">返回</button><button onClick={onNext} disabled={!completedCount} className="rounded-lg bg-[var(--accent-green)] px-5 py-2 text-sm text-black disabled:opacity-40">下一步：导出</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 border-l-2 border-[var(--workspace-accent)] pl-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--workspace-accent)]">05 · Segment edit</p>
          <h2 className="mt-2 text-xl font-semibold text-white"><span className="text-[var(--workspace-accent)]">{withImages.length}</span> 分镜 → <span className="text-[var(--workspace-accent)]">{groups.length}</span> 个视频片段 · 预计成片 {Math.floor(totalSeconds / 60)}m{String(totalSeconds % 60).padStart(2, '0')}s · <span className={productionTiming?.status === 'completed' ? 'text-emerald-300' : 'text-[var(--workspace-accent)]'}>{productionTimeLabel}</span></h2>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">{videoProvider === 'fal' ? 'MiniMax H3 Max · fal' : 'MiniMax H3 · ComfyUI'} · {language === 'en' ? 'English dialogue' : '中文对白'} · 片段先锁定有序台词，再用 1–4 个分镜承载画面 · 最长 15s</p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]"><HardDrive size={13} />本地缓存 {cachedCount}/{completedCount}</div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <main className="min-w-0 space-y-0">
          {groups.map((group, segmentIndex) => {
            const status = segmentStatus(group);
            const selected = segmentIndex === safeActiveIndex;
            const duration = estimateVideoSegmentSeconds(group);
            return (
              <div key={group.map(item => item.id).join('-')}>
                <section onClick={() => setActiveIndex(segmentIndex)} className={`rounded-xl border bg-[var(--bg-secondary)] p-4 transition-colors ${selected ? 'border-[var(--workspace-accent)] shadow-[0_0_0_1px_rgba(var(--workspace-accent-rgb),.15)]' : 'border-[var(--border-color)] hover:border-[var(--workspace-accent)]/45'}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h3 className="font-mono text-sm font-semibold text-white">片段 {String(segmentIndex + 1).padStart(2, '0')}</h3><span className="text-[11px] text-[var(--text-secondary)]">{group.length} 个节拍 · {duration}s</span><span className="text-[10px] text-emerald-300">{usesManualPlan ? '导演编排 · 已保存' : 'AI 推荐'}</span></div>
                    <StatusLabel status={status} />
                  </div>
                  <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
                    {group.map((item, shotIndex) => (
                      <div key={item.id} className="flex shrink-0 items-center gap-2">
                        <article className={`group relative overflow-hidden rounded-lg border border-white/8 bg-black/20 ${(item.aspectRatio || aspectRatio) === '9:16' ? 'w-[96px]' : 'w-[178px]'}`}>
                          <img src={item.imageUrl} alt={`镜 ${item.sceneNumber} 原始分镜`} className={`${storyAspectClass(item.aspectRatio || aspectRatio)} w-full object-cover`} />
                          <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[9px] text-white">原始分镜</span>
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-6 text-center font-mono text-[10px] text-white">镜 {String(item.sceneNumber).padStart(2, '0')}</div>
                          {item.videoStatus === 'generating' && <div className="absolute inset-0 grid place-items-center bg-black/55"><Loader2 size={22} className="animate-spin text-[var(--workspace-accent)]" /></div>}
                        </article>
                        {shotIndex < group.length - 1 && (
                          <button type="button" title="从这里拆成两个片段" onClick={event => { event.stopPropagation(); splitAfter(segmentIndex, shotIndex); }} className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:border-[var(--workspace-accent)] hover:text-[var(--workspace-accent)]"><Scissors size={13} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                {segmentIndex < groups.length - 1 && (() => {
                  const left = group.at(-1)!;
                  const right = groups[segmentIndex + 1][0];
                  const mergeCandidate = [...group, ...groups[segmentIndex + 1]];
                  const canMerge = !validateVideoSegment(mergeCandidate, language);
                  const canMoveLeft = group.length < 4 && groups[segmentIndex + 1].length > 1;
                  const canMoveRight = group.length > 1 && groups[segmentIndex + 1].length < 4;
                  return (
                    <div className="flex min-h-9 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 text-[10px] text-[var(--text-muted)]">
                      <span>镜 {String(left.sceneNumber).padStart(2, '0')} / 镜 {String(right.sceneNumber).padStart(2, '0')} · 片段边界</span>
                      <button disabled={!canMoveLeft} onClick={() => moveBoundary(segmentIndex, 'left')} className="inline-flex items-center gap-1 hover:text-[var(--workspace-accent)] disabled:opacity-25"><ChevronLeft size={12} />后段首镜移入前段</button>
                      <button disabled={!canMoveRight} onClick={() => moveBoundary(segmentIndex, 'right')} className="inline-flex items-center gap-1 hover:text-[var(--workspace-accent)] disabled:opacity-25">前段尾镜移入后段<ChevronRight size={12} /></button>
                      <button disabled={!canMerge} onClick={() => mergeWithNext(segmentIndex)} className="inline-flex items-center gap-1 hover:text-[var(--workspace-accent)] disabled:opacity-25"><Merge size={12} />合并两段</button>
                    </div>
                  );
                })()}
              </div>
            );
          })}

          <nav className="mt-3 flex gap-2 overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
            {groups.map((group, index) => <button key={group[0].id} onClick={() => setActiveIndex(index)} className={`flex min-w-[112px] items-center gap-2 rounded-lg border px-2 py-1.5 text-left ${index === safeActiveIndex ? 'border-[var(--workspace-accent)] bg-[var(--workspace-accent)]/10' : 'border-[var(--border-color)] bg-black/10'}`}><span className="font-mono text-xs text-[var(--workspace-accent)]">{String(index + 1).padStart(2, '0')}</span><img src={group[0].imageUrl} alt="" className="h-7 w-10 rounded object-cover" /><span className="ml-auto text-[10px] text-[var(--text-secondary)]">{estimateVideoSegmentSeconds(group)}s</span></button>)}
          </nav>
        </main>

        <aside className="h-fit rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 xl:sticky xl:top-4">
          {activeLeader ? (
            <>
              <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-lg font-semibold text-white">片段 {String(safeActiveIndex + 1).padStart(2, '0')}</h3><StatusLabel status={activeStatus} /></div><p className="mt-1 text-[11px] text-[var(--text-secondary)]">{activeGroup.length} 个节拍 · {estimateVideoSegmentSeconds(activeGroup)}s</p></div><span className="rounded border border-[var(--border-color)] px-2 py-1 font-mono text-[9px] text-[var(--text-secondary)]">MiniMax H3 · {language === 'en' ? 'EN' : 'ZH'}</span></div>
              <label className="mt-4 block text-[11px] text-[var(--text-secondary)]">视频首帧来源
                <select aria-label="视频首帧来源" value={activeLeader.videoStartMode || 'storyboard'} disabled={activeStatus === 'generating'} onChange={event => onUpdate?.({ ...storyboardById.get(activeLeader.id)!, videoStartMode: event.target.value as Storyboard['videoStartMode'], continuousFromPrev: false, videoPrompt: undefined, videoPromptOverride: false })} className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] p-2 text-white">
                  <option value="storyboard">当前分镜（镜 {String(activeLeader.sceneNumber).padStart(2, '0')}）· 默认</option>
                  <option value="previous-segment-tail" disabled={!previousSegmentTailSource(storyboards, { ...activeLeader, videoStartMode: 'previous-segment-tail' })}>上一段尾帧 · 仅连续接拍</option>
                </select>
              </label>
              {activeStatus === 'outdated' && <p className="mt-2 text-[11px] leading-5 text-amber-300">下方是旧版自动接续生成的视频，不是当前分镜图。重新生成将从上方选择的首帧开始；旧视频在重生成前保留。</p>}
              {activeLeader.videoUrl && (() => { const activeVideoAspect = detectedVideoAspect(activeLeader.videoUrl, activeLeader.aspectRatio || aspectRatio); return <div className={`relative mx-auto mt-4 max-h-[62vh] overflow-hidden rounded-lg bg-black ${storyAspectClass(activeVideoAspect)} ${activeVideoAspect === '9:16' ? 'max-w-[220px]' : 'w-full'}`}><video src={activeLeader.videoUrl} controls onLoadedMetadata={event => rememberVideoAspect(activeLeader.videoUrl, event.currentTarget)} className="h-full w-full object-contain" /><span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[9px] text-white">已生成片段</span></div>; })()}
              <div className="mt-4 border-t border-[var(--border-color)] pt-4"><p className="text-[11px] font-semibold text-white">包含分镜</p><div className="mt-3 space-y-2">{activeGroup.map(item => <div key={item.id} className="flex items-center gap-2"><img src={item.imageUrl} alt="" className="h-10 w-14 rounded object-cover" /><div className="min-w-0"><p className="font-mono text-[10px] text-white">镜 {String(item.sceneNumber).padStart(2, '0')}</p><p className="truncate text-[10px] text-[var(--text-muted)]">{item.description}</p></div></div>)}</div></div>
              <div className="mt-4 space-y-2 border-t border-[var(--border-color)] pt-4 text-[11px]"><div className="flex justify-between"><span className="text-[var(--text-secondary)]">时长分配</span><span className="text-white">自动 · {estimateVideoSegmentSeconds(activeGroup)}s</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">连续性检查</span><span className={`inline-flex items-center gap-1 ${activeValidationError ? 'text-red-300' : 'text-emerald-300'}`}><CheckCircle2 size={12} />{activeValidationError || '通过'}</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">权威台词</span><span className="text-white">{activeSpeech.length} 条</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">画面文字</span><span className="text-white">干净画面</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">参考图预处理</span><span className="text-emerald-300">高清压缩</span></div></div>

              <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-black/10 p-3 text-[10px]">
                <p className="font-semibold text-white">片段级台词与声音白名单</p>
                {activeSpeech.length ? activeSpeech.map(line => { const hasVoice = Boolean(line.voiceId || voiceReferences[line.character]); return <div key={`${line.speakerId}-${line.exactLine}`} className="mt-2 rounded border border-white/5 p-2"><div className="flex justify-between gap-2"><span className="text-[var(--workspace-accent)]">{line.speakerId} · {line.character}</span><span className={hasVoice ? 'text-emerald-300' : 'text-amber-300'}>{hasVoice ? '音色已绑定' : '未绑定角色音色'}</span></div><p className="mt-1 leading-5 text-white">“{line.exactLine}”</p><p className="mt-1 text-[var(--text-muted)]">仅该角色按上方文字发声一次</p></div>; }) : <p className="mt-2 text-[var(--text-secondary)]">本片段没有授权台词。</p>}
                {activeSpeechWarnings.length > 0 && <div className="mt-2 rounded border border-amber-300/20 bg-amber-300/5 px-2 py-1.5 text-amber-200">{[...new Set(activeSpeechWarnings)].join('；')}</div>}
                <div className="mt-3 space-y-1 text-[var(--text-secondary)]"><p>背景人声：{allowsBackgroundHuman ? '仅不可辨识的非语言存在感' : '禁止'}</p><p>环境声：{activeEnvironment.length ? activeEnvironment.join('、') : '仅安静场底'}</p><p>拟音：{activeFoley.length ? activeFoley.join('、') : '仅画面接触声'}</p><p>音乐：{activeGroup.some(item => storyboardAudioPlan(item).music !== 'none') ? '按剧本指定' : '禁止'}</p></div>
              </div>

              {editingPrompt ? <div className="mt-4"><textarea value={promptDraft} onChange={event => setPromptDraft(event.target.value)} rows={7} className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[10px] leading-5 text-white" /><div className="mt-2 flex gap-2"><button onClick={() => { onUpdate?.({ ...activeLeader, videoPrompt: promptDraft, videoPromptOverride: true }); setEditingPrompt(false); }} className="flex-1 rounded-lg bg-[var(--workspace-accent)] px-3 py-2 text-xs text-[var(--workspace-on-accent)]">保存并按此原文提交</button><button onClick={() => setEditingPrompt(false)} className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs">取消</button></div></div> : <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onGenerateVideoPrompt?.(activeLeader, activeGroup, true)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[10px]"><Wand2 size={12} />刷新实际提示词</button><button onClick={() => void beginPromptEdit()} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[10px]"><RefreshCw size={12} />编辑实际提示词</button></div>}

              <button onClick={generateActive} disabled={activeStatus === 'generating' || Boolean(activeValidationError)} title={activeValidationError} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--workspace-accent)] text-sm font-semibold text-[var(--workspace-on-accent)] disabled:opacity-50">{activeStatus === 'generating' ? <><Loader2 size={16} className="animate-spin" />正在生成</> : activeStatus === 'completed' ? <><RefreshCw size={15} />重新生成此片段</> : <><Sparkles size={15} />生成此片段</>}</button>
              <p className="mt-2 text-center text-[10px] text-[var(--text-muted)]">最长 15s · 原生同步音频 · 生成后自动缓存</p>
            </>
          ) : <div className="py-12 text-center text-sm text-[var(--text-muted)]">暂无可编排分镜</div>}
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-color)] pt-4"><button onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-5 py-2 text-sm"><ArrowLeft size={14} />返回图片</button><div className="text-[10px] text-[var(--text-muted)]">{usesManualPlan ? '导演编排已写入项目；刷新和一键成片都会保留' : 'AI 会按时长、对白和动作因果自动归类；可手动锁定边界'}</div><button onClick={onNext} disabled={!completedCount || cachingCount > 0} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-green)] px-5 py-2 text-sm font-semibold text-black disabled:opacity-35">{cachingCount ? `正在缓存 ${cachingCount} 个片段` : '下一步：合并导出'}<ArrowRight size={14} /></button></footer>
    </div>
  );
}
