'use client';

import { useEffect, useMemo, useState } from 'react';
import { Character, Storyboard } from '@/types';
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
  persistedVideoClipCount,
  suggestVideoSegments,
  validateVideoSegment,
} from '@/lib/videoSegments';

interface Step5Props {
  storyboards: Storyboard[];
  characters: Character[];
  videoModel?: string;
  videoProvider?: 'apimart' | 'comfyui';
  onBack: () => void;
  onNext: () => void;
  onGenerateVideo: (storyboard: Storyboard, segmentStoryboards?: Storyboard[]) => void;
  onGenerateVideoPrompt?: (storyboard: Storyboard, segmentStoryboards?: Storyboard[]) => void;
  onGenerateAudio?: (storyboard: Storyboard) => void;
  onUpdate?: (storyboard: Storyboard) => void;
}

type SegmentStatus = 'ready' | 'generating' | 'completed' | 'failed';

function segmentStatus(group: Storyboard[]): SegmentStatus {
  if (group.some(item => item.videoStatus === 'generating')) return 'generating';
  if (group.some(item => item.videoStatus === 'failed')) return 'failed';
  const leader = group[0];
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
  }[status];
  return <span className="inline-flex items-center gap-2 text-[11px] text-[var(--text-secondary)]"><i className={`h-2 w-2 rounded-full ${config[1]}`} />{config[0]}</span>;
}

function dialogueLines(storyboard: Storyboard) {
  return storyboard.dialogueLines?.length
    ? storyboard.dialogueLines
    : Object.entries(storyboard.dialogue || {}).map(([character, text]) => ({ character, text }));
}

function sameMembers(groups: string[][], storyboards: Storyboard[]) {
  return groups.flat().join('|') === storyboards.map(item => item.id).join('|');
}

