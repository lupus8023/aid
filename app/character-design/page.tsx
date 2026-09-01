'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Download,
  Home,
  ImagePlus,
  LayoutGrid,
  Library,
  Loader2,
  RefreshCw,
  Settings,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react';
import DevToolsLayout from '@/components/DevToolsLayout';
import SettingsModal from '@/components/SettingsModal';
import { useSettings } from '@/hooks/useSettings';
import { readApiJson } from '@/lib/apiResponse';
import { PRODUCTION_STYLE_PRESETS } from '@/lib/promptArchitecture';
import {
  CHARACTER_DESIGNS_STORAGE_KEY,
  CHARACTER_HISTORY_STORAGE_KEY,
  characterFromDesignRecord,
  parseStoredArray,
  upsertCharacterHistory,
} from '@/lib/characterLibrary';
import { getImageModelCapabilities, imageModelRequiresApiKey } from '@/lib/imageModels';
import { imageApiUrl, localComfyUISettings } from '@/lib/comfyuiClient';
import type { VisualStyle } from '@/types';
import { resolveMidjourneyProfileSetting, resolveMidjourneyStyleSetting } from '@/lib/midjourney';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const TARGET_BYTES = 1200 * 1024;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file: File): Promise<string> {
  if (file.size <= TARGET_BYTES && /^image\/(?:jpeg|png|webp)$/i.test(file.type)) return readAsDataUrl(file);
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('图片压缩失败');
    return readAsDataUrl(blob);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function downloadImage(url: string, filename: string) {
  const source = /^https?:\/\//i.test(url) ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`下载失败 (${response.status})`);
  const blob = await response.blob();
  const localUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = localUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(localUrl);
}

export default function CharacterDesignPage() {
  const { settings, saveSettings } = useSettings();
  const referenceLimit = Math.min(4, getImageModelCapabilities(settings.imageModel).maxReferenceImages);
  const [showSettings, setShowSettings] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [age, setAge] = useState('');
  const [personality, setPersonality] = useState('');
  const [coreTheme, setCoreTheme] = useState('');
  const [description, setDescription] = useState('');
  const [costumeDesc, setCostumeDesc] = useState('');
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('cinematic-natural');
  const [candidateCount, setCandidateCount] = useState<4 | 9>(4);
  const [references, setReferences] = useState<string[]>([]);
  const [conceptGridUrl, setConceptGridUrl] = useState('');
  const [concepts, setConcepts] = useState<string[]>([]);
  const [selectedConcept, setSelectedConcept] = useState('');
  const [bibleUrl, setBibleUrl] = useState('');
  const [busyStage, setBusyStage] = useState<'upload' | 'concepts' | 'bible' | null>(null);
  const [status, setStatus] = useState('填写角色简报，从多个方向中锁定最终形象。');

  const currentStep = bibleUrl ? 3 : concepts.length ? 2 : 1;
  const selectedIndex = useMemo(() => concepts.indexOf(selectedConcept), [concepts, selectedConcept]);

  const uploadReferences = async (files: FileList) => {
    const incoming = Array.from(files).slice(0, referenceLimit - references.length);
    if (!incoming.length) return;
    if (incoming.some(file => file.size > MAX_FILE_BYTES)) {
      alert('单张参考图不能超过 8MB');
      return;
    }
    setBusyStage('upload');
    try {
      const values = await Promise.all(incoming.map(compressImage));
      setReferences(previous => [...previous, ...values].slice(0, referenceLimit));
      setStatus('参考图已加入。它们会约束身份特征、媒介和材质语言。');
    } catch (error) {
      alert(error instanceof Error ? error.message : '图片处理失败');
    } finally {
      setBusyStage(null);
    }
  };

  const ensureUploadedReferences = async () => {
    const uploaded: string[] = [];
    for (let index = 0; index < references.length; index += 1) {
      const value = references[index];
      if (/^https?:\/\//i.test(value)) {
        uploaded.push(value);
        continue;
      }
      setStatus(`上传参考图 ${index + 1}/${references.length}…`);
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: value }),
      });
      const data = await readApiJson<{ url: string }>(response, `参考图 ${index + 1} 上传失败`);
      if (!data.url) throw new Error(`参考图 ${index + 1} 没有返回 URL`);
      uploaded.push(data.url);
    }
    setReferences(uploaded);
    return uploaded;
  };

  const pollImage = async (taskId: string, label: string) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      setStatus(`${label} · ${attempt + 1}/100`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      const response = await fetch(imageApiUrl('/api/check-image-status', settings.comfyui, taskId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, apiKey: settings.apiKey, comfyui: localComfyUISettings(settings.comfyui) }),
      });
      if (!response.ok) continue;
      const data = await readApiJson<{ status: string; imageUrl?: string; error?: string }>(response, '查询生图状态失败');
      if (data.status === 'completed' && data.imageUrl) {
        if (!data.imageUrl.startsWith('data:')) return data.imageUrl;
        const upload = await fetch('/api/upload-image', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageData: data.imageUrl }),
        });
        const persisted = await readApiJson<{ url: string }>(upload, '本地生成图片上传失败');
        if (!persisted.url) throw new Error('本地生成图片上传后没有返回 URL');
        return persisted.url;
      }
      if (data.status === 'failed') throw new Error(data.error || '图片生成失败');
    }
    throw new Error('图片生成超时');
  };

  const commonPayload = () => ({
    name,
    role,
    age,
    personality,
    coreTheme,
    description,
    costumeDesc,
    visualStyle,
    imageModel: settings.imageModel,
    apiKey: settings.apiKey,
    comfyui: localComfyUISettings(settings.comfyui),
    midjourneyProfile: resolveMidjourneyProfileSetting(settings),
    midjourneyStyle: resolveMidjourneyStyleSetting(settings),
  });

  const generateConcepts = async () => {
    if (!name.trim() || !description.trim()) {
      alert('请先填写角色名称和具体外观');
      return;
    }
    if (imageModelRequiresApiKey(settings.imageModel) && !settings.apiKey) {
      setShowSettings(true);
      return;
    }
    setBusyStage('concepts');
    setConceptGridUrl('');
    setConcepts([]);
    setSelectedConcept('');
    setBibleUrl('');
    try {
      const referenceImages = await ensureUploadedReferences();
      setStatus(`生成 ${candidateCount} 个角色方向…`);
      const response = await fetch(imageApiUrl('/api/character-design', settings.comfyui, settings.imageModel), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commonPayload(), stage: 'concepts', candidateCount, referenceImages }),
      });
      const data = await readApiJson<{ taskId: string }>(response, '启动角色草稿失败');
      const gridUrl = await pollImage(data.taskId, '角色草稿生成中');
      setConceptGridUrl(gridUrl);
      setStatus('正在拆分可选择草稿…');
      const splitResponse = await fetch('/api/split-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: gridUrl, gridSize: candidateCount === 4 ? 2 : 3 }),
      });
      const split = await readApiJson<{ gridUrl: string; cells: string[] }>(splitResponse, '角色草稿拆分失败');
      setConceptGridUrl(split.gridUrl);
      setConcepts(split.cells.slice(0, candidateCount));
      setSelectedConcept(split.cells[0] || '');
      setStatus('草稿已完成。选择一个形象后生成完整角色卡。');
    } catch (error) {
      setStatus('角色草稿生成失败');
      alert(error instanceof Error ? error.message : '角色草稿生成失败');
    } finally {
      setBusyStage(null);
    }
  };

  const generateBible = async () => {
    if (!selectedConcept) return;
    setBusyStage('bible');
    setBibleUrl('');
    try {
      setStatus('正在扩展多角度、表情、动作与材质系统…');
      const response = await fetch(imageApiUrl('/api/character-design', settings.comfyui, settings.imageModel), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commonPayload(), stage: 'bible', selectedConceptUrl: selectedConcept }),
      });
      const data = await readApiJson<{ taskId: string }>(response, '启动角色卡生成失败');
      const url = await pollImage(data.taskId, '完整角色卡生成中');
      setBibleUrl(url);
      setStatus('完整角色卡已生成，可下载或存入本地角色库。');
    } catch (error) {
      setStatus('完整角色卡生成失败');
      alert(error instanceof Error ? error.message : '完整角色卡生成失败');
    } finally {
      setBusyStage(null);
    }
  };

  const saveToLibrary = () => {
    if (!bibleUrl) return;
    const record = {
      id: `character-${Date.now()}`,
      name,
      role,
      age,
      personality,
      coreTheme,
      description,
      costumeDesc,
      visualStyle,
      conceptUrl: selectedConcept,
      bibleUrl,
      createdAt: new Date().toISOString(),
    };
    const existing = parseStoredArray(localStorage.getItem(CHARACTER_DESIGNS_STORAGE_KEY));
    localStorage.setItem(CHARACTER_DESIGNS_STORAGE_KEY, JSON.stringify([record, ...existing].slice(0, 50)));

    const historyCharacter = characterFromDesignRecord(record);
    if (historyCharacter) {
      const history = parseStoredArray(localStorage.getItem(CHARACTER_HISTORY_STORAGE_KEY));
      localStorage.setItem(CHARACTER_HISTORY_STORAGE_KEY, JSON.stringify(upsertCharacterHistory(history, historyCharacter)));
    }
    setStatus('已存入 AID 角色库，可在 Story 的“历史角色”中直接引用。');
  };

  const toolbar = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link href="/"><img src="/logo.png" alt="AID" className="h-7" /></Link>
        <span className="h-5 w-px bg-[var(--border-color)]" />
        <div><span className="block text-xs font-medium text-white">角色设计</span><span className="hidden font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)] sm:block">Character Design</span></div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setShowSettings(true)} className="flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs hover:bg-[var(--bg-hover)]"><Settings size={14} /> 设置</button>
        <Link href="/" className="flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs hover:bg-[var(--bg-hover)]"><Home size={14} /> 首页</Link>
      </div>
    </div>
  );

  return (
    <div className="aid-theme-teal contents">
      <DevToolsLayout toolbar={toolbar} statusBar={<div className="flex w-full items-center justify-between text-[var(--text-muted)]"><span>{status}</span><span className="font-mono">STEP {currentStep}/3</span></div>}>
        <div className="min-h-full bg-[var(--bg-primary)]">
          <div className="mx-auto max-w-[1500px] p-4 md:p-7">
            <header className="mb-6 grid gap-5 border-b border-[var(--border-color)] pb-6 lg:grid-cols-[1fr_auto] lg:items-end">
              <div><p className="aid-eyebrow">Character development lab</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-4xl">从角色方向，到可生产的完整角色卡</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">文字和参考图先探索 4 或 9 个形象方向；锁定一款后，再统一生成转面、表情、姿态、材质与色板。</p></div>
              <div className="flex gap-2">
                {['角色简报', '方向选择', '完整角色卡'].map((label, index) => <div key={label} className={`rounded-full border px-3 py-2 font-mono text-[10px] ${currentStep >= index + 1 ? 'border-[var(--accent-green)]/50 bg-[var(--accent-green)]/10 text-[var(--accent-green)]' : 'border-[var(--border-color)] text-[var(--text-muted)]'}`}>0{index + 1} {label}</div>)}
              </div>
            </header>

            <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
              <section className="aid-panel h-fit space-y-5 p-5 xl:sticky xl:top-6">
                <div><p className="aid-step-kicker">01 · Brief</p><h2 className="mt-1 text-lg font-semibold text-white">角色简报</h2></div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="col-span-2"><span className="aid-field-label">角色名称 *</span><input value={name} onChange={event => setName(event.target.value)} className="aid-input w-full" placeholder="例如：Meme" /></label>
                  <label><span className="aid-field-label">身份 / 角色</span><input value={role} onChange={event => setRole(event.target.value)} className="aid-input w-full" placeholder="美人鱼、侦探…" /></label>
                  <label><span className="aid-field-label">年龄</span><input value={age} onChange={event => setAge(event.target.value)} className="aid-input w-full" placeholder="童年、20岁左右…" /></label>
                  <label className="col-span-2"><span className="aid-field-label">性格关键词</span><input value={personality} onChange={event => setPersonality(event.target.value)} className="aid-input w-full" placeholder="好奇、顽皮、温柔、勇敢" /></label>
                  <label className="col-span-2"><span className="aid-field-label">核心主题</span><input value={coreTheme} onChange={event => setCoreTheme(event.target.value)} className="aid-input w-full" placeholder="角色在故事里代表什么" /></label>
                  <label className="col-span-2"><span className="aid-field-label">具体外观 *</span><textarea value={description} onChange={event => setDescription(event.target.value)} className="aid-input min-h-28 w-full resize-y" placeholder="发型、脸型、体型、肤色/材质、识别特征；尽量写具体，不写‘漂亮、时尚’这类抽象词。" /></label>
                  <label className="col-span-2"><span className="aid-field-label">服装与造型方向</span><textarea value={costumeDesc} onChange={event => setCostumeDesc(event.target.value)} className="aid-input min-h-20 w-full resize-y" placeholder="服装单品、颜色、材质、配饰、妆发与不可改变的细节" /></label>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between"><span className="aid-field-label !mb-0">参考图</span><span className="font-mono text-[10px] text-[var(--text-muted)]">{references.length}/{referenceLimit}</span></div>
                  <div className="grid grid-cols-4 gap-2">
                    {references.map((image, index) => <button key={`${image.slice(0, 24)}-${index}`} onClick={() => setReferences(previous => previous.filter((_, itemIndex) => itemIndex !== index))} className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border-color)] bg-black/20"><img src={image} alt={`参考 ${index + 1}`} className="h-full w-full object-cover" /><span className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-[9px] opacity-0 group-hover:opacity-100">移除</span></button>)}
                    {references.length < referenceLimit && <label className="grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] hover:border-[var(--accent-green)] hover:text-[var(--accent-green)]"><Upload size={18} /><input type="file" accept="image/*" multiple className="hidden" onChange={event => { if (event.target.files) void uploadReferences(event.target.files); event.target.value = ''; }} /></label>}
                  </div>
                </div>

                <div><span className="aid-field-label">制作风格</span><select value={visualStyle} onChange={event => setVisualStyle(event.target.value as VisualStyle)} className="aid-input w-full">{PRODUCTION_STYLE_PRESETS.map(style => <option key={style.value} value={style.value}>{style.label} · {style.description}</option>)}</select></div>
                <div><span className="aid-field-label">探索数量</span><div className="grid grid-cols-2 gap-2">{([4, 9] as const).map(count => <button key={count} onClick={() => setCandidateCount(count)} className={`rounded-lg border px-4 py-3 text-sm ${candidateCount === count ? 'border-[var(--accent-green)] bg-[var(--accent-green)]/12 text-[var(--accent-green)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'}`}><LayoutGrid size={15} className="mr-2 inline" />{count} 个方向</button>)}</div></div>
                <button onClick={generateConcepts} disabled={busyStage !== null} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-green)] px-4 py-3 text-sm font-medium text-[#06231f] disabled:opacity-50">{busyStage === 'concepts' || busyStage === 'upload' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{concepts.length ? '重新探索角色方向' : '生成角色草稿'}</button>
              </section>

              <section className="space-y-6">
                <div className="aid-panel p-5">
                  <div className="mb-4 flex items-center justify-between"><div><p className="aid-step-kicker">02 · Concepts</p><h2 className="mt-1 text-lg font-semibold text-white">选择一个形象方向</h2></div>{conceptGridUrl && <a href={conceptGridUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent-green)]">查看母图</a>}</div>
                  {concepts.length ? <div className={`grid gap-3 ${candidateCount === 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>{concepts.map((concept, index) => <button key={concept} onClick={() => { setSelectedConcept(concept); setBibleUrl(''); }} className={`group relative overflow-hidden rounded-xl border bg-black/20 text-left ${selectedConcept === concept ? 'border-[var(--accent-green)] shadow-[0_0_0_1px_var(--accent-green)]' : 'border-[var(--border-color)] hover:border-[var(--border-strong)]'}`}><img src={concept} alt={`角色方向 ${index + 1}`} className="aspect-square w-full object-cover" /><span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 font-mono text-[10px]">{String(index + 1).padStart(2, '0')}</span>{selectedConcept === concept && <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-green)] text-[#06231f]"><Check size={16} /></span>}</button>)}</div> : <div className="grid min-h-[390px] place-items-center rounded-xl border border-dashed border-[var(--border-color)] bg-black/10 text-center text-[var(--text-muted)]"><div><ImagePlus size={42} className="mx-auto mb-3 opacity-50" /><p className="text-sm">角色方向会在这里拆分为可选草稿</p><p className="mt-2 text-xs">每格只放一个完整角色，选择后再扩展角色卡</p></div></div>}
                  {concepts.length > 0 && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3"><div className="min-w-0"><p className="text-sm text-white">已选择方向 {selectedIndex + 1}</p><p className="mt-1 text-xs text-[var(--text-muted)]">后续所有转面、表情和材质都以这一格为身份锚点。</p></div><button onClick={generateBible} disabled={!selectedConcept || busyStage !== null} className="flex shrink-0 items-center gap-2 rounded-lg bg-[var(--accent-green)] px-4 py-2.5 text-sm font-medium text-[#06231f] disabled:opacity-50">{busyStage === 'bible' ? <Loader2 size={16} className="animate-spin" /> : <UserRound size={16} />}生成完整角色卡</button></div>}
                </div>

                <div className="aid-panel p-5">
                  <div className="mb-4 flex items-center justify-between"><div><p className="aid-step-kicker">03 · Character Bible</p><h2 className="mt-1 text-lg font-semibold text-white">完整角色卡</h2></div><span className="font-mono text-[10px] text-[var(--text-muted)]">4:3 PRODUCTION BOARD</span></div>
                  {bibleUrl ? <><div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-white"><img src={bibleUrl} alt={`${name} 完整角色卡`} className="w-full object-contain" /></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><button onClick={() => void downloadImage(bibleUrl, `${name || 'character'}-bible.png`)} className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm hover:bg-[var(--bg-hover)]"><Download size={15} /> 下载角色卡</button><button onClick={saveToLibrary} className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm hover:bg-[var(--bg-hover)]"><Library size={15} /> 存入角色库</button><button onClick={generateBible} disabled={busyStage !== null} className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50"><RefreshCw size={15} /> 重新生成</button></div></> : <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed border-[var(--border-color)] bg-black/10 text-center text-[var(--text-muted)]"><div><UserRound size={44} className="mx-auto mb-3 opacity-50" /><p className="text-sm">锁定草稿后生成完整角色卡</p><p className="mt-2 max-w-md text-xs leading-5">包含转面、轮廓、8组表情、微表情、头部角度、姿态、服装材质、手部动作和连续性色板。</p></div></div>}
                </div>
              </section>
            </div>
          </div>
        </div>
      </DevToolsLayout>
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} settings={settings} onSave={saveSettings} />
    </div>
  );
}
