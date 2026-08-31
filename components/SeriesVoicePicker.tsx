"use client";
import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { readApiJson } from '@/lib/apiResponse';
import type { FishCatalogScope, FishCatalogVoice } from '@/lib/series/fishCatalog';
import type { SeriesCharacter } from '@/lib/series/types';

const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs disabled:opacity-40 hover:border-[#a78bfa]';
const field = 'rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 text-sm';
export default function SeriesVoicePicker({ character, base, fishAudioKey, language, usedVoices, onClose, onSelect }: {
  character: SeriesCharacter; base: string; fishAudioKey: string; language: 'en' | 'zh';
  usedVoices: Record<string, string>; onClose: () => void;
  onSelect: (voice: FishCatalogVoice) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<FishCatalogScope>('public');
  const [filterLanguage, setLanguage] = useState<string>(language);
  const [items, setItems] = useState<FishCatalogVoice[]>([]);
  const [page, setPage] = useState(1), [hasMore, setMore] = useState(false);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [selected, setSelected] = useState<FishCatalogVoice>();
  const [rights, setRights] = useState(false);
  const requestId = useRef(0);
  const search = async (nextPage = 1) => {
    const id = ++requestId.current; setLoading(true); setError(''); setItems([]); setSelected(undefined); setRights(false);
    try {
      const response = await fetch(`${base}/api/series/voice-catalog`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fishAudioKey, scope, language: filterLanguage, query, page: nextPage }), signal: AbortSignal.timeout(30_000) });
      const result = await readApiJson<{ items: FishCatalogVoice[]; hasMore: boolean; page: number }>(response, '搜索音色失败');
      if (id === requestId.current) { setItems(result.items); setMore(result.hasMore); setPage(result.page); }
    } catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : '搜索失败'); }
    finally { if (id === requestId.current) setLoading(false); }
  };
  useEffect(() => { void search(); return () => { requestId.current++; }; }, []);
  const choose = async () => {
    if (!selected || saving || (selected.source !== 'licensed' && !rights)) return;
    setSaving(true); setError('');
    try { await onSelect(selected); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '保存音色失败'); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5" onClick={() => !saving && onClose()}>
    <section role="dialog" aria-modal="true" aria-label={`从 Fish 为 ${character.name} 选声`} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]" onClick={e => e.stopPropagation()}>
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border-color)] p-5">
        <div><h2 className="text-lg">从 Fish 音色库选声</h2><p className="mt-2 text-sm">待配音角色：{character.name}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">{character.voiceBrief}</p></div>
        <button className={button} disabled={saving} onClick={onClose} aria-label="关闭音色库"><X size={16}/></button>
      </header>
      <form className="flex flex-wrap gap-2 p-5" onSubmit={e => { e.preventDefault(); void search(); }}>
        <select aria-label="音色库范围" className={field} value={scope} onChange={e => setScope(e.target.value as FishCatalogScope)}><option value="public">Fish 公共库</option><option value="licensed">Fish 平台授权库</option><option value="workspace">我的 Fish 工作区</option></select>
        <select aria-label="音色语言" className={field} value={filterLanguage} onChange={e => setLanguage(e.target.value)}><option value="en">英语</option><option value="zh">中文</option><option value="">全部语言</option></select>
        <input aria-label="搜索音色名称" className={`${field} min-w-48 flex-1`} placeholder="搜索音色名称；留空浏览，不搜角色名字" value={query} onChange={e => setQuery(e.target.value)}/>
        <button className={button} disabled={loading || saving}><Search size={14}/>搜索</button>
      </form>
      <p className="px-5 pb-3 text-xs text-[var(--text-secondary)]">下方试听使用 Fish 已发布样本，不提交新合成。公共可见不等于平台已授权；请确认使用权。选定后续跑会生成并校验本剧语言试读，按 Fish 设置计费。</p>
      {error && <p role="alert" className="px-5 pb-3 text-sm text-red-300">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {loading ? <p className="flex gap-2 py-8"><Loader2 size={16} className="animate-spin"/>正在读取 Fish 音色库…</p> : !items.length ? <p className="py-8 text-sm">没有可用结果，请换关键词或语言范围后搜索。</p> : <div className="grid gap-3 md:grid-cols-2">{items.map(voice => <article key={voice.id} className={`rounded-lg border p-4 ${selected?.id === voice.id ? 'border-[#a78bfa]' : 'border-[var(--border-color)]'}`}>
          <h3 className="text-sm font-medium">{voice.title}</h3><p className="mt-1 text-xs text-[#c1afff]">{voice.source === 'licensed' ? 'Fish 平台授权' : voice.source === 'workspace' ? '自有工作区 · 请确认使用权' : '公共音色 · 使用权未确认'} · {voice.languages.join(', ') || '语言未标注'}</p>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--text-secondary)]">{voice.description}</p>
          {voice.sampleUrl ? <audio controls preload="none" className="mt-3 h-8 w-full" src={voice.sampleUrl}/> : <p className="mt-3 text-xs">暂无公开试听样本</p>}
          <div className="mt-3 flex items-center justify-between gap-2"><a className="text-xs text-[#c1afff]" href={voice.pageUrl} target="_blank" rel="noopener noreferrer">在 Fish 查看</a><button className={button} disabled={saving || Boolean(usedVoices[voice.id])} onClick={() => { setSelected(voice); setRights(false); }}>{usedVoices[voice.id] ? `已用于 ${usedVoices[voice.id]}` : selected?.id === voice.id ? '已选择' : '选择'}</button></div>
        </article>)}</div>}
      </div>
      <footer className="space-y-3 border-t border-[var(--border-color)] p-5">
        <div className="flex gap-2"><button className={button} disabled={loading || saving || page <= 1} onClick={() => void search(page - 1)}>上一页</button><span className="p-2 text-xs">第 {page} 页</span><button className={button} disabled={loading || saving || !hasMore} onClick={() => void search(page + 1)}>下一页</button></div>
        {selected && selected.source !== 'licensed' && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} disabled={saving}/>我确认有权在本项目中使用「{selected.title}」音色</label>}
        <button className={`${button} w-full bg-[#a78bfa] text-[#1d1534]`} disabled={!selected || saving || (selected.source !== 'licensed' && !rights)} onClick={() => void choose()}>{saving ? '保存中…' : `固定给 ${character.name} 使用`}</button>
      </footer>
    </section>
  </div>;
}
