import CharacterUpload from './CharacterUpload';
import ObjectUpload from './ObjectUpload';
import { Character, ObjectItem, VisualStyle } from '@/types';
import { PRODUCTION_STYLE_PRESETS } from '@/lib/promptArchitecture';

interface Step2Props {
  characters: Character[];
  objects: ObjectItem[];
  onCharactersChange: (characters: Character[]) => void;
  onObjectsChange: (objects: ObjectItem[]) => void;
  onBack: () => void;
  onNext: () => void;
  isLoading: boolean;
  visualStyle: VisualStyle;
  onVisualStyleChange: (style: VisualStyle) => void;
}

export default function Step2({ characters, objects, onCharactersChange, onObjectsChange, onBack, onNext, isLoading, visualStyle, onVisualStyleChange }: Step2Props) {
  return (
    <div className="space-y-6">
      <div className="aid-page-lead">
        <div><p className="aid-eyebrow">Step 01 · Source library</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">建立角色与关键物件</h2><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">先锁定角色外观、声音与核心物件，后续分镜会持续复用这些参考。</p></div>
        <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">{characters.length} 角色 · {objects.length} 物件</span>
      </div>

      <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 md:p-5">
        <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="aid-eyebrow">Production style bible</p>
            <h3 className="mt-1 text-lg font-semibold text-white">选择全片制作风格</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">这里选择的是整套画面、摄影机和剪辑语言，会同时约束角色、场景、分镜图与 H3 视频。</p>
          </div>
          <span className="font-mono text-[10px] text-[var(--accent-blue)]">全项目唯一风格源</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          {PRODUCTION_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => onVisualStyleChange(preset.value)}
              aria-pressed={visualStyle === preset.value}
              className={`min-h-24 rounded-lg border p-3 text-left transition-colors ${visualStyle === preset.value ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/12' : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] hover:border-[var(--accent-blue)]/60'}`}
            >
              <span className={`block text-sm font-semibold ${visualStyle === preset.value ? 'text-white' : 'text-[var(--text-primary)]'}`}>{preset.label}</span>
              <span className="mt-1 block text-[10px] leading-4 text-[var(--text-secondary)]">{preset.description}</span>
            </button>
          ))}
        </div>
      </section>

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