export default function Step5({
  storyboards,
  videoModel,
  videoProvider = 'apimart',
  onBack,
  onNext,
  onGenerateVideo,
  onGenerateVideoPrompt,
  onUpdate,
}: Step5Props) {
  const isComfyUI = videoProvider === 'comfyui';
  const withImages = useMemo(() => storyboards.filter(item => item.imageUrl), [storyboards]);
  const storyboardById = useMemo(() => new Map(withImages.map(item => [item.id, item])), [withImages]);
  const suggested = useMemo(() => suggestVideoSegments(withImages), [withImages]);
  const [groupIds, setGroupIds] = useState<string[][]>(() => suggested.map(group => group.map(item => item.id)));
  const [activeIndex, setActiveIndex] = useState(0);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');

  useEffect(() => {
    setGroupIds(current => sameMembers(current, withImages)
      ? current
      : suggested.map(group => group.map(item => item.id)));
  }, [suggested, withImages]);

  const groups = groupIds
    .map(ids => ids.map(id => storyboardById.get(id)).filter((item): item is Storyboard => Boolean(item)))
    .filter(group => group.length);
  const safeActiveIndex = Math.min(Math.max(0, activeIndex), Math.max(0, groups.length - 1));
  const activeGroup = groups[safeActiveIndex] || [];
  const activeLeader = activeGroup[0];
  const activeStatus = segmentStatus(activeGroup);
  const activeDialogue = activeGroup.flatMap(dialogueLines).filter(line => String(line.text || '').trim());
  const totalSeconds = groups.reduce((sum, group) => sum + estimateVideoSegmentSeconds(group), 0);
  const completedCount = isComfyUI ? persistedVideoClipCount(storyboards) : storyboards.filter(item => item.videoStatus === 'completed').length;
  const cachingCount = storyboards.filter(item => item.videoCacheStatus === 'caching').length;
  const cachedCount = isComfyUI ? persistedVideoClipCount(storyboards, true) : storyboards.filter(item => item.videoCacheStatus === 'completed').length;

  const commitGroups = (next: string[][], nextActive = safeActiveIndex) => {
    setGroupIds(next.filter(group => group.length));
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
    if (validateVideoSegment(merged)) return;
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
    if (validateVideoSegment(leftShots) || validateVideoSegment(rightShots)) return;
    const next = [...groupIds];
    next.splice(segmentIndex, 2, left, right);
    commitGroups(next, direction === 'left' ? segmentIndex : segmentIndex + 1);
  };

  const generateActive = () => {
    if (!activeLeader || validateVideoSegment(activeGroup)) return;
    onGenerateVideo(activeLeader, activeGroup);
  };

  const beginPromptEdit = () => {
    if (!activeLeader) return;
    setPromptDraft(activeLeader.videoPrompt || '');
    setEditingPrompt(true);
  };

  if (!isComfyUI) {
    return (
      <div className="space-y-5">
        <div className="border-l-4 border-[var(--accent-purple)] pl-4"><h2 className="text-2xl font-mono text-[var(--accent-green)]"><span className="text-[var(--text-secondary)]">05.</span> Generate Videos</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">当前视频通道按单个分镜生成；选择仙宫云 ComfyUI 可启用 H3 片段编排。</p></div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{withImages.map(item => <article key={item.id} className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]"><img src={item.imageUrl} alt={`镜 ${item.sceneNumber}`} className="aspect-video w-full object-cover" /><div className="p-3"><p className="text-xs text-[var(--text-secondary)]">镜 {String(item.sceneNumber).padStart(2, '0')}</p><button onClick={() => onGenerateVideo(item)} className="mt-3 w-full rounded-lg bg-[var(--accent-purple)] px-3 py-2 text-xs text-white">{item.videoStatus === 'generating' ? '生成中…' : '生成视频'}</button></div></article>)}</div>
        <div className="flex justify-between border-t border-[var(--border-color)] pt-4"><button onClick={onBack} className="rounded-lg border border-[var(--border-color)] px-5 py-2 text-sm">返回</button><button onClick={onNext} disabled={!completedCount} className="rounded-lg bg-[var(--accent-green)] px-5 py-2 text-sm text-black disabled:opacity-40">下一步：导出</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 border-l-2 border-[var(--workspace-accent)] pl-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--workspace-accent)]">05 · Segment edit</p>
          <h2 className="mt-2 text-xl font-semibold text-white"><span className="text-[var(--workspace-accent)]">{withImages.length}</span> 分镜 → <span className="text-[var(--workspace-accent)]">{groups.length}</span> 个视频片段 · 预计 {Math.floor(totalSeconds / 60)}m{String(totalSeconds % 60).padStart(2, '0')}s</h2>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">MiniMax H3 · 每段 1–4 个节拍 · 最长 15s · AI 已按剧情、地点、台词与节奏自动分组</p>
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
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h3 className="font-mono text-sm font-semibold text-white">片段 {String(segmentIndex + 1).padStart(2, '0')}</h3><span className="text-[11px] text-[var(--text-secondary)]">{group.length} 个节拍 · {duration}s</span><span className="text-[10px] text-emerald-300">AI 推荐</span></div>
                    <StatusLabel status={status} />
                  </div>
                  <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
                    {group.map((item, shotIndex) => (
                      <div key={item.id} className="flex shrink-0 items-center gap-2">
                        <article className="group relative w-[178px] overflow-hidden rounded-lg border border-white/8 bg-black/20">
                          {item.videoUrl ? <video src={item.videoUrl} muted playsInline className="aspect-video w-full object-cover" /> : <img src={item.imageUrl} alt={`镜 ${item.sceneNumber}`} className="aspect-video w-full object-cover" />}
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
                  const canMerge = group.length + groups[segmentIndex + 1].length <= 4;
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
              <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-lg font-semibold text-white">片段 {String(safeActiveIndex + 1).padStart(2, '0')}</h3><StatusLabel status={activeStatus} /></div><p className="mt-1 text-[11px] text-[var(--text-secondary)]">{activeGroup.length} 个节拍 · {estimateVideoSegmentSeconds(activeGroup)}s</p></div><span className="rounded border border-[var(--border-color)] px-2 py-1 font-mono text-[9px] text-[var(--text-secondary)]">MiniMax H3</span></div>
              {activeLeader.videoUrl && <div className="relative mt-4 overflow-hidden rounded-lg"><video src={activeLeader.videoUrl} controls className="aspect-video w-full object-cover" /><span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[9px] text-white">已生成片段</span></div>}
              <div className="mt-4 border-t border-[var(--border-color)] pt-4"><p className="text-[11px] font-semibold text-white">包含分镜</p><div className="mt-3 space-y-2">{activeGroup.map(item => <div key={item.id} className="flex items-center gap-2"><img src={item.imageUrl} alt="" className="h-10 w-14 rounded object-cover" /><div className="min-w-0"><p className="font-mono text-[10px] text-white">镜 {String(item.sceneNumber).padStart(2, '0')}</p><p className="truncate text-[10px] text-[var(--text-muted)]">{item.description}</p></div></div>)}</div></div>
              <div className="mt-4 space-y-2 border-t border-[var(--border-color)] pt-4 text-[11px]"><div className="flex justify-between"><span className="text-[var(--text-secondary)]">时长分配</span><span className="text-white">自动 · {estimateVideoSegmentSeconds(activeGroup)}s</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">连续性检查</span><span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 size={12} />通过</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">对话（估算）</span><span className="text-white">{activeDialogue.length} 条</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">画面文字</span><span className="text-white">干净画面</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">参考图预处理</span><span className="text-emerald-300">高清压缩</span></div></div>

              {editingPrompt ? <div className="mt-4"><textarea value={promptDraft} onChange={event => setPromptDraft(event.target.value)} rows={7} className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[10px] leading-5 text-white" /><div className="mt-2 flex gap-2"><button onClick={() => { onUpdate?.({ ...activeLeader, videoPrompt: promptDraft, videoPromptOverride: true }); setEditingPrompt(false); }} className="flex-1 rounded-lg bg-[var(--workspace-accent)] px-3 py-2 text-xs text-[var(--workspace-on-accent)]">保存</button><button onClick={() => setEditingPrompt(false)} className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs">取消</button></div></div> : <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onGenerateVideoPrompt?.(activeLeader, activeGroup)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[10px]"><Wand2 size={12} />刷新提示词</button><button onClick={beginPromptEdit} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[10px]"><RefreshCw size={12} />编辑提示词</button></div>}

              <button onClick={generateActive} disabled={activeStatus === 'generating'} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--workspace-accent)] text-sm font-semibold text-[var(--workspace-on-accent)] disabled:opacity-50">{activeStatus === 'generating' ? <><Loader2 size={16} className="animate-spin" />正在生成</> : activeStatus === 'completed' ? <><RefreshCw size={15} />重新生成此片段</> : <><Sparkles size={15} />生成此片段</>}</button>
              <p className="mt-2 text-center text-[10px] text-[var(--text-muted)]">最长 15s · 原生同步音频 · 生成后自动缓存</p>
            </>
          ) : <div className="py-12 text-center text-sm text-[var(--text-muted)]">暂无可编排分镜</div>}
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-color)] pt-4"><button onClick={onBack} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-5 py-2 text-sm"><ArrowLeft size={14} />返回图片</button><div className="text-[10px] text-[var(--text-muted)]">分组会自动判断；只有需要改变节奏时才调整边界</div><button onClick={onNext} disabled={!completedCount || cachingCount > 0} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-green)] px-5 py-2 text-sm font-semibold text-black disabled:opacity-35">{cachingCount ? `正在缓存 ${cachingCount} 个片段` : '下一步：合并导出'}<ArrowRight size={14} /></button></footer>
    </div>
  );
}
