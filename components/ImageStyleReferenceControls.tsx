'use client';

import { useRef, useState } from 'react';
import type { ImageStyleReference } from '@/lib/imageStyleReference';
import { createImageReferenceUploader } from '@/lib/storyImageRequest';

export default function ImageStyleReferenceControls({ value, onChange, disabled = false, onBusy }: {
  value?: ImageStyleReference;
  onChange: (value: ImageStyleReference | undefined) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const upload = useRef(createImageReferenceUploader());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function select(file?: File) {
    if (!file) return;
    setBusy(true); onBusy?.(true); setError('');
    const url = URL.createObjectURL(file);
    try {
      const imageUrl = await upload.current(url);
      onChange({ imageUrl, description: value?.description });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '风格图上传失败'); }
    finally { URL.revokeObjectURL(url); setBusy(false); onBusy?.(false); }
  }
  return <section className="space-y-2 rounded-xl border border-[var(--border-color)] p-3" aria-label="生图风格参考">
    <p className="aid-field-label">风格参考图 · MJ --sref / GPT 风格参考</p>
    <p className="text-xs leading-5 text-[var(--text-muted)]">与人物身份图分开传递，只借用媒介、色彩、光影和材质语言，不复制图中的人物或道具。MJ 使用独立 sref 参数；GPT 使用单独编号的风格图，不伪装成原生 sref。</p>
    {value && <img src={value.imageUrl} alt="已启用的生图风格参考" className="h-28 w-28 rounded-lg object-cover" />}
    <input aria-label="上传生图风格参考" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={event => { void select(event.target.files?.[0]); event.target.value = ''; }} className="w-full text-xs" />
    {value && <><textarea aria-label="生图风格说明" value={value.description || ''} disabled={disabled || busy} maxLength={1600} onChange={event => onChange({ ...value, description: event.target.value })} className="aid-input w-full" placeholder="细化这张风格图的效果，例如：柔和珠光、细颗粒、保留深色背景。不要改写人物身份。" /><button type="button" disabled={disabled || busy} onClick={() => onChange(undefined)} className="text-xs text-[var(--text-muted)]">移除风格参考</button></>}
    {busy && <p className="text-xs" role="status">上传风格原图中…</p>}
    {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
  </section>;
}
