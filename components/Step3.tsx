'use client';

import { useState } from 'react';
import { Storyboard, Character, ObjectItem } from '@/types';
import { Loader2, RefreshCw, ZoomIn, X } from 'lucide-react';

interface Step3Props {
  storyboards: Storyboard[];
  characters: Character[];
  objects: ObjectItem[];
  costumeImages: Record<string, string>;
  costumeGenerating: Record<string, boolean>;
  sceneImage: string;
  sceneImages: string[];
  sceneGenerating: boolean;
  onBack: () => void;
  onNext: () => void;
  onUpdate?: (storyboard: Storyboard) => void;
  onGenerateCostume?: (type: 'costume' | 'scene', characterName?: string) => void;
  onClearCostumeImage?: (characterName: string) => void;
  onClearSceneImage?: (idx: number) => void;
}

function ImageThumb({ src, label, generating, onGenerate, onClear }: {
  src?: string; label: string; generating?: boolean; onGenerate: () => void; onClear?: () => void;
}) {
  const [lightbox, setLightbox] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="relative group aspect-square bg-[var(--bg-tertiary)] rounded border border-[var(--border-color)] overflow-hidden">
          {src ? (
            <>
              <img src={src} alt={label} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                <button onClick={() => setLightbox(true)} className="p-1 bg-white/20 rounded hover:bg-white/40"><ZoomIn size={12} /></button>
                <button onClick={onGenerate} className="p-1 bg-white/20 rounded hover:bg-white/40"><RefreshCw size={12} /></button>
                {onClear && <button onClick={onClear} className="p-1 bg-white/20 rounded hover:bg-white/40"><X size={12} /></button>}
              </div>
            </>
          ) : generating ? (
            <div className="w-full h-full flex items-center justify-center"><Loader2 size={16} className="animate-spin text-[var(--accent-blue)]" /></div>
          ) : (
            <button onClick={onGenerate} className="w-full h-full flex flex-col items-center justify-center gap-1 text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors">
              <span className="text-xl">+</span>
            </button>
          )}
        </div>
        <span className="text-[9px] font-mono text-[var(--text-secondary)] text-center truncate">{label}</span>
      </div>
      {lightbox && src && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={() => setLightbox(false)}>
          <button className="absolute top-4 right-4 text-white"><X size={24} /></button>
          <img src={src} alt={label} className="max-w-[90vw] max-h-[90vh] object-contain rounded" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

export default function Step3({ storyboards, characters, objects, costumeImages, costumeGenerating, sceneImages, sceneGenerating, onBack, onNext, onUpdate, onGenerateCostume, onClearCostumeImage, onClearSceneImage }: Step3Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [draggingScene, setDraggingScene] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const startEdit = (sb: Storyboard) => { setEditingId(sb.id); setEditedPrompt(sb.prompt); };
  const saveEdit = (sb: Storyboard) => { onUpdate?.({ ...sb, prompt: editedPrompt }); setEditingId(null); };
  const getObject = (name: string) => objects.find(o => o.name === name);

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[var(--accent-orange)] pl-4 mb-6">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">03.</span> Shot Script
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Generate costume & scene references, then review shots
        </p>
      </div>

      {/* Global costume/scene reference panel */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-4">
        <p className="text-xs font-mono text-[var(--text-secondary)] mb-3">Global References — generated once, applied to all shots</p>
        <div className="flex gap-3 flex-wrap">
          {characters.map(char => (
            <div key={char.name} className="w-20">
              <ImageThumb
                src={costumeImages[char.name]}
                label={char.name}
                generating={costumeGenerating[char.name]}
                onGenerate={() => onGenerateCostume?.('costume', char.name)}
                onClear={() => onClearCostumeImage?.(char.name)}
              />
            </div>
          ))}
          {/* Multiple scene images */}
          {sceneImages.map((src, idx) => (
            <div key={idx} className="w-20">
              <div className="flex flex-col gap-1">
                <div
                  className="relative group aspect-square bg-[var(--bg-tertiary)] rounded border border-[var(--border-color)] overflow-hidden cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={() => setDraggingScene(src)}
                  onDragEnd={() => setDraggingScene(null)}
                >
                  <img src={src} alt={`Scene ${idx + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    <button onClick={() => onClearSceneImage?.(idx)} className="p-1 bg-white/20 rounded hover:bg-white/40"><X size={12} /></button>
                  </div>
                </div>
                <span className="text-[9px] font-mono text-[var(--text-secondary)] text-center truncate">Scene {idx + 1}</span>
              </div>
            </div>
          ))}
          {/* Add new scene button */}
          <div className="w-20">
            <ImageThumb
              src={undefined}
              label="+ Scene"
              generating={sceneGenerating}
              onGenerate={() => onGenerateCostume?.('scene')}
            />
          </div>
          {objects.map(obj => obj.imageUrl ? (
            <div key={obj.name} className="w-20 flex flex-col gap-1">
              <div className="aspect-square rounded border border-[var(--accent-orange)]/40 overflow-hidden">
                <img src={obj.imageUrl} alt={obj.name} className="w-full h-full object-cover" />
              </div>
              <span className="text-[9px] font-mono text-[var(--text-secondary)] text-center truncate">{obj.name}</span>
            </div>
          ) : null)}
        </div>
      </div>

      {/* Shot list */}
      <div className="space-y-3">
        {storyboards.map((sb) => (
          <div key={sb.id} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-4 flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-[var(--accent-yellow)]">Scene {sb.sceneNumber}</span>
                {editingId !== sb.id && (
                  <button onClick={() => startEdit(sb)} className="text-xs font-mono text-[var(--accent-blue)] hover:underline">Edit</button>
                )}
              </div>
              <p className="text-sm text-[var(--text-primary)] mb-2">{sb.description}</p>
              {editingId === sb.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    className="w-full h-24 p-2 bg-[var(--bg-primary)] border border-[var(--accent-blue)] rounded text-xs font-mono text-[var(--text-primary)] resize-none focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(sb)} className="px-3 py-1 text-xs font-mono bg-[var(--accent-green)] text-[var(--bg-primary)] rounded">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs font-mono bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded">Cancel</button>
                  </div>
                </div>
              ) : (
                <p className="text-xs font-mono text-[var(--text-secondary)] line-clamp-2">{sb.prompt}</p>
              )}
            </div>

            {/* Right: show which references apply to this shot */}
            <div className="w-1/3 shrink-0">
              <p className="text-[9px] font-mono text-[var(--text-secondary)] mb-1">This shot uses</p>
              <div
                className={`grid grid-cols-3 gap-1 min-h-[40px] rounded border-2 border-dashed transition-colors ${dragOverId === sb.id ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10' : 'border-transparent'}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverId(sb.id); }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverId(null);
                  if (draggingScene) onUpdate?.({ ...sb, sceneImageOverride: draggingScene });
                }}
              >
                {sb.characters?.map(name => (
                  <div key={name} className="relative group aspect-square rounded border border-[var(--border-color)] overflow-hidden bg-[var(--bg-tertiary)]">
                    {costumeImages[name] ? (
                      <img src={costumeImages[name]} alt={name} className="w-full h-full object-cover" />
                    ) : characters.find(c => c.name === name)?.imageUrl ? (
                      <img src={characters.find(c => c.name === name)!.imageUrl} alt={name} className="w-full h-full object-cover opacity-40" />
                    ) : null}
                    <span className="absolute bottom-0 left-0 right-0 text-[9px] font-mono bg-black/60 text-white text-center truncate px-0.5">{name}</span>
                  </div>
                ))}
                {/* Per-shot scene override or fallback to first global scene */}
                {(sb.sceneImageOverride || sceneImages[0]) && (
                  <div className="relative aspect-square rounded border border-[var(--accent-blue)]/40 overflow-hidden">
                    <img src={sb.sceneImageOverride || sceneImages[0]} alt="Scene" className="w-full h-full object-cover" />
                    {sb.sceneImageOverride && (
                      <button
                        onClick={() => onUpdate?.({ ...sb, sceneImageOverride: undefined })}
                        className="absolute top-0 right-0 p-0.5 bg-black/60 text-white hover:bg-red-500/80"
                      ><X size={8} /></button>
                    )}
                  </div>
                )}
                {sb.objects?.map(name => {
                  const obj = getObject(name);
                  return obj?.imageUrl ? (
                    <div key={name} className="aspect-square rounded border border-[var(--accent-orange)]/40 overflow-hidden">
                      <img src={obj.imageUrl} alt={name} className="w-full h-full object-cover" />
                    </div>
                  ) : null;
                })}
              </div>
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
          disabled={storyboards.length === 0}
          className="bg-[var(--accent-green)] text-[var(--bg-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[#5dd18d] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          Next: Generate Images →
        </button>
      </div>
    </div>
  );
}
