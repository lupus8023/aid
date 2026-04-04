import { Storyboard, Character, ObjectItem } from '@/types';
import { useState } from 'react';

interface Step3Props {
  storyboards: Storyboard[];
  characters: Character[];
  objects: ObjectItem[];
  onBack: () => void;
  onNext: () => void;
  onUpdate?: (storyboard: Storyboard) => void;
}

export default function Step3({ storyboards, characters, objects, onBack, onNext, onUpdate }: Step3Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPrompt, setEditedPrompt] = useState('');

  const startEdit = (sb: Storyboard) => {
    setEditingId(sb.id);
    setEditedPrompt(sb.prompt);
  };

  const saveEdit = (sb: Storyboard) => {
    onUpdate?.({ ...sb, prompt: editedPrompt });
    setEditingId(null);
  };

  const getCharacterImage = (name: string) =>
    characters.find(c => c.name === name)?.imageUrl;

  const getObjectImage = (name: string) =>
    objects.find(o => o.name === name)?.imageUrl;

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[var(--accent-orange)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">03.</span> Shot Script
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Review and edit shot descriptions before generating images
        </p>
      </div>

      <div className="space-y-3">
        {storyboards.map((sb) => (
          <div key={sb.id} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-4 flex gap-4">
            {/* Left: content */}
            <div className="flex-1 min-w-0 w-2/3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-[var(--accent-yellow)]">Scene {sb.sceneNumber}</span>
                {editingId !== sb.id && (
                  <button onClick={() => startEdit(sb)} className="text-xs font-mono text-[var(--accent-blue)] hover:underline">
                    Edit
                  </button>
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

            {/* Right: character/object thumbnails - 1/3 width */}
            {((sb.characters?.length ?? 0) > 0 || (sb.objects?.length ?? 0) > 0) && (
              <div className="w-1/3 shrink-0 grid grid-cols-3 gap-1 content-start">
                {sb.characters?.map(name => {
                  const img = getCharacterImage(name);
                  return img ? (
                    <div key={name} className="relative group aspect-square">
                      <img src={img} alt={name} className="w-full h-full object-cover rounded border border-[var(--border-color)]" />
                      <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] font-mono bg-black/60 text-white rounded-b truncate px-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{name}</span>
                    </div>
                  ) : (
                    <div key={name} className="aspect-square flex items-center justify-center bg-[var(--bg-tertiary)] rounded border border-[var(--border-color)] text-[9px] font-mono text-[var(--text-secondary)] text-center p-0.5">{name}</div>
                  );
                })}
                {sb.objects?.map(name => {
                  const img = getObjectImage(name);
                  return img ? (
                    <div key={name} className="relative group aspect-square">
                      <img src={img} alt={name} className="w-full h-full object-cover rounded border border-[var(--accent-orange)]/40" />
                      <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] font-mono bg-black/60 text-white rounded-b truncate px-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{name}</span>
                    </div>
                  ) : (
                    <div key={name} className="aspect-square flex items-center justify-center bg-[var(--bg-tertiary)] rounded border border-[var(--accent-orange)]/40 text-[9px] font-mono text-[var(--text-secondary)] text-center p-0.5">{name}</div>
                  );
                })}
              </div>
            )}
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
