import StoryboardList from './StoryboardList';
import { Storyboard } from '@/types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Download, Edit } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Step4Props {
  storyboards: Storyboard[];
  isGenerating: boolean;
  onBack: () => void;
  onRetry?: (storyboard: Storyboard) => void;
  onGenerateVideo?: (storyboard: Storyboard) => void;
  onUpdate?: (storyboard: Storyboard) => void;
  onNext?: () => void;
}

export default function Step4({ storyboards, isGenerating, onBack, onRetry, onGenerateVideo, onUpdate, onNext }: Step4Props) {
  const router = useRouter();
  const completedCount = storyboards.filter(sb => sb.status === 'completed').length;
  const totalCount = storyboards.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleDownloadAll = async () => {
    const completedStoryboards = storyboards.filter(sb => sb.status === 'completed' && sb.imageUrl);

    if (completedStoryboards.length === 0) {
      alert('No completed images to download');
      return;
    }

    try {
      const zip = new JSZip();

      // Fetch all images and add to zip
      for (const storyboard of completedStoryboards) {
        if (!storyboard.imageUrl) continue;

        const response = await fetch(storyboard.imageUrl);
        const blob = await response.blob();
        zip.file(`scene-${storyboard.sceneNumber}.png`, blob);
      }

      // Generate zip file
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `storyboard-${Date.now()}.zip`);
    } catch (error) {
      console.error('Download all failed:', error);
      alert('Failed to download images');
    }
  };

  const handleDownloadAllVideos = async () => {
    console.log('=== Download All Videos ===');
    console.log('Total storyboards:', storyboards.length);

    const completedVideos = storyboards.filter(sb => sb.videoStatus === 'completed' && sb.videoUrl);
    console.log('Completed videos:', completedVideos.length);
    console.log('Video details:', completedVideos.map(sb => ({
      scene: sb.sceneNumber,
      status: sb.videoStatus,
      hasUrl: !!sb.videoUrl
    })));

    if (completedVideos.length === 0) {
      alert('No completed videos to download');
      return;
    }

    try {
      const zip = new JSZip();

      // Fetch all videos and add to zip
      for (const storyboard of completedVideos) {
        if (!storyboard.videoUrl) continue;

        console.log(`Fetching video for scene ${storyboard.sceneNumber}...`);
        const response = await fetch(storyboard.videoUrl);
        const blob = await response.blob();
        zip.file(`scene-${storyboard.sceneNumber}.mp4`, blob);
        console.log(`Added scene ${storyboard.sceneNumber} to zip`);
      }

      // Generate zip file
      console.log('Generating zip file...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `storyboard-videos-${Date.now()}.zip`);
      console.log('Download started');
    } catch (error) {
      console.error('Download all videos failed:', error);
      alert('Failed to download videos');
    }
  };

  const handleEditAllVideos = () => {
    const completedVideos = storyboards
      .filter(sb => sb.videoStatus === 'completed' && sb.videoUrl)
      .map(sb => sb.videoUrl);

    if (completedVideos.length === 0) {
      alert('No completed videos to edit');
      return;
    }

    const videos = JSON.stringify(completedVideos);
    router.push(`/editor?videos=${encodeURIComponent(videos)}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-l-4 border-[var(--accent-yellow)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">04.</span> Render Pipeline
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          AI image generation in progress
        </p>
      </div>

      {/* Progress Bar */}
      {isGenerating && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] p-4 rounded">
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-sm text-[var(--text-secondary)]">
              <span className="text-[var(--accent-yellow)]">status:</span> rendering
            </span>
            <span className="font-mono text-sm text-[var(--accent-blue)]">
              {completedCount} / {totalCount}
            </span>
          </div>
          <div className="w-full bg-[var(--bg-primary)] rounded h-2 overflow-hidden">
            <div
              className="bg-[var(--accent-blue)] h-2 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <StoryboardList storyboards={storyboards} onRetry={onRetry} onGenerateVideo={onGenerateVideo} onUpdate={onUpdate} />

      {/* Completion Message */}
      {!isGenerating && completedCount === totalCount && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--accent-green)] p-4 rounded">
          <div className="flex items-center justify-between">
            <p className="text-[var(--accent-green)] font-mono text-sm flex items-center gap-2">
              <span>✓</span>
              <span>All scenes rendered successfully</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDownloadAll}
                className="flex items-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#5dd18d] text-[var(--bg-primary)] rounded transition-colors"
              >
                <Download size={14} />
                Download All Images
              </button>
              <button
                onClick={handleDownloadAllVideos}
                className="flex items-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-purple)] hover:bg-[#9b59b6] text-white rounded transition-colors"
              >
                <Download size={14} />
                Download All Videos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t border-[var(--border-color)]">
        <button
          onClick={onBack}
          disabled={isGenerating}
          className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] disabled:bg-[var(--bg-primary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          <span>←</span>
          <span>Back</span>
        </button>
        {onNext && completedCount === totalCount && totalCount > 0 && (
          <button
            onClick={onNext}
            className="bg-[var(--accent-blue)] text-white px-6 py-2.5 rounded font-mono text-sm hover:bg-[#006bb3] transition-colors flex items-center gap-2"
          >
            <span>Edit Videos</span>
            <span>→</span>
          </button>
        )}
      </div>
    </div>
  );
}
