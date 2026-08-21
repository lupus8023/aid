'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  Panel,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  BookOpenText,
  Edit3,
  Film,
  Grid2X2Plus,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { Storyboard } from '@/types';
import { estimateVideoSegmentSeconds, resolveVideoSegmentGroups, type VideoSegmentPlan } from '@/lib/videoSegments';

type CanvasNodeKind = 'story' | 'grid' | 'scene' | 'video' | 'segment' | 'output';

type CanvasNodeData = {
  kind: CanvasNodeKind;
  title: string;
  storyboardId?: string;
  sceneNumber?: number;
  batchNumber?: number;
  sceneCount?: number;
  storyText?: string;
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  imageUrls?: string[];
  status?: string;
  completedCount?: number;
  segmentIds?: string[];
  duration?: number;
  onGenerateGrid?: () => void;
  onGenerateImage?: () => void;
  onGenerateVideo?: () => void;
  onPreviewVideo?: () => void;
};

type CanvasNode = Node<CanvasNodeData>;

interface CanvasModeProps {
  storyContent?: string;
  storyboards: Storyboard[];
  videoSegmentPlan?: VideoSegmentPlan;
  onExit?: () => void;
  onUpdate?: (storyboard: Storyboard) => void;
  onGenerateImage?: (storyboard: Storyboard) => void | Promise<void>;
  onGenerateVideoPrompt?: (storyboard: Storyboard, segmentStoryboards?: Storyboard[]) => void | Promise<void>;
  onGenerateAudio?: (storyboard: Storyboard) => void | Promise<void>;
  onGenerateVideo?: (storyboard: Storyboard, segmentStoryboards?: Storyboard[]) => void | Promise<void>;
  onGenerateGrid?: (storyboards: Storyboard[]) => void | Promise<void>;
}

const nodeTypes = {
  storyNode: StoryNode,
  gridNode: GridNode,
  sceneNode: SceneNode,
  videoNode: VideoNode,
  segmentNode: SegmentNode,
  outputNode: OutputNode,
};

function StateDot({ status }: { status?: string }) {
  return <span className={`h-2 w-2 rounded-full ${status === 'completed' ? 'bg-[var(--success)]' : status === 'generating' ? 'animate-pulse bg-[var(--workspace-accent)]' : status === 'failed' ? 'bg-[var(--error)]' : 'bg-[var(--text-muted)]'}`} />;
}

function StoryNode({ data, selected }: NodeProps<CanvasNodeData>) {
  return (
    <article className={`w-[330px] overflow-hidden rounded-[14px] border bg-[var(--bg-secondary)] shadow-[0_20px_55px_-35px_#000] ${selected ? 'border-[var(--workspace-accent)] ring-1 ring-[var(--workspace-accent)]/25' : 'border-[var(--border-color)]'}`}>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[var(--workspace-accent)]" />
      <header className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--workspace-accent)]/12 text-[var(--workspace-accent)]"><BookOpenText size={18} /></span>
        <div><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--workspace-accent)]">Master prompt</p><h3 className="mt-1 text-sm font-semibold text-white">整体 Prompt</h3></div>
      </header>
      <div className="p-4"><p className="line-clamp-9 whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{data.storyText || '当前项目没有保存最初的整体 Prompt。'}</p><div className="mt-4 flex items-center justify-between border-t border-[var(--border-color)] pt-3 text-[11px] text-[var(--text-muted)]"><span>{data.sceneCount} 个镜头</span><span>每 9 镜头一批</span></div></div>
    </article>
  );
}

