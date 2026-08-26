'use client';

import { useState } from 'react';
import { Storyboard, Character, ObjectItem, type VoiceAgeGroup, type VoiceGender } from '@/types';
import type { PlannedCharacter, StoryPlan } from '@/lib/pipeline/types';
import { Loader2, RefreshCw, ZoomIn, X, Mic, MicOff, RotateCcw } from 'lucide-react';
import { effectiveStoryCast } from '@/lib/storyCast';

export type VoiceCastPatch = Partial<Pick<PlannedCharacter, 'gender' | 'ageGroup' | 'voiceId' | 'voiceProfile' | 'voiceSource'>>;

interface Step3Props {
  storyPlan?: StoryPlan;
  storyboards: Storyboard[];
  characters: Character[];
  objects: ObjectItem[];
  costumeImages: Record<string, string>;
  costumeGenerating: Record<string, boolean>;
  sceneImage: string;
  sceneImages: string[];
  sceneGenerating: boolean;
  voiceReferences: Record<string, string>;
  voiceGenerating: Record<string, boolean>;
  onBack: () => void;
  onNext: () => void;
  onUpdate?: (storyboard: Storyboard) => void;
  onGenerateCostume?: (type: 'costume' | 'scene', characterName?: string) => void;
  onClearCostumeImage?: (characterName: string) => void;
  onClearSceneImage?: (idx: number) => void;
  onGenerateVoiceReference?: (characterName: string) => void;
  onClearVoiceReference?: (characterName: string) => void;
  onVoiceCastChange?: (characterName: string, patch: VoiceCastPatch) => void;
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

export default function Step3({ storyPlan, storyboards, characters, objects, costumeImages, costumeGenerating, sceneImages, sceneGenerating, voiceReferences, voiceGenerating, onBack, onNext, onUpdate, onGenerateCostume, onClearCostumeImage, onClearSceneImage, onGenerateVoiceReference, onClearVoiceReference, onVoiceCastChange }: Step3Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [draggingScene, setDraggingScene] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const startEdit = (sb: Storyboard) => { setEditingId(sb.id); setEditedPrompt(sb.prompt); };
  const saveEdit = (sb: Storyboard) => { onUpdate?.({ ...sb, prompt: editedPrompt }); setEditingId(null); };
  const getObject = (name: string) => objects.find(o => o.name === name);
  const plannedByName = new Map((storyPlan?.characters || []).map(character => [character.name, character]));
  const referenceCast = effectiveStoryCast(characters, storyPlan?.characters);
  const voiceCast = [
    ...(storyPlan?.characters || []),
    ...characters.filter(character => !plannedByName.has(character.name)).map(character => ({
      name: character.name,
      role: '上传角色',
      want: '', obstacle: '', arc: '', subtext: '',
      gender: character.gender,
      ageGroup: character.ageGroup,
      voiceId: character.voiceId,
      voiceProfile: character.voiceProfile,
      voiceSource: character.voiceSource,
    })),
  ];
  const speakingNames = new Set(storyboards.flatMap(storyboard => (storyboard.speech || []).map(line => line.character)));
  const unresolvedSpeakingVoices = voiceCast.filter(character => speakingNames.has(character.name)
    && (!character.voiceId || !character.gender || character.gender === 'unknown'));

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[var(--accent-orange)] pl-4 mb-6">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">03.</span> Shot Script
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Generate character bibles & scene references, then review shots
        </p>
      </div>

      {storyPlan && (
        <section className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent-green)]">Story Bible</p><h3 className="mt-1 text-lg font-semibold text-white">{storyPlan.title || '未命名故事'}</h3><p className="mt-1 max-w-4xl text-xs leading-5 text-[var(--text-secondary)]">{storyPlan.logline}</p></div>
            <span className="rounded border border-[var(--border-color)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)]">{storyPlan.protagonist || '主角未定'}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['外在目标', storyPlan.externalWant], ['内在需要', storyPlan.internalNeed],
              ['失败代价', storyPlan.stakes], ['核心阻碍', storyPlan.obstacle],
              ['最终选择', storyPlan.finalChoice], ['选择后果', storyPlan.consequence],
              ['人物变化', storyPlan.change], ['故事锚点', storyPlan.storyAnchor],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-white/5 bg-black/10 p-3"><p className="text-[9px] text-[var(--text-muted)]">{label}</p><p className="mt-1 text-[11px] leading-5 text-white">{value || '—'}</p></div>)}
          </div>
        </section>
      )}

      {/* Global costume/scene reference panel */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-4">
        <p className="text-xs font-mono text-[var(--text-secondary)] mb-1">Global References — generated once, applied to all shots</p>
        <p className="text-[10px] font-mono text-[var(--text-secondary)] mb-3 opacity-60">Character bibles are 4:3 high-density sheets with turnarounds, expressions, micro-expressions, head/hand studies, silhouettes, and medium preservation for live action, CG, anime, or illustration.</p>
        <div className="flex gap-3 flex-wrap">
          {referenceCast.map(char => (
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

      {/* Full-film voice casting — includes text-defined supporting roles. */}
      {voiceCast.length > 0 && (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-xs font-mono text-[var(--text-secondary)]">全片音色选角</p><p className="mt-1 text-[10px] text-[var(--text-secondary)] opacity-70">主角、剧本新增配角均在分镜生成前锁定；自定义 Fish ID 永远优先，自动选声按性别、年龄和身份匹配。</p></div>
            <span className={`rounded border px-2 py-1 text-[9px] font-mono ${unresolvedSpeakingVoices.length ? 'border-amber-400/40 text-amber-300' : 'border-emerald-400/30 text-emerald-300'}`}>{unresolvedSpeakingVoices.length ? `${unresolvedSpeakingVoices.length} 个发声角色待确认` : '全部发声角色已锁定'}</span>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-white/5">
            <div className="min-w-[1020px] divide-y divide-white/5">
            {voiceCast.map(char => {
              const hasRef = !!voiceReferences[char.name];
              const isGenerating = !!voiceGenerating[char.name];
              const isSpeaking = speakingNames.has(char.name);
              return (
                <div key={char.name} className="grid grid-cols-[150px_120px_130px_minmax(240px,360px)_minmax(260px,1fr)] items-start gap-3 px-3 py-3">
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-xs text-white">{char.name}</span>{isSpeaking && <span className="rounded bg-[var(--accent-green)]/10 px-1.5 py-0.5 text-[8px] text-[var(--accent-green)]">有台词</span>}</div><p className="mt-1 truncate text-[9px] text-[var(--text-muted)]">{char.role || char.voiceProfile || '故事角色'}</p></div>
                  <select value={(char.gender || 'unknown') as VoiceGender} onChange={event => onVoiceCastChange?.(char.name, { gender: event.target.value as VoiceGender, voiceId: undefined, voiceSource: 'auto' })} className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-[10px] text-white">
                    <option value="unknown">性别待确认</option><option value="female">女性</option><option value="male">男性</option><option value="nonbinary">中性/非二元</option>
                  </select>
                  <select value={(char.ageGroup || 'unknown') as VoiceAgeGroup} onChange={event => onVoiceCastChange?.(char.name, { ageGroup: event.target.value as VoiceAgeGroup, voiceId: undefined, voiceSource: 'auto' })} className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-[10px] text-white">
                    <option value="unknown">年龄待确认</option><option value="child">儿童</option><option value="young_adult">青年</option><option value="adult">成年</option><option value="senior">老年</option>
                  </select>
                  <div><div className="flex gap-2"><input value={char.voiceId || ''} onChange={event => onVoiceCastChange?.(char.name, { voiceId: event.target.value, voiceSource: 'user', voiceProfile: '用户指定音色' })} placeholder="Fish Audio reference_id" className={`min-w-0 flex-1 rounded border bg-[var(--bg-primary)] px-2 py-2 font-mono text-[10px] text-white ${isSpeaking && !char.voiceId ? 'border-amber-400/60' : 'border-[var(--border-color)]'}`} /><button onClick={() => onVoiceCastChange?.(char.name, { voiceId: undefined, voiceSource: 'auto' })} title="按角色资料重新自动选声" className="rounded border border-[var(--border-color)] px-2 text-[var(--text-secondary)] hover:text-white"><RotateCcw size={13} /></button></div><p className="mt-1 truncate text-[9px] text-[var(--text-muted)]">{char.voiceSource === 'user' ? '自定义锁定' : `自动 · ${char.voiceProfile || '待匹配'}`}</p></div>
                  <div className="flex items-center justify-end gap-2">
                    {hasRef && <audio src={voiceReferences[char.name]} controls className="h-7 w-40 shrink-0" />}
                    <button disabled={isGenerating || !char.voiceId} onClick={() => onGenerateVoiceReference?.(char.name)} className="inline-flex items-center gap-1 rounded border border-[var(--border-color)] px-2 py-2 text-[9px] text-[var(--text-secondary)] hover:text-white disabled:opacity-30">{isGenerating ? <Loader2 size={12} className="animate-spin" /> : hasRef ? <RefreshCw size={12} /> : <MicOff size={12} />}{hasRef ? '重做' : '试听'}</button>
                    {hasRef && <button onClick={() => onClearVoiceReference?.(char.name)} title="删除试听" className="text-[var(--text-muted)] hover:text-red-300"><X size={12} /></button>}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
          {unresolvedSpeakingVoices.length > 0 && <p className="mt-3 text-[10px] text-amber-300">请先确认：{unresolvedSpeakingVoices.map(character => character.name).join('、')}。系统不会再为性别未知的发声角色默认套用女声。</p>}
        </div>
      )}

      {/* Shot list */}
      <div className="space-y-3">
        {storyboards.map((sb) => (
          <div key={sb.id} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-4 flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[var(--accent-yellow)]">Scene {sb.sceneNumber}</span>
                  {sb.locationId && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 bg-[var(--bg-tertiary)] text-[var(--accent-purple)] rounded border border-[var(--border-color)]">{sb.locationId}</span>
                  )}
                </div>
                {editingId !== sb.id && (
                  <button onClick={() => startEdit(sb)} className="text-xs font-mono text-[var(--accent-blue)] hover:underline">Edit</button>
                )}
              </div>
              <p className="text-sm text-[var(--text-primary)] mb-2">{sb.description}</p>
              <div className="mb-3 grid gap-2 lg:grid-cols-2">
                <div className="rounded-lg border border-white/5 bg-black/10 p-3">
                  <p className="text-[9px] font-mono uppercase tracking-[0.14em] text-[var(--accent-yellow)]">动作调度</p>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--text-primary)]">{sb.action || '—'}</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/10 p-3">
                  <p className="text-[9px] font-mono uppercase tracking-[0.14em] text-[var(--accent-green)]">逐字台词</p>
                  {(sb.speech || []).length ? <div className="mt-1 space-y-1.5">{(sb.speech || []).map((line, index) => (
                    <div key={`${line.character}-${index}`} className="text-[11px] leading-5 text-[var(--text-primary)]"><span className="font-semibold text-white">{line.character}</span>：{line.exactLine}<span className="ml-2 text-[9px] text-[var(--text-muted)]">{line.emotion} · {line.delivery}</span></div>
                  ))}</div> : <p className="mt-1 text-[11px] text-[var(--text-muted)]">纯视觉镜头</p>}
                </div>
              </div>
              {(sb.performance || []).length > 0 && (
                <div className="mb-3 rounded-lg border border-[var(--accent-purple)]/20 bg-[var(--accent-purple)]/5 p-3">
                  <p className="text-[9px] font-mono uppercase tracking-[0.14em] text-[var(--accent-purple)]">演员表演卡</p>
                  <div className="mt-2 grid gap-2 xl:grid-cols-2">{(sb.performance || []).map(cue => (
                    <div key={cue.character} className="rounded border border-white/5 bg-black/10 p-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-[11px] font-semibold text-white">{cue.character}</span><span className="text-[9px] text-[var(--text-muted)]">目标：{cue.objective}</span></div>
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]"><span className="text-white/70">走位动作</span> {cue.blocking}</p>
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]"><span className="text-white/70">手势</span> {cue.gesture}</p>
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]"><span className="text-white/70">微表情</span> {cue.expression}</p>
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]"><span className="text-white/70">视线/呼吸</span> {cue.gaze}；{cue.breath}</p>
                      <p className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]"><span className="text-white/70">反应/潜台词</span> {cue.reaction}；{cue.subtext}</p>
                    </div>
                  ))}</div>
                </div>
              )}
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
                  if (draggingScene) {
                    onUpdate?.({ ...sb, sceneImageOverride: draggingScene });
                  }
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
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        onClick={() => onGenerateCostume?.('costume', name)}
                        className="p-1 bg-white/20 rounded hover:bg-white/40"
                        title="Generate costume"
                      ><RefreshCw size={10} /></button>
                    </div>
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
          disabled={storyboards.length === 0 || unresolvedSpeakingVoices.length > 0}
          title={unresolvedSpeakingVoices.length ? '请先确认所有有台词角色的性别与 Fish Audio 音色' : undefined}
          className="bg-[var(--accent-green)] text-[var(--bg-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[#5dd18d] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          Next: Generate Images →
        </button>
      </div>
    </div>
  );
}
