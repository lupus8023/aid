'use client';

import { useState } from 'react';
import { Storyboard } from '@/types';
import { CheckCircle2, Loader2, Video, Wand2 } from 'lucide-react';

interface Step5Props {
  storyboards: Storyboard[];
  onBack: () => void;
  onNext: () => void;
  onGenerateVideo: (storyboard: Storyboard) => void;
  onGenerateVideoPrompt?: (storyboard: Storyboard) => void;
  onUpdate?: (storyboard: Storyboard) => void;
}

export default function Step5({ storyboards, onBack, onNext, onGenerateVideo, onGenerateVideoPrompt, onUpdate }: Step5Props) {
  const completedCount = storyboards.filter(sb => sb.videoStatus === 'completed').length;
  const withImages = storyboards.filter(sb => sb.imageUrl);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPrompt, setEditedPrompt] = useState('');

  const handleAudioUpload = (sb: Storyboard, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onUpdate?.({ ...sb, audioFile: ev.target?.result as string });
    reader.readAsDataURL(file);
  };

  const startEdit = (sb: Storyboard) => {
    setEditingId(sb.id);
    setEditedPrompt(sb.videoPrompt || '');
  };

  const saveEdit = (sb: Storyboard) => {
    onUpdate?.({ ...sb, videoPrompt: editedPrompt });
    setEditingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[var(--accent-purple)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">05.</span> Generate Videos
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Generate a video for each shot from its image
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {withImages.map((sb) => (
          <div key={sb.id} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded overflow-hidden">
            {sb.videoUrl ? (
              <video src={sb.videoUrl} className="w-full aspect-video object-cover" controls muted />
            ) : (
              <img src={sb.imageUrl} alt={`Scene ${sb.sceneNumber}`} className="w-full aspect-video object-cover opacity-60" />
            )}
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[var(--accent-yellow)]">Scene {sb.sceneNumber}</span>
                {sb.videoStatus === 'completed' && <CheckCircle2 size={14} className="text-[var(--success)]" />}
              </div>

              {/* Video Prompt */}
              {editingId === sb.id ? (
                <div className="space-y-1">
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    className="w-full h-20 p-2 bg-[var(--bg-primary)] border border-[var(--accent-blue)] rounded text-xs font-mono text-[var(--text-primary)] resize-none focus:outline-none"
                  />
                  <div className="flex gap-1">
                    <button onClick={() => saveEdit(sb)} className="px-2 py-1 text-xs font-mono bg-[var(--accent-green)] text-[var(--bg-primary)] rounded">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs font-mono bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="group relative">
                  <p className="text-xs font-mono text-[var(--text-secondary)] line-clamp-2 pr-8">
                    {sb.videoPrompt === 'generating...' ? (
                      <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Generating...</span>
                    ) : sb.videoPrompt ? sb.videoPrompt : (
                      <span className="italic">No video prompt</span>
                    )}
                  </p>
                  <div className="absolute top-0 right-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onGenerateVideoPrompt?.(sb)} className="text-xs font-mono text-[var(--accent-purple)] hover:underline flex items-center gap-0.5">
                      <Wand2 size={10} /> {sb.videoPrompt ? 'Regen' : 'Gen'}
                    </button>
                    <button onClick={() => startEdit(sb)} className="text-xs font-mono text-[var(--accent-blue)] hover:underline">
                      Edit
                    </button>
                  </div>
                </div>
              )}

              {/* Duration */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[var(--text-secondary)]">Duration:</span>
                <input
                  type="number"
                  min={5}
                  max={15}
                  value={sb.videoDuration ?? 5}
                  onChange={(e) => onUpdate?.({ ...sb, videoDuration: Math.min(15, Math.max(5, Number(e.target.value))) })}
                  className="w-16 px-2 py-1 text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                />
                <span className="text-xs font-mono text-[var(--text-secondary)]">s</span>
              </div>

              {/* Audio Upload */}
              <input type="file" accept="audio/*" onChange={(e) => handleAudioUpload(sb, e)} className="hidden" id={`audio-${sb.id}`} />
              <label htmlFor={`audio-${sb.id}`} className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded cursor-pointer">
                🎵 {sb.audioFile ? 'Audio ✓' : 'Upload Audio'}
              </label>

              <button
                onClick={() => onGenerateVideo(sb)}
                disabled={sb.videoStatus === 'generating'}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-purple)] hover:bg-[#9b59b6] text-white disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] rounded transition-colors"
              >
                {sb.videoStatus === 'generating' ? (
                  <><Loader2 size={12} className="animate-spin" /> Generating...</>
                ) : (
                  <><Video size={12} /> {sb.videoUrl ? 'Regenerate' : 'Generate Video'}</>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between pt-4 border-t border-[var(--border-color)]">
        <button onClick={onBack} className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2">
          <span>←</span> Back
        </button>
        <button
          onClick={onNext}
          disabled={completedCount === 0}
          className="bg-[var(--accent-green)] text-[var(--bg-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[#5dd18d] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          Next: Edit & Export →
        </button>
      </div>
    </div>
  );
}