function GridNode({ data, selected }: NodeProps<CanvasNodeData>) {
  const generating = data.status === 'generating';
  const completed = data.status === 'completed';
  const imageUrls = data.imageUrls || [];
  return (
    <article className={`w-[270px] rounded-[14px] border bg-[var(--bg-secondary)] p-4 shadow-[0_20px_55px_-35px_#000] ${selected ? 'border-[#f0b95d] ring-1 ring-[#f0b95d]/25' : 'border-[var(--border-color)]'}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[#f0b95d]" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[#f0b95d]" />
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#f0b95d]/12 text-[#f0b95d]">{generating ? <Loader2 size={18} className="animate-spin" /> : <Grid2X2Plus size={18} />}</span><div><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#f0b95d]">Batch {String(data.batchNumber).padStart(2, '0')}</p><h3 className="mt-1 text-sm font-semibold text-white">九宫格生成</h3></div></div>
      <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">本批 {data.sceneCount} 个镜头；生成完成后自动拆分并回填各分镜。</p>
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-[9px] border border-white/5 bg-black/25 p-1.5">
        {Array.from({ length: 9 }).map((_, index) => <div key={index} className="aspect-video overflow-hidden rounded-[3px] bg-white/5">{imageUrls[index] && <img src={imageUrls[index]} alt={`第 ${index + 1} 格`} className="h-full w-full object-cover" />}</div>)}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--text-secondary)]"><StateDot status={data.status} />{completed ? `已拆分 ${data.completedCount}/${data.sceneCount}` : generating ? `生成和拆分中 ${data.completedCount}/${data.sceneCount}` : data.completedCount ? `已生成 ${data.completedCount}/${data.sceneCount}` : `等待生成 0/${data.sceneCount}`}</div>
      <button type="button" disabled={generating} onClick={(event) => { event.stopPropagation(); data.onGenerateGrid?.(); }} className="nodrag mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[9px] bg-[#f0b95d] px-3 text-xs font-semibold text-[#17130b] disabled:opacity-60">{generating ? <Loader2 size={14} className="animate-spin" /> : completed ? <RefreshCw size={14} /> : <Sparkles size={14} />}{generating ? '生成并拆分中' : completed ? '重新生成本批' : '生成并自动拆分'}</button>
    </article>
  );
}

function SceneNode({ data, selected }: NodeProps<CanvasNodeData>) {
  const generating = data.status === 'generating';
  return (
    <article className={`w-[300px] overflow-hidden rounded-[14px] border bg-[var(--bg-secondary)] shadow-[0_20px_55px_-35px_#000] ${selected ? 'border-[var(--workspace-accent)] ring-1 ring-[var(--workspace-accent)]/25' : 'border-[var(--border-color)]'}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[var(--workspace-accent)]" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[var(--workspace-accent)]" />
      <div className="relative aspect-video bg-black/35">{data.imageUrl ? <img src={data.imageUrl} alt={`分镜 ${data.sceneNumber}`} className="h-full w-full object-contain" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--text-muted)]">{generating ? <Loader2 size={27} className="animate-spin text-[var(--workspace-accent)]" /> : <ImageIcon size={27} />}<span className="text-[11px]">{generating ? '等待九宫格拆分' : '尚无分镜图'}</span></div>}<span className="absolute left-2 top-2 rounded-full border border-white/10 bg-black/70 px-2 py-1 font-mono text-[9px] text-white">SHOT · {String(data.sceneNumber).padStart(2, '0')}</span></div>
      <div className="p-3"><p className="line-clamp-2 min-h-10 text-[11px] leading-5 text-[var(--text-secondary)]">{data.prompt}</p><button type="button" disabled={generating} onClick={(event) => { event.stopPropagation(); data.onGenerateImage?.(); }} className="nodrag mt-3 flex min-h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs text-white disabled:opacity-50">{data.imageUrl ? <RefreshCw size={13} /> : <Sparkles size={13} />}{data.imageUrl ? '单独重新生成' : '单独生成分镜'}</button></div>
    </article>
  );
}

function VideoNode({ data, selected }: NodeProps<CanvasNodeData>) {
  const generating = data.status === 'generating';
  const blocked = !data.imageUrl;
  return (
    <article className={`w-[300px] overflow-hidden rounded-[14px] border bg-[var(--bg-secondary)] shadow-[0_20px_55px_-35px_#000] ${selected ? 'border-[var(--workspace-accent)] ring-1 ring-[var(--workspace-accent)]/25' : 'border-[var(--border-color)]'}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[var(--workspace-accent)]" />
      <div className="relative aspect-video bg-black/45">{data.videoUrl ? <video src={data.videoUrl} muted playsInline className="h-full w-full object-contain" /> : data.imageUrl ? <img src={data.imageUrl} alt="视频首帧" className="h-full w-full object-contain opacity-60" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--text-muted)]"><Video size={28} /><span className="text-[11px]">等待分镜图</span></div>}{generating && <div className="absolute inset-0 flex items-center justify-center bg-black/55"><Loader2 size={30} className="animate-spin text-[var(--workspace-accent)]" /></div>}<span className="absolute left-2 top-2 rounded-full border border-white/10 bg-black/70 px-2 py-1 font-mono text-[9px] text-white">VIDEO · {String(data.sceneNumber).padStart(2, '0')}</span>{data.videoUrl && <button type="button" onClick={(event) => { event.stopPropagation(); data.onPreviewVideo?.(); }} className="nodrag absolute inset-0 m-auto grid h-11 w-11 place-items-center rounded-full bg-black/65 text-white"><Play size={18} fill="currentColor" /></button>}</div>
      <div className="p-3"><div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]"><StateDot status={data.status} />{blocked ? '等待分镜' : data.status === 'completed' ? '已完成' : generating ? '生成中' : '可以生成'}</div><button type="button" disabled={generating || blocked} onClick={(event) => { event.stopPropagation(); data.onGenerateVideo?.(); }} className="nodrag mt-3 flex min-h-9 w-full items-center justify-center gap-2 rounded-[9px] bg-[var(--workspace-accent)] px-3 text-xs font-semibold text-[var(--workspace-on-accent)] disabled:cursor-not-allowed disabled:opacity-45">{generating ? <Loader2 size={13} className="animate-spin" /> : data.videoUrl ? <RefreshCw size={13} /> : <Sparkles size={13} />}{blocked ? '等待分镜图' : generating ? '生成中' : data.videoUrl ? '重新生成视频' : '生成视频'}</button></div>
    </article>
  );
}

function SegmentNode({ data, selected }: NodeProps<CanvasNodeData>) {
  const generating = data.status === 'generating';
  const completed = data.status === 'completed';
  const blocked = (data.imageUrls || []).some(url => !url);
  return (
    <article className={`w-[330px] overflow-hidden rounded-[14px] border bg-[var(--bg-secondary)] shadow-[0_20px_55px_-35px_#000] ${selected ? 'border-[var(--workspace-accent)] ring-1 ring-[var(--workspace-accent)]/25' : 'border-[var(--border-color)]'}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[var(--workspace-accent)]" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[var(--workspace-accent)]" />
      <header className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-[9px] bg-[var(--workspace-accent)]/12 text-[var(--workspace-accent)]">{generating ? <Loader2 size={17} className="animate-spin" /> : <Film size={17} />}</span><div><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--workspace-accent)]">H3 segment</p><h3 className="mt-0.5 text-sm font-semibold text-white">{data.title}</h3></div></div><StateDot status={data.status} /></header>
      <div className="p-3"><div className="flex gap-1.5 overflow-hidden">{(data.imageUrls || []).map((url, index) => <div key={index} className="min-w-0 flex-1 overflow-hidden rounded-md bg-black/30"><img src={url} alt={`节拍 ${index + 1}`} className="aspect-video h-full w-full object-cover" /></div>)}</div><div className="mt-3 flex items-center justify-between text-[10px] text-[var(--text-muted)]"><span>{data.sceneCount} 个节拍</span><span>{data.duration}s · 最长 15s</span></div>{data.videoUrl && <video src={data.videoUrl} controls className="mt-3 aspect-video w-full rounded-lg object-cover" />}<button type="button" disabled={generating || blocked} onClick={event => { event.stopPropagation(); data.onGenerateVideo?.(); }} className="nodrag mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[9px] bg-[var(--workspace-accent)] px-3 text-xs font-semibold text-[var(--workspace-on-accent)] disabled:opacity-45">{generating ? <Loader2 size={14} className="animate-spin" /> : completed ? <RefreshCw size={14} /> : <Sparkles size={14} />}{generating ? '生成中' : completed ? '重新生成片段' : '生成 H3 片段'}</button></div>
    </article>
  );
}

function OutputNode({ data, selected }: NodeProps<CanvasNodeData>) {
  return (
    <article className={`w-[250px] rounded-[14px] border bg-[var(--bg-secondary)] p-4 shadow-[0_20px_55px_-35px_#000] ${selected ? 'border-[#f0b95d] ring-1 ring-[#f0b95d]/25' : 'border-[var(--border-color)]'}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[var(--bg-primary)] !bg-[#f0b95d]" />
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-[10px] bg-[#f0b95d]/12 text-[#f0b95d]"><Save size={18} /></span><div><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#f0b95d]">Final timeline</p><h3 className="mt-1 text-sm font-semibold text-white">合并与导出</h3></div></div>
      <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">{data.completedCount}/{data.sceneCount} 个视频片段已完成。导出阶段使用浏览器本地缓存进行 FFmpeg 合并。</p>
    </article>
  );
}

function CanvasModeContent({ storyContent, storyboards, videoSegmentPlan, onExit, onUpdate, onGenerateImage, onGenerateVideoPrompt, onGenerateVideo, onGenerateGrid }: CanvasModeProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [editVideoPrompt, setEditVideoPrompt] = useState('');
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);
  const [notice, setNotice] = useState('按流程从左向右：整体故事 → 九宫格 → 独立分镜 → H3 片段 → 最终时间线。');
  const previousPositions = useRef(new Map<string, { x: number; y: number }>());

  const batches = useMemo(() => {
    const result: Storyboard[][] = [];
    for (let index = 0; index < storyboards.length; index += 9) result.push(storyboards.slice(index, index + 9));
    return result;
  }, [storyboards]);
  const segments = useMemo(
    () => resolveVideoSegmentGroups(storyboards.filter(item => item.imageUrl), videoSegmentPlan),
    [storyboards, videoSegmentPlan],
  );
  const storyboardById = useMemo(() => new Map(storyboards.map(item => [item.id, item])), [storyboards]);
  const selectedNode = nodes.find(node => node.id === selectedNodeId);
  const selectedStoryboard = selectedNode?.data.storyboardId ? storyboardById.get(selectedNode.data.storyboardId) : undefined;
  const selectedSegment = (selectedNode?.data.segmentIds || []).map(id => storyboardById.get(id)).filter((item): item is Storyboard => Boolean(item));

  const generateGridBatch = useCallback((batch: Storyboard[], batchNumber: number) => {
    setSelectedNodeId(`grid:${batchNumber}`);
    setNotice(`正在生成第 ${batchNumber} 批九宫格，完成后会自动拆成 ${batch.length} 张分镜。`);
    void onGenerateGrid?.(batch);
  }, [onGenerateGrid]);

  const generateImage = useCallback((storyboard: Storyboard) => {
    setNotice(`正在单独生成分镜 ${storyboard.sceneNumber}。`);
    void onGenerateImage?.(storyboard);
  }, [onGenerateImage]);

  const generateVideo = useCallback((storyboard: Storyboard, segment: Storyboard[] = [storyboard]) => {
    if (segment.some(item => !item.imageUrl)) { setNotice(`片段仍有分镜没有图片，请先完成九宫格拆分。`); return; }
    setNotice(`正在用分镜 ${segment.map(item => item.sceneNumber).join('、')} 生成一个 H3 片段。`);
    void onGenerateVideo?.(storyboard, segment);
  }, [onGenerateVideo]);

  useEffect(() => {
    const positionFor = (id: string, fallback: { x: number; y: number }) => previousPositions.current.get(id) || fallback;
    const nextNodes: CanvasNode[] = [];
    const nextEdges: Edge[] = [];
    const storyId = 'story:source';
    const totalHeight = Math.max(
      batches.reduce((sum, batch) => sum + Math.max(430, Math.ceil(batch.length / 3) * 245 + 120), 0),
      segments.length * 330 + 200,
    );
    nextNodes.push({ id: storyId, type: 'storyNode', position: positionFor(storyId, { x: 60, y: Math.max(120, totalHeight / 2 - 150) }), data: { kind: 'story', title: '故事', storyText: storyContent, sceneCount: storyboards.length } });

    let batchY = 80;
    batches.forEach((batch, batchIndex) => {
      const batchNumber = batchIndex + 1;
      const gridId = `grid:${batchNumber}`;
      const completedCount = batch.filter(item => Boolean(item.imageUrl)).length;
      const generating = batch.some(item => item.status === 'generating');
      const failed = batch.some(item => item.status === 'failed');
      // During regeneration the previous imageUrl remains available. Status
      // must therefore win over the stale completed-image count, otherwise a
      // failed batch is incorrectly shown as completed and looks like it was
      // never attempted.
      const batchStatus = generating ? 'generating' : failed ? 'failed' : completedCount === batch.length ? 'completed' : 'pending';
      const batchHeight = Math.max(430, Math.ceil(batch.length / 3) * 245 + 120);
      const batchCenterY = batchY + Math.max(70, batchHeight / 2 - 130);

      nextNodes.push({ id: gridId, type: 'gridNode', position: positionFor(gridId, { x: 470, y: batchCenterY }), data: { kind: 'grid', title: `第 ${batchNumber} 批 · 九宫格`, batchNumber, sceneCount: batch.length, completedCount, imageUrls: batch.map(item => item.imageUrl || ''), status: batchStatus, onGenerateGrid: () => generateGridBatch(batch, batchNumber) } });
      nextEdges.push({ id: `${storyId}->${gridId}`, source: storyId, target: gridId, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } });

      batch.forEach((storyboard, shotIndex) => {
        const sceneId = `scene:${storyboard.id}`;
        const rowY = batchY + Math.floor(shotIndex / 3) * 245;
        const columnX = 820 + (shotIndex % 3) * 340;
        nextNodes.push({ id: sceneId, type: 'sceneNode', position: positionFor(sceneId, { x: columnX, y: rowY }), data: { kind: 'scene', title: `分镜 ${storyboard.sceneNumber}`, storyboardId: storyboard.id, sceneNumber: storyboard.sceneNumber, prompt: storyboard.prompt, imageUrl: storyboard.imageUrl, status: storyboard.status, onGenerateImage: () => generateImage(storyboard) } });
        nextEdges.push({ id: `${gridId}->${sceneId}`, source: gridId, target: sceneId, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } });
      });
      batchY += batchHeight;
    });

    segments.forEach((segment, segmentIndex) => {
      const leader = segment[0];
      const segmentId = `segment:${segment.map(item => item.id).join(':')}`;
      const savedIds = leader.videoSegmentStoryboardIds || [];
      const completed = Boolean(leader.videoUrl && savedIds.length === segment.length && savedIds.every((id, index) => id === segment[index].id));
      const status = segment.some(item => item.videoStatus === 'generating') ? 'generating' : segment.some(item => item.videoStatus === 'failed') ? 'failed' : completed ? 'completed' : 'pending';
      nextNodes.push({ id: segmentId, type: 'segmentNode', position: positionFor(segmentId, { x: 1900, y: 90 + segmentIndex * 350 }), data: { kind: 'segment', title: `片段 ${String(segmentIndex + 1).padStart(2, '0')}`, storyboardId: leader.id, segmentIds: segment.map(item => item.id), sceneCount: segment.length, duration: estimateVideoSegmentSeconds(segment), imageUrls: segment.map(item => item.imageUrl || ''), imageUrl: leader.imageUrl, videoUrl: leader.videoUrl, status, onGenerateVideo: () => generateVideo(leader, segment), onPreviewVideo: () => leader.videoUrl && setPreviewVideo(leader.videoUrl) } });
      segment.forEach(item => nextEdges.push({ id: `scene:${item.id}->${segmentId}`, source: `scene:${item.id}`, target: segmentId, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }));
    });

    const outputId = 'output:final';
    const completedSegments = segments.filter(segment => {
      const leader = segment[0];
      return Boolean(leader?.videoUrl && leader.videoSegmentStoryboardIds?.length === segment.length);
    }).length;
    nextNodes.push({ id: outputId, type: 'outputNode', position: positionFor(outputId, { x: 2320, y: Math.max(160, segments.length * 175 - 80) }), data: { kind: 'output', title: '最终时间线', sceneCount: segments.length, completedCount: completedSegments } });
    segments.forEach(segment => {
      const segmentId = `segment:${segment.map(item => item.id).join(':')}`;
      nextEdges.push({ id: `${segmentId}->${outputId}`, source: segmentId, target: outputId, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } });
    });
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [batches, generateGridBatch, generateImage, generateVideo, segments, setEdges, setNodes, storyContent, storyboards]);

  useEffect(() => { nodes.forEach(node => previousPositions.current.set(node.id, node.position)); }, [nodes]);

  const startEditing = useCallback(() => {
    if (!selectedStoryboard) return;
    setEditPrompt(selectedStoryboard.prompt || '');
    setEditVideoPrompt(selectedStoryboard.videoPrompt || '');
    setEditing(true);
  }, [selectedStoryboard]);

  const saveEditing = useCallback(() => {
    if (!selectedStoryboard || !onUpdate) return;
    onUpdate({ ...selectedStoryboard, prompt: editPrompt, videoPrompt: editVideoPrompt });
    setEditing(false);
    setNotice(`分镜 ${selectedStoryboard.sceneNumber} 的提示词已更新。`);
  }, [editPrompt, editVideoPrompt, onUpdate, selectedStoryboard]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--bg-primary)]">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={(_, node) => { setSelectedNodeId(node.id); setEditing(false); }} onPaneClick={() => { setSelectedNodeId(null); setEditing(false); }} fitView fitViewOptions={{ padding: 0.12, maxZoom: 0.82 }} minZoom={0.12} maxZoom={2} defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: 'var(--workspace-accent)', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed } }} className="bg-[radial-gradient(circle_at_50%_0,rgba(var(--workspace-accent-rgb),.06),transparent_36%)]">
        <Background color="var(--border-color)" gap={24} size={1} />
        <Controls showInteractive={false} className="!overflow-hidden !rounded-[10px] !border !border-[var(--border-color)] !bg-[var(--bg-secondary)] !shadow-lg" />
        <MiniMap pannable zoomable nodeColor={node => node.data.kind === 'story' ? '#55d6c2' : node.data.kind === 'grid' || node.data.kind === 'output' ? '#f0b95d' : node.data.kind === 'scene' ? '#8be7da' : '#35bca7'} maskColor="rgba(10,13,15,.7)" className="!rounded-[10px] !border !border-[var(--border-color)] !bg-[var(--bg-secondary)]" />
        <Panel position="top-left" className="!m-4"><div className="flex items-center gap-2 rounded-[12px] border border-[var(--border-color)] bg-[var(--bg-secondary)]/95 p-2 shadow-xl backdrop-blur"><div className="flex items-center gap-2 px-2 text-xs font-semibold text-white"><LayoutGrid size={15} className="text-[var(--workspace-accent)]" />无限画布</div><span className="h-6 w-px bg-[var(--border-color)]" /><span className="hidden max-w-[560px] truncate px-2 text-[11px] text-[var(--text-muted)] md:block">{notice}</span><button type="button" onClick={onExit} className="ml-1 flex min-h-9 items-center gap-2 rounded-[9px] border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs text-white"><List size={14} />返回列表</button></div></Panel>

        {selectedStoryboard && <Panel position="top-right" className="!m-4 !mt-[72px]"><aside className="w-[340px] max-w-[calc(100vw-32px)] rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-secondary)]/97 p-4 shadow-2xl backdrop-blur"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--workspace-accent)]">Node inspector</p><h3 className="mt-1 text-sm font-semibold text-white">{selectedNode?.data.title}</h3></div><button type="button" onClick={() => setSelectedNodeId(null)} className="rounded p-1 text-[var(--text-muted)] hover:text-white"><X size={15} /></button></div>{selectedSegment.length ? <div className="mt-4 space-y-3"><p className="text-[11px] text-[var(--text-secondary)]">{selectedSegment.length} 个分镜合成一个 {estimateVideoSegmentSeconds(selectedSegment)} 秒 H3 片段。</p><div className="flex gap-1.5">{selectedSegment.map(item => <img key={item.id} src={item.imageUrl} alt="" className="aspect-video min-w-0 flex-1 rounded object-cover" />)}</div><button type="button" onClick={() => generateVideo(selectedSegment[0], selectedSegment)} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-[9px] bg-[var(--workspace-accent)] px-3 text-xs font-semibold text-[var(--workspace-on-accent)]"><Film size={14} />生成整个片段</button></div> : editing ? <div className="mt-4 space-y-3"><label className="block text-[11px] text-[var(--text-muted)]">图片提示词</label><textarea value={editPrompt} onChange={event => setEditPrompt(event.target.value)} rows={6} className="w-full rounded-[9px] border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs leading-5 text-white" /><label className="block text-[11px] text-[var(--text-muted)]">视频提示词</label><textarea value={editVideoPrompt} onChange={event => setEditVideoPrompt(event.target.value)} rows={5} className="w-full rounded-[9px] border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs leading-5 text-white" /><div className="flex gap-2"><button type="button" onClick={saveEditing} className="flex flex-1 items-center justify-center gap-2 rounded-[9px] bg-[var(--workspace-accent)] px-3 py-2 text-xs font-semibold text-[var(--workspace-on-accent)]"><Save size={13} />保存</button><button type="button" onClick={() => setEditing(false)} className="flex-1 rounded-[9px] border border-[var(--border-color)] px-3 py-2 text-xs text-white">取消</button></div></div> : <div className="mt-4 space-y-3"><p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[var(--text-secondary)]">{selectedStoryboard.prompt}</p><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => generateImage(selectedStoryboard)} className="flex min-h-10 items-center justify-center gap-2 rounded-[9px] bg-[var(--workspace-accent)] px-3 text-xs font-semibold text-[var(--workspace-on-accent)]"><ImageIcon size={14} />生成分镜</button><button type="button" onClick={() => generateVideo(selectedStoryboard)} className="flex min-h-10 items-center justify-center gap-2 rounded-[9px] border border-[var(--workspace-accent)]/40 bg-[var(--workspace-accent)]/10 px-3 text-xs font-semibold text-[var(--workspace-accent)]"><Video size={14} />生成视频</button><button type="button" onClick={() => void onGenerateVideoPrompt?.(selectedStoryboard)} className="flex min-h-9 items-center justify-center gap-2 rounded-[9px] border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs text-white"><Sparkles size={13} />视频提示词</button><button type="button" onClick={startEditing} className="flex min-h-9 items-center justify-center gap-2 rounded-[9px] border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs text-white"><Edit3 size={13} />编辑提示词</button></div></div>}</aside></Panel>}
      </ReactFlow>
      {previewVideo && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6" onClick={() => setPreviewVideo(null)}><div className="relative flex h-full w-full items-center justify-center" onClick={event => event.stopPropagation()}><button type="button" onClick={() => setPreviewVideo(null)} className="absolute right-0 top-0 rounded-full bg-white/10 p-2 text-white"><X size={20} /></button><video src={previewVideo} controls autoPlay className="max-h-full max-w-full rounded-[14px] border border-white/15" /></div></div>}
    </div>
  );
}

export default function CanvasMode(props: CanvasModeProps) {
  return <ReactFlowProvider><CanvasModeContent {...props} /></ReactFlowProvider>;
}
