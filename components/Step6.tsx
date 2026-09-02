import VideoEditor, { type VideoEditorExportResult } from './video-editor/VideoEditor';
import { ProjectProductionTiming, Storyboard } from '@/types';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AppSettings } from '@/types';
import type { StoryAspectRatio } from '@/lib/storyAspectRatio';
import { formatProductionElapsed, productionElapsedMs } from '@/lib/productionTiming';
import { hasLegacyAutomaticContinuity } from '@/lib/videoContinuity';

interface Step6Props {
  storyboards: Storyboard[];
  onBack: () => void;
  projectId: string;
  projectName?: string;
  companionSettings?: Partial<NonNullable<AppSettings['comfyui']>>;
  aspectRatio?: StoryAspectRatio;
  autoExportRequestId?: number;
  onAutoExportComplete?: (result: VideoEditorExportResult) => void;
  onAutoExportError?: (error: unknown) => void;
  downloadAfterExport?: boolean;
  productionTiming?: ProjectProductionTiming;
}

export default function Step6({
  storyboards,
  onBack,
  projectId,
  projectName,
  companionSettings,
  aspectRatio = '16:9',
  autoExportRequestId,
  onAutoExportComplete,
  onAutoExportError,
  downloadAfterExport = true,
  productionTiming,
}: Step6Props) {
  const outdated = storyboards.filter(item => item.videoUrl && hasLegacyAutomaticContinuity(item));
  const seenSegments = new Set<string>();
  const completedShots = storyboards
    .map((storyboard, originalIndex) => ({ storyboard, originalIndex }))
    .filter(({ storyboard }) => {
      if (storyboard.videoStatus !== 'completed' || !storyboard.videoUrl) return false;
      const key = storyboard.videoSegmentId || storyboard.id;
      if (seenSegments.has(key)) return false;
      seenSegments.add(key);
      return true;
    });
  const videoUrls = completedShots.map(({ storyboard }) => storyboard.videoUrl as string);
  const expectedCompletedSegments = new Set(
    storyboards.filter(item => item.videoStatus === 'completed').map(item => item.videoSegmentId || item.id),
  ).size;
  const missingCompletedSegments = Math.max(0, expectedCompletedSegments - completedShots.length);
  const rejectedAutoExportRef = useRef<number>();
  useEffect(() => {
    if (!autoExportRequestId || !missingCompletedSegments || rejectedAutoExportRef.current === autoExportRequestId) return;
    rejectedAutoExportRef.current = autoExportRequestId;
    onAutoExportError?.(new Error(`导出前缺少 ${missingCompletedSegments} 个已完成片段的视频文件，拒绝生成不完整成片`));
  }, [autoExportRequestId, missingCompletedSegments, onAutoExportError]);
  const storyboardById = new Map(storyboards.map(item => [item.id, item]));
  const storyboardGroups = completedShots.map(({ storyboard }) => {
    const memberIds = storyboard.videoSegmentStoryboardIds?.length
      ? storyboard.videoSegmentStoryboardIds
      : [storyboard.id];
    return memberIds.map(id => storyboardById.get(id)).filter((item): item is Storyboard => Boolean(item));
  });
  const continuousFromPrevious = completedShots.map(({ storyboard }, index) => {
    if (index === 0 || storyboard.continuousFromPrev !== true) return false;
    // Motion Context already removes its reconstructed AV head in ComfyUI.
    // Applying the legacy browser trims again would discard new content and
    // cut the previous clip a second time.
    if ((storyboard.videoContinuitySegmentIndex ?? 0) > 0) return false;
    const previous = completedShots[index - 1].storyboard;
    const previousMembers = previous.videoSegmentStoryboardIds?.length
      ? previous.videoSegmentStoryboardIds
      : [previous.id];
    const previousLast = storyboards.find(item => item.id === previousMembers.at(-1));
    return previousLast?.sceneNumber === storyboard.sceneNumber - 1;
  });

  return (
    <div className="h-full flex flex-col">
      <div className="border-l-4 border-[var(--accent-purple)] pl-4 mb-4">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">06.</span> Edit & Export
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Edit, trim, and export your final video. 连贯镜头会在运动中交接，并自动裁掉上一段静止尾部与下一段起步帧。
        </p>
        {productionTiming && (
          <p className="mt-2 font-mono text-xs text-emerald-300">
            项目实际制作耗时：{formatProductionElapsed(productionElapsedMs(productionTiming))}
          </p>
        )}
      </div>

      {outdated.length > 0 ? (
        <p className="rounded-lg border border-amber-400/40 p-4 text-amber-300">镜 {outdated.map(item => item.sceneNumber).join('、')} 仍使用旧版自动接续首帧，请返回视频步骤重新生成后再合并，避免把错误场景混入成片。</p>
      ) : autoExportRequestId && missingCompletedSegments > 0 ? (
        <p className="rounded-lg border border-red-400/40 p-4 text-red-300">导出前缺少 {missingCompletedSegments} 个已完成片段的视频文件，已拒绝生成不完整成片；请等待系统从本地缓存恢复。</p>
      ) : videoUrls.length > 0 ? (
        <div className="flex-1 border border-[var(--border-color)] rounded overflow-hidden">
          <VideoEditor
            initialVideos={videoUrls}
            storyboardGroups={storyboardGroups}
            continuousFromPrevious={continuousFromPrevious}
            projectId={projectId}
            projectName={projectName}
            companionSettings={companionSettings}
            aspectRatio={aspectRatio}
            autoExportRequestId={autoExportRequestId}
            onAutoExportComplete={onAutoExportComplete}
            onAutoExportError={onAutoExportError}
            downloadAfterExport={downloadAfterExport}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
          No videos available to edit
        </div>
      )}

      <div className="flex justify-start pt-4 border-t border-[var(--border-color)] mt-4">
        <button onClick={onBack} className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2">
          <ArrowLeft size={16} /> Back
        </button>
      </div>
    </div>
  );
}
