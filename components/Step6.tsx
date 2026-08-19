import VideoEditor from './video-editor/VideoEditor';
import { Storyboard } from '@/types';
import { ArrowLeft } from 'lucide-react';
import type { AppSettings } from '@/types';

interface Step6Props {
  storyboards: Storyboard[];
  onBack: () => void;
  projectId: string;
  projectName?: string;
  companionSettings?: Partial<NonNullable<AppSettings['comfyui']>>;
}

export default function Step6({ storyboards, onBack, projectId, projectName, companionSettings }: Step6Props) {
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
  const continuousFromPrevious = completedShots.map(({ storyboard }, index) => {
    if (index === 0 || storyboard.continuousFromPrev !== true) return false;
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
      </div>

      {videoUrls.length > 0 ? (
        <div className="flex-1 border border-[var(--border-color)] rounded overflow-hidden">
          <VideoEditor
            initialVideos={videoUrls}
            continuousFromPrevious={continuousFromPrevious}
            projectId={projectId}
            projectName={projectName}
            companionSettings={companionSettings}
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
