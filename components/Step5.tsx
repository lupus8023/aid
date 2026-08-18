'use client';

import { useMemo, useState } from 'react';
import { Storyboard, Character } from '@/types';
import { CheckCircle2, Clapperboard, HardDrive, Layers3, Loader2, Video, Wand2, Mic } from 'lucide-react';
import { estimateVideoSegmentSeconds, persistedVideoClipCount, suggestVideoSegments, validateVideoSegment } from '@/lib/videoSegments';

interface Step5Props {
  storyboards: Storyboard[];
  characters: Character[];
  videoModel?: string;
  videoProvider?: 'apimart' | 'comfyui';
  onBack: () => void;
  onNext: () => void;
  onGenerateVideo: (storyboard: Storyboard, segmentStoryboards?: Storyboard[]) => void;
  onGenerateVideoPrompt?: (storyboard: Storyboard) => void;
  onGenerateAudio?: (storyboard: Storyboard) => void;
  onUpdate?: (storyboard: Storyboard) => void;
}

export default function Step5({ storyboards, characters, videoModel, videoProvider = 'apimart', onBack, onNext, onGenerateVideo, onGenerateVideoPrompt, onGenerateAudio, onUpdate }: Step5Props) {
  const isComfyUI = videoProvider === 'comfyui';
  const completedCount = isComfyUI
    ? persistedVideoClipCount(storyboards)
    : storyboards.filter(sb => sb.videoStatus === 'completed').length;
  const cachingCount = storyboards.filter(sb => sb.videoCacheStatus === 'caching').length;
  const cachedCount = isComfyUI
    ? persistedVideoClipCount(storyboards, true)
    : storyboards.filter(sb => sb.videoCacheStatus === 'completed').length;
  const withImages = storyboards.filter(sb => sb.imageUrl);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Wan2.6/Wan2.7 使用实际音轨；仙宫云 MiniMax H3 会原生生成同步音频。
  const m = (videoModel || '').toLowerCase();
  const showAudioButton = !isComfyUI && (m.includes('wan2.6') || m.includes('wan2.7') || m.includes('wan 2.6') || m.includes('wan 2.7'));
  const suggestedSegments = useMemo(() => suggestVideoSegments(withImages), [withImages]);
  const selectedStoryboards = withImages.filter(storyboard => selectedIds.includes(storyboard.id)).sort((a, b) => a.sceneNumber - b.sceneNumber);
  const selectionError = selectedIds.length ? validateVideoSegment(selectedStoryboards) : undefined;

  const toggleStoryboard = (storyboardId: string) => {
    setSelectedIds(current => current.includes(storyboardId)
      ? current.filter(id => id !== storyboardId)
      : [...current, storyboardId]);
  };

  const generateSelectedSegment = () => {
    if (selectionError || !selectedStoryboards.length) return;
    onGenerateVideo(selectedStoryboards[0], selectedStoryboards);
    setSelectedIds([]);
  };

  const startEdit = (sb: Storyboard) => {
    setEditingId(sb.id);
    setEditedPrompt(sb.videoPrompt || '');
  };

  const saveEdit = (sb: Storyboard) => {
    onUpdate?.({ ...sb, videoPrompt: editedPrompt, videoPromptOverride: true });
    setEditingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[var(--accent-purple)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">05.</span> Generate Videos
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          {isComfyUI
            ? 'MiniMax H3 only speaks approved dialogue; no subtitles, narration or automatic music'
            : 'Generate audio from dialogue, then generate video for each shot'}
        </p>
      </div>

      {isComfyUI && (
        <div className="p-4 border border-[var(--accent-green)]/40 rounded bg-[var(--bg-secondary)]">
          <div className="text-sm font-mono text-[var(--accent-green)]">仙宫云 MiniMax H3 · Native Audio</div>
          <p className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
            普通分镜使用单图 Ref2VA；开启“连贯上一镜头”时使用运动交接帧，带角色音色参考时自动切换 Hybrid。音色只作参考，不会把参考音频内容当成台词。
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs font-mono text-[var(--text-secondary)]">
            <HardDrive size={12} /> 视频完成后会自动下载到浏览器本地缓存；FFmpeg 导出优先使用本地副本。已缓存 {cachedCount}/{completedCount}
          </p>
        </div>
      )}

      {isComfyUI && withImages.length > 0 && (
        <section className="rounded-xl border border-[var(--accent-purple)]/45 bg-[var(--bg-secondary)] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-white"><Clapperboard size={15} className="text-[var(--accent-purple)]" /> H3 片段编组</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">一个视频片段可以包含 1–4 个连续分镜。每张勾选的分镜图会作为片段内对应节拍的多图参考，总时长严格不超过 15 秒。</p>
            </div>
            <button
              type="button"
              onClick={generateSelectedSegment}
              disabled={!selectedStoryboards.length || Boolean(selectionError)}
              className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent-purple)] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Layers3 size={14} />
              {selectedStoryboards.length ? `生成所选 ${selectedStoryboards.length} 镜 · ${estimateVideoSegmentSeconds(selectedStoryboards)}s` : '勾选下方分镜'}
            </button>
          </div>
          {selectionError && <p className="mt-2 text-xs text-[var(--accent-yellow)]">{selectionError}</p>}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {suggestedSegments.map((group, index) => (
              <button
                key={`${group[0]?.id}-${index}`}
                type="button"
                onClick={() => setSelectedIds(group.map(item => item.id))}
                className="shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-left hover:border-[var(--accent-purple)]"
              >
                <span className="block font-mono text-[10px] text-[var(--accent-purple)]">推荐片段 {String(index + 1).padStart(2, '0')}</span>
                <span className="mt-0.5 block text-xs text-[var(--text-primary)]">镜头 {group.map(item => item.sceneNumber).join(' · ')}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-[var(--text-secondary)]">{group.length} 个节拍 · {estimateVideoSegmentSeconds(group)}s</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {withImages.map((sb) => {
          const hasDialogue = (sb.dialogueLines?.length ?? 0) > 0 || Object.keys(sb.dialogue || {}).length > 0;
          const sbIndex = storyboards.findIndex(s => s.id === sb.id);
          const aspectClass = sb.aspectRatio === '9:16' ? 'aspect-[9/16]' : sb.aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video';
          return (
            <div key={sb.id} className={`bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded overflow-hidden ${sb.aspectRatio === '9:16' ? 'max-w-[200px] mx-auto' : ''}`}>
              {sb.videoUrl ? (
                <video src={sb.videoUrl} className={`w-full ${aspectClass} object-cover`} controls muted />
              ) : (
                <img src={sb.imageUrl} alt={`Scene ${sb.sceneNumber}`} className={`w-full ${aspectClass} object-cover opacity-60`} />
              )}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2">
                    {isComfyUI && <input type="checkbox" checked={selectedIds.includes(sb.id)} onChange={() => toggleStoryboard(sb.id)} className="h-3.5 w-3.5 accent-[var(--accent-purple)]" />}
                    <span className="text-xs font-mono text-[var(--accent-yellow)]">Scene {sb.sceneNumber}</span>
                  </label>
                  {sb.videoStatus === 'completed' && <CheckCircle2 size={14} className="text-[var(--success)]" />}
                </div>
                {sb.videoSegmentId && (
                  <p className="rounded bg-[var(--accent-purple)]/10 px-2 py-1 text-[10px] font-mono text-[var(--accent-purple)]">
                    {sb.videoSegmentStoryboardIds?.length
                      ? `片段主镜头 · 包含 ${sb.videoSegmentStoryboardIds.length} 个分镜`
                      : '已编入同一 H3 片段'}
                  </p>
                )}
                {sb.videoCacheStatus === 'caching' && (
                  <p className="flex items-center gap-1 text-[10px] font-mono text-[var(--accent-yellow)]"><Loader2 size={10} className="animate-spin" /> 正在下载到本地…</p>
                )}
                {sb.videoCacheStatus === 'completed' && (
                  <p className="flex items-center gap-1 text-[10px] font-mono text-[var(--accent-green)]"><HardDrive size={10} /> 已保存到本地，刷新后可恢复</p>
                )}
                {sb.videoCacheStatus === 'failed' && (
                  <p className="text-[10px] font-mono text-[var(--accent-yellow)]">本地缓存失败，当前仍使用云端地址</p>
                )}

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
                    <p className="text-xs font-mono text-[var(--text-secondary)] line-clamp-2 pr-16">
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
                      <button onClick={() => startEdit(sb)} className="text-xs font-mono text-[var(--accent-blue)] hover:underline">Edit</button>
                    </div>
                  </div>
                )}

                {/* Dialogue lines in order */}
                {(() => {
                  const lines = sb.dialogueLines?.length
                    ? sb.dialogueLines
                    : Object.entries(sb.dialogue || {}).map(([character, text]) => ({ character, text }));
                  return lines.length > 0 ? (
                    <div className="space-y-1 pt-1 border-t border-[var(--border-color)]">
                      <span className="text-xs font-mono text-[var(--text-secondary)]">Dialogue:</span>
                      {lines.map((line, i) => (
                        <div key={i}>
                          <span className="text-xs font-mono text-[var(--accent-green)]">{line.character}: </span>
                          <input
                            type="text"
                            value={line.text}
                            onChange={(e) => {
                              const updated = [...lines];
                              updated[i] = { ...line, text: e.target.value };
                              onUpdate?.({ ...sb, dialogueLines: updated });
                            }}
                            className="w-full mt-0.5 px-2 py-1 text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                          />
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}

                {/* Audio status */}
                {sb.characterAudios && sb.characterAudios.length > 0 && (
                  <div className="space-y-1">
                    {sb.characterAudios.map((ca, i) => (
                      <div key={i} className="space-y-0.5">
                        <div className="flex items-center gap-1 text-xs font-mono text-[var(--accent-green)]">
                          <Mic size={10} /> {ca.character}
                        </div>
                        <audio src={ca.audioUrl} controls className="w-full h-8" />
                      </div>
                    ))}
                  </div>
                )}

                {/* Duration */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[var(--text-secondary)]">Duration:</span>
                  <input
                    type="number"
                    min={isComfyUI ? 2 : 5}
                    max={15}
                    value={sb.videoDuration ?? 5}
                    onChange={(e) => onUpdate?.({ ...sb, videoDuration: Math.min(15, Math.max(isComfyUI ? 2 : 5, Number(e.target.value))) })}
                    className="w-16 px-2 py-1 text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                  />
                  <span className="text-xs font-mono text-[var(--text-secondary)]">s</span>
                </div>

                {/* Continuity toggle - only show for shots after the first */}
                {sbIndex > 0 && (
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sb.continuousFromPrev ?? false}
                        onChange={(e) => onUpdate?.({ ...sb, continuousFromPrev: e.target.checked })}
                        className="w-3 h-3"
                      />
                      <span className="text-xs font-mono text-[var(--text-secondary)]">连贯上一镜头</span>
                    </label>
                    {sb.continuousFromPrev && hasDialogue && (
                      isComfyUI ? (
                        <p className="text-[10px] font-mono text-[var(--accent-green)] leading-tight">
                          使用运动交接帧：继承上一镜运动，只说本镜头已填写的台词，不自动添加配乐或人声。
                        </p>
                      ) : (
                        <p className="text-[10px] font-mono text-[var(--accent-yellow)] leading-tight">
                          提示：连续模式下视频不会传入配音音频。如需台词同步，建议关闭此选项。
                        </p>
                      )
                    )}
                  </div>
                )}

                {isComfyUI && (
                  <div className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)]">
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">H3 Workflow</span>
                    <span className="text-[10px] font-mono text-[var(--accent-green)]">
                      {sb.continuousFromPrev ? 'FL2VA · 首尾帧' : 'Ref2VA · 单图参考'}
                    </span>
                  </div>
                )}

                {/* Generate Audio — 仅 Wan2.6/2.7 需要预生成 TTS */}
                {hasDialogue && showAudioButton && (
                  <button
                    onClick={() => onGenerateAudio?.(sb)}
                    disabled={sb.audioStatus === 'generating'}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] disabled:opacity-50 rounded transition-colors"
                  >
                    {sb.audioStatus === 'generating' ? (
                      <><Loader2 size={10} className="animate-spin" /> Generating Audio...</>
                    ) : (
                      <><Mic size={10} /> {sb.characterAudios?.length ? 'Regenerate Audio' : 'Generate Audio'}</>
                    )}
                  </button>
                )}

                {(() => {
                  const prevShot = sbIndex > 0 ? storyboards[sbIndex - 1] : undefined;
                  // Completed Companion clips are intentionally browser-local
                  // blob URLs. They are valid continuity sources because Story
                  // extracts the visible tail frame before the next H3 request.
                  const prevNotReady = Boolean(sb.continuousFromPrev && prevShot && !prevShot.videoUrl);
                  return (
                    <button
                      onClick={() => onGenerateVideo(sb)}
                      disabled={sb.videoStatus === 'generating' || !!prevNotReady}
                      title={prevNotReady ? '请先生成上一镜头的视频' : undefined}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-purple)] hover:bg-[#9b59b6] text-white disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] rounded transition-colors"
                    >
                      {sb.videoStatus === 'generating' ? (
                        <><Loader2 size={12} className="animate-spin" /> Generating...</>
                      ) : prevNotReady ? (
                        <><Video size={12} /> 等待上一镜头完成</>
                      ) : (
                        <><Video size={12} /> {sb.videoUrl ? 'Regenerate' : 'Generate Video'}</>
                      )}
                    </button>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between pt-4 border-t border-[var(--border-color)]">
        <button onClick={onBack} className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2">
          <span>←</span> Back
        </button>
        <button
          onClick={onNext}
          disabled={completedCount === 0 || cachingCount > 0}
          className="bg-[var(--accent-green)] text-[var(--bg-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[#5dd18d] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {cachingCount > 0 ? `正在保存 ${cachingCount} 个片段…` : 'Next: Edit & Export →'}
        </button>
      </div>
    </div>
  );
}
