import VideoEditor from './video-editor/VideoEditor';
import { Storyboard } from '@/types';
import { ArrowLeft } from 'lucide-react';

interface Step6Props {
  storyboards: Storyboard[];
  onBack: () => void;
}

export default function Step6({ storyboards, onBack }: Step6Props) {
  const videoUrls = storyboards
    .filter(sb => sb.videoStatus === 'completed' && sb.videoUrl)
    .map(sb => sb.videoUrl as string);

  return (
    <div className="h-full flex flex-col">
      <div className="border-l-4 border-[var(--accent-purple)] pl-4 mb-4">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">06.</span> Edit & Export
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Edit, trim, and export your final video
        </p>
      </div>

      {videoUrls.length > 0 ? (
        <div className="flex-1 border border-[var(--border-color)] rounded overflow-hidden">
          <VideoEditor initialVideos={videoUrls} />
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
