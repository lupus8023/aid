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
      <div className="aid-page-lead">
        <div><p className="aid-eyebrow">Step 01 · Source library</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">建立角色与关键物件</h2><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">先锁定角色外观、声音与核心物件，后续分镜会持续复用这些参考。</p></div>
        <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">{characters.length} 角色 · {objects.length} 物件</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CharacterUpload onCharactersChange={onCharactersChange} />
        <ObjectUpload onObjectsChange={onObjectsChange} />
      </div>

      <div className="sticky bottom-0 z-10 flex justify-between border-t border-[var(--border-color)] bg-[var(--bg-primary)]/95 py-4 backdrop-blur">
        <button
          onClick={onBack}
          className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2"
        >
          <span>←</span> 返回
        </button>
        <button
          onClick={onNext}
          disabled={characters.length === 0 || isLoading}
          className="bg-[var(--accent-blue)] text-white px-6 py-2.5 rounded font-mono text-sm hover:bg-[#0098ff] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isLoading ? (
            <><span className="animate-pulse">⚡</span><span>正在生成剧本…</span></>
          ) : (
            <><span>下一步：输入故事</span><span>→</span></>
          )}
        </button>
      </div>
    </div>
  );
}
