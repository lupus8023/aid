import CharacterUpload from './CharacterUpload';
import ObjectUpload from './ObjectUpload';
import StoryUpload from './StoryUpload';
import { Character, ObjectItem } from '@/types';

interface Step1Props {
  characters: Character[];
  objects: ObjectItem[];
  storyContent: string;
  onCharactersChange: (characters: Character[]) => void;
  onObjectsChange: (objects: ObjectItem[]) => void;
  onStoryLoad: (content: string) => void;
  onNext: () => void;
  isLoading: boolean;
}

export default function Step1({
  characters,
  objects,
  storyContent,
  onCharactersChange,
  onObjectsChange,
  onStoryLoad,
  onNext,
  isLoading
}: Step1Props) {
  const canProceed = characters.length > 0 && storyContent.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-l-4 border-[var(--accent-blue)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">01.</span> Initialize Project
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Upload character references, objects (optional), and story script
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <CharacterUpload onCharactersChange={onCharactersChange} />
        <ObjectUpload onObjectsChange={onObjectsChange} />
      </div>

      <div className="mb-6">
        <StoryUpload onStoryLoad={onStoryLoad} />
      </div>

      <div className="flex justify-end pt-4 border-t border-[var(--border-color)]">
        <button
          onClick={onNext}
          disabled={!canProceed || isLoading}
          className="bg-[var(--accent-blue)] text-white px-6 py-2.5 rounded font-mono text-sm hover:bg-[#0098ff] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <span className="animate-pulse">⚡</span>
              <span>Generating outline...</span>
            </>
          ) : (
            <>
              <span>Next: Generate Outline</span>
              <span>→</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
