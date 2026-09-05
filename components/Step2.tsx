import CharacterUpload from './CharacterUpload';
import ObjectUpload from './ObjectUpload';
import { CapturePreset, Character, ObjectItem, VisualStyle } from '@/types';
import { PRODUCTION_STYLE_PRESETS } from '@/lib/promptArchitecture';
import { CAPTURE_PRESETS } from '@/lib/capturePresets';
import { buildImageStyleControls } from '@/lib/imageStyleControls';

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
  capturePreset: CapturePreset;
  onCapturePresetChange: (preset: CapturePreset) => void;
}

export default function Step2({ characters, objects, onCharactersChange, onObjectsChange, onBack, onNext, isLoading, visualStyle, onVisualStyleChange, capturePreset, onCapturePresetChange }: Step2Props) {
  const currentStyle = PRODUCTION_STYLE_PRESETS.find((preset) => preset.value === visualStyle) ?? PRODUCTION_STYLE_PRESETS[0];
  const currentCapture = CAPTURE_PRESETS.find((preset) => preset.value === capturePreset) ?? CAPTURE_PRESETS[0];

  return (
    <div className="space-y-6">
      <div className="aid-page-lead">
        <div><p className="aid-eyebrow">Step 01 · Source library</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">建立角色与关键物件</h2><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">先锁定角色外观、声音与核心物件，后续分镜会持续复用这些参考。</p></div>
        <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">{characters.length} 角色 · {objects.length} 物件</span>
      </div>

      <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3.5 md:px-5">
        <p className="mb-3 text-xs leading-5 text-[var(--text-secondary)]">MJ 定稿后建议两项都选“跟随参考”，保留原图审美；主动选择其他风格或拍摄方式会应用到新分镜，不改变人物身份与产品设计。切换不会自动付费重做。</p>
        <details className="mb-3 text-xs text-[var(--text-secondary)]"><summary>查看生图风格与拍摄提示词</summary><pre className="mt-2 whitespace-pre-wrap break-words">{buildImageStyleControls({ visualStyle, capturePreset, hasCharacterReference: characters.some(character => !!character.imageUrl) }) || '沿用参考图，不额外叠加风格。'}</pre></details>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
          <div className="shrink-0 lg:w-64">
            <div className="flex items-center justify-between gap-3 lg:block">
              <h3 className="text-sm font-semibold text-white">全片制作风格</h3>
              <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--accent-blue)]">Style bible</span>
            </div>
            <p className="mt-1 truncate text-xs text-[var(--text-secondary)]" title={currentStyle.description}>
              <span className="text-[var(--text-primary)]">{currentStyle.label}</span>
              <span className="mx-1.5 text-[var(--border-color)]">/</span>
              {currentStyle.description}
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="选择全片制作风格"
            className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-1 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {PRODUCTION_STYLE_PRESETS.map((preset) => {
              const isSelected = visualStyle === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => onVisualStyleChange(preset.value)}
                  title={preset.description}
                  style={isSelected ? { backgroundColor: 'rgba(var(--workspace-accent-rgb), 0.12)' } : undefined}
                  className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-2 text-xs font-medium transition-colors active:translate-y-px ${isSelected ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]' : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--accent-blue)]/60 hover:text-[var(--text-primary)]'}`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="my-3 border-t border-[var(--border-color)]" />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
          <div className="shrink-0 lg:w-64">
            <div className="flex items-center justify-between gap-3 lg:block">
              <h3 className="text-sm font-semibold text-white">全片拍摄方式</h3>
              <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--accent-blue)]">Capture mode</span>
            </div>
            <p className="mt-1 truncate text-xs text-[var(--text-secondary)]" title={currentCapture.description}>
              <span className="text-[var(--text-primary)]">{currentCapture.label}</span>
              <span className="mx-1.5 text-[var(--border-color)]">/</span>
              {currentCapture.description}
            </p>
          </div>

          <div
            role="radiogroup"
            aria-label="选择全片拍摄方式"
            className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-1 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {CAPTURE_PRESETS.map((preset) => {
              const isSelected = capturePreset === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => onCapturePresetChange(preset.value)}
                  title={preset.description}
                  style={isSelected ? { backgroundColor: 'rgba(var(--workspace-accent-rgb), 0.12)' } : undefined}
                  className={`shrink-0 whitespace-nowrap rounded-md border px-3 py-2 text-xs font-medium transition-colors active:translate-y-px ${isSelected ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]' : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--accent-blue)]/60 hover:text-[var(--text-primary)]'}`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CharacterUpload onCharactersChange={onCharactersChange} />
        <ObjectUpload onObjectsChange={onObjectsChange} />
      </div>

      <p className="text-xs leading-5 text-[var(--text-secondary)]">生成 Story 剧本前，会先匹配原稿人物与已选角色，按所选人物适配身份和称谓，保留原剧情与动作。只有确实独立的新人物才会新增角色。</p>

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
