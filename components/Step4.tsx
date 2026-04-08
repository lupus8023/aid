'use client';

import { Storyboard } from '@/types';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Download, Grid3x3 } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface Step4Props {
  storyboards: Storyboard[];
  onBack: () => void;
  onNext: () => void;
  onGenerateImage: (storyboard: Storyboard) => void;
  onRetry: (storyboard: Storyboard) => void;
  onUpdate?: (storyboard: Storyboard) => void;
  onGenerateGrid?: (storyboards: Storyboard[]) => void;
  isGeneratingGrid?: boolean;
}

export default function Step4({ storyboards, onBack, onNext, onGenerateImage, onRetry, onUpdate, onGenerateGrid, isGeneratingGrid }: Step4Props) {
  const completedCount = storyboards.filter(sb => sb.status === 'completed').length;

  const handleDownloadAll = async () => {
    const completed = storyboards.filter(sb => sb.status === 'completed' && sb.imageUrl);
    if (!completed.length) return;
    const zip = new JSZip();
    for (const sb of completed) {
      const res = await fetch(sb.imageUrl!);
      zip.file(`scene-${sb.sceneNumber}.png`, await res.blob());
    }
    saveAs(await zip.generateAsync({ type: 'blob' }), `images-${Date.now()}.zip`);
  };

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[var(--accent-yellow)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">04.</span> Generate Images
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm mb-3">
          Generate an image for each shot individually
        </p>
        {onGenerateGrid && (
          <button
            onClick={() => onGenerateGrid(storyboards)}
            disabled={isGeneratingGrid}
            className="flex items-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-yellow)] hover:bg-[#e6b800] text-black disabled:opacity-50 rounded transition-colors"
          >
            {isGeneratingGrid ? <><Loader2 size={12} className="animate-spin" /> Generating Grid...</> : <><Grid3x3 size={12} /> Batch Generate (3×3 Grid)</>}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {storyboards.map((sb) => {
          const aspectClass = sb.aspectRatio === '9:16' ? 'aspect-[9/16]' : sb.aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video';
          return (
          <div key={sb.id} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded overflow-hidden">
            {sb.imageUrl ? (
              <img src={sb.imageUrl} alt={`Scene ${sb.sceneNumber}`} className={`w-full ${aspectClass} object-cover`} />
            ) : (
              <div className={`w-full ${aspectClass} bg-[var(--bg-tertiary)] flex items-center justify-center`}>
                {sb.status === 'generating' ? (
                  <Loader2 size={24} className="text-[var(--accent-blue)] animate-spin" />
                ) : (
                  <span className="text-xs font-mono text-[var(--text-secondary)]">No image</span>
                )}
              </div>
            )}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-[var(--accent-yellow)]">Scene {sb.sceneNumber}</span>
                {sb.status === 'completed' && <CheckCircle2 size={14} className="text-[var(--success)]" />}
                {sb.status === 'failed' && <AlertCircle size={14} className="text-[var(--error)]" />}
              </div>
              <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-3">{sb.description}</p>
              {sb.status === 'completed' ? (
                <button
                  onClick={() => onRetry(sb)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
                >
                  <RefreshCw size={12} /> Regenerate
                </button>
              ) : (
                <button
                  onClick={() => sb.status === 'failed' ? onRetry(sb) : onGenerateImage(sb)}
                  disabled={sb.status === 'generating'}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#0098ff] text-white disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] rounded transition-colors"
                >
                  {sb.status === 'generating' ? (
                    <><Loader2 size={12} className="animate-spin" /> Generating...</>
                  ) : (
                    'Generate Image'
                  )}
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>

      <div className="flex justify-between pt-4 border-t border-[var(--border-color)]">
        <button onClick={onBack} className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2">
          <span>←</span> Back
        </button>
        <div className="flex gap-2">
          {completedCount > 0 && (
            <button onClick={handleDownloadAll} className="flex items-center gap-2 px-4 py-2.5 text-sm font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors">
              <Download size={14} /> Download All
            </button>
          )}
          <button
            onClick={onNext}
            disabled={completedCount === 0}
            className="bg-[var(--accent-green)] text-[var(--bg-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[#5dd18d] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            Next: Generate Videos →
          </button>
        </div>
      </div>
    </div>
  );
}
