'use client';

import { useEffect, useState } from 'react';
import { Tldraw, Editor, TLShape, createShapeId, Box } from 'tldraw';
import 'tldraw/tldraw.css';
import { Storyboard } from '@/types';
import { X, Play } from 'lucide-react';

interface CanvasModeProps {
  storyboards: Storyboard[];
  onUpdate?: (storyboard: Storyboard) => void;
  onGenerateImage?: (storyboard: Storyboard) => void;
  onGenerateVideoPrompt?: (storyboard: Storyboard) => string | undefined | Promise<string | undefined>;
  onGenerateAudio?: (storyboard: Storyboard) => void;
  onGenerateVideo?: (storyboard: Storyboard) => void;
}

export default function CanvasModeTldraw({ storyboards }: CanvasModeProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selectedStoryboard, setSelectedStoryboard] = useState<Storyboard | null>(null);
  const [previewVideo, setPreviewVideo] = useState<string | null>(null);

  useEffect(() => {
    if (!editor || storyboards.length === 0) return;

    const shapes: TLShape[] = [];
    storyboards.forEach((sb, index) => {
      const x = 100 + (index % 3) * 400;
      const y = 100 + Math.floor(index / 3) * 350;

      // Create card shape for each storyboard
      shapes.push({
        id: createShapeId(`scene-${sb.id}`),
        type: 'geo',
        x,
        y,
        props: {
          w: 350,
          h: 300,
          geo: 'rectangle',
          color: 'blue',
          labelColor: 'black',
          fill: 'solid',
          text: `Scene ${sb.sceneNumber}\n\n${sb.description.slice(0, 100)}...`,
        },
        meta: {
          storyboardId: sb.id,
          imageUrl: sb.imageUrl,
          videoUrl: sb.videoUrl,
        },
      } as any);
    });

    editor.createShapes(shapes);
    editor.zoomToFit({ animation: { duration: 400 } });
  }, [editor, storyboards]);

  const handleEditorMount = (newEditor: Editor) => {
    setEditor(newEditor);
  };

  return (
    <>
      <div className="h-full w-full relative">
        <Tldraw
          onMount={handleEditorMount}
          components={{
            ContextMenu: null,
            ActionsMenu: null,
            HelpMenu: null,
            ZoomMenu: null,
            MainMenu: null,
            Minimap: null,
            StylePanel: null,
            PageMenu: null,
            NavigationPanel: null,
            Toolbar: null,
            KeyboardShortcutsDialog: null,
            QuickActions: null,
            HelperButtons: null,
            DebugPanel: null,
            DebugMenu: null,
            SharePanel: null,
            MenuPanel: null,
            TopPanel: null,
          }}
        />

        {selectedStoryboard && (
          <div className="absolute top-4 right-4 w-80 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl p-4 z-50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-mono text-[var(--text-primary)]">Scene {selectedStoryboard.sceneNumber}</h3>
              <button onClick={() => setSelectedStoryboard(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X size={14} />
              </button>
            </div>
            {selectedStoryboard.imageUrl && (
              <img src={selectedStoryboard.imageUrl} alt="" className="w-full aspect-video object-cover rounded mb-3" />
            )}
            <p className="text-xs text-[var(--text-secondary)] mb-3 line-clamp-3">{selectedStoryboard.description}</p>
            {selectedStoryboard.videoUrl && (
              <button
                onClick={() => setPreviewVideo(selectedStoryboard.videoUrl!)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-green)] text-white rounded"
              >
                <Play size={12} />
                Preview Video
              </button>
            )}
          </div>
        )}
      </div>

      {previewVideo && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80" onClick={() => setPreviewVideo(null)}>
          <div className="relative flex h-full w-full items-center justify-center p-6" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewVideo(null)} className="absolute right-6 top-6 text-white hover:text-[var(--accent-blue)]">
              <X size={24} />
            </button>
            <video src={previewVideo} controls autoPlay className="max-h-full max-w-full rounded border border-white/20" />
          </div>
        </div>
      )}
    </>
  );
}
