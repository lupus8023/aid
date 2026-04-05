import CharacterUpload from './CharacterUpload';
import ObjectUpload from './ObjectUpload';
import { Character, ObjectItem } from '@/types';

interface Step2Props {
  characters: Character[];
  objects: ObjectItem[];
  onCharactersChange: (characters: Character[]) => void;
  onObjectsChange: (objects: ObjectItem[]) => void;
  onBack: () => void;
  onNext: () => void;
  isLoading: boolean;
}

export default function Step2({ characters, objects, onCharactersChange, onObjectsChange, onBack, onNext, isLoading }: Step2Props) {
  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[var(--accent-green)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">01.</span> Characters & Objects
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Upload character references and optional objects
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CharacterUpload onCharactersChange={onCharactersChange} />
        <ObjectUpload onObjectsChange={onObjectsChange} />
      </div>

      <div className="flex justify-between pt-4 border-t border-[var(--border-color)]">
        <button
          onClick={onBack}
          className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2"
        >
          <span>←</span> Back
        </button>
        <button
          onClick={onNext}
          disabled={characters.length === 0 || isLoading}
          className="bg-[var(--accent-blue)] text-white px-6 py-2.5 rounded font-mono text-sm hover:bg-[#0098ff] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isLoading ? (
            <><span className="animate-pulse">⚡</span><span>Generating script...</span></>
          ) : (
            <><span>Next: Generate Script</span><span>→</span></>
          )}
        </button>
      </div>
    </div>
  );
}
