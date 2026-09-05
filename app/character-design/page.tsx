'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { CAPTURE_PRESETS } from '@/lib/capturePresets';
import type { CapturePreset } from '@/types';
import type { ImageStyleReference } from '@/lib/imageStyleReference';
import ImageStyleReferenceControls from '@/components/ImageStyleReferenceControls';
import { buildImageStyleControls } from '@/lib/imageStyleControls';
import {
  CHARACTER_DESIGNS_STORAGE_KEY,
  CHARACTER_HISTORY_STORAGE_KEY,
  characterFromDesignRecord,
  parseStoredArray,
  upsertCharacterHistory,
} from '@/lib/characterLibrary';
import { APIMART_IMAGE_MODEL_OPTIONS, getImageModelCapabilities, imageModelRequiresApiKey, isMidjourneyImageModel, isGptImage2Model } from '@/lib/imageModels';
import { createImageReferenceUploader } from '@/lib/storyImageRequest';
import { HISTORICAL_CINEMA_AESTHETIC, makeCharacterVisualMaster } from '@/lib/characterVisualMaster';
import { imageApiUrl, localComfyUISettings } from '@/lib/comfyuiClient';
import type { VisualStyle } from '@/types';
import { resolveMidjourneyProfileSetting, resolveMidjourneyStyleSetting } from '@/lib/midjourney';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DRAFT_KEY = 'aidCharacterMasterDraftV1';
type PendingDesign = { taskId: string; stage: 'concepts' | 'extension'; model: string; count: 4 | 9; masterUrl?: string; prompt?: string; layout?: 'single' | 'native-candidates' };

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
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
  const [designModel, setDesignModel] = useState('midjourney');
  const [aestheticDirection, setAestheticDirection] = useState('');
  const referenceLimit = Math.min(4, getImageModelCapabilities(designModel).maxReferenceImages);
  const isMj = isMidjourneyImageModel(designModel);
  const singleMaster = isMj || isGptImage2Model(designModel);
  const uploadReference = useRef(createImageReferenceUploader());
  const [showSettings, setShowSettings] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [age, setAge] = useState('');
  const [personality, setPersonality] = useState('');
  const [coreTheme, setCoreTheme] = useState('');
  const [description, setDescription] = useState('');
  const [costumeDesc, setCostumeDesc] = useState('');
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('follow-reference');
  const [capturePreset, setCapturePreset] = useState<CapturePreset>('follow-reference');
  const [styleOverride, setStyleOverride] = useState<ImageStyleReference | null>();
  const globalStyle = resolveMidjourneyStyleSetting(settings);
  const styleReference = styleOverride === undefined ? (globalStyle.styleReferenceUrl ? { imageUrl: globalStyle.styleReferenceUrl } : undefined) : styleOverride || undefined;
  const [candidateCount, setCandidateCount] = useState<4 | 9>(4);
  const [references, setReferences] = useState<string[]>([]);
  const [conceptGridUrl, setConceptGridUrl] = useState('');
  const [concepts, setConcepts] = useState<string[]>([]);
  const [selectedConcept, setSelectedConcept] = useState('');
  const [bibleUrl, setBibleUrl] = useState('');
  const [busyStage, setBusyStage] = useState<'upload' | 'concepts' | 'bible' | null>(null);
  const [status, setStatus] = useState('填写角色简报，从多个方向中锁定最终形象。');
  const [pending, setPending] = useState<PendingDesign | null>(null);
  const [masterSource, setMasterSource] = useState<'midjourney' | 'upload' | 'generated'>('midjourney');
  const [masterPrompt, setMasterPrompt] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loaded, setLoaded] = useState(false);
  const snapshot = JSON.stringify({ name, role, age, personality, coreTheme, description, costumeDesc, selectedConcept, bibleUrl, masterSource, masterPrompt });
  const isSaved = savedSnapshot === snapshot;
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft) {
        setName(draft.name || ''); setRole(draft.role || ''); setAge(draft.age || '');
        setPersonality(draft.personality || ''); setCoreTheme(draft.coreTheme || '');
        setDescription(draft.description || ''); setCostumeDesc(draft.costumeDesc || '');
        setAestheticDirection(draft.aestheticDirection || ''); setDesignModel(draft.designModel || 'midjourney');
        setConcepts(draft.concepts || []); setSelectedConcept(draft.selectedConcept || '');
        setConceptGridUrl(draft.conceptGridUrl || ''); setBibleUrl(draft.bibleUrl || '');
        setMasterSource(draft.masterSource || 'upload'); setMasterPrompt(draft.masterPrompt || '');
        setPending(draft.pending || null); setSavedSnapshot(draft.savedSnapshot || '');
        setReferences(draft.references || []);
        setVisualStyle(draft.visualStyle || 'follow-reference'); setCapturePreset(draft.capturePreset || 'follow-reference');
        setStyleOverride(draft.styleOverride);
      }
    } catch { /* A damaged draft must not prevent using the module. */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...JSON.parse(snapshot), aestheticDirection, designModel, concepts,
        conceptGridUrl, pending, savedSnapshot, visualStyle, capturePreset, styleOverride, references: references.filter(url => /^https?:\/\//i.test(url)) }));
    } catch { setStatus('浏览器草稿保存失败；当前结果仍在，请先下载原图。'); }
  }, [loaded, snapshot, aestheticDirection, designModel, concepts, conceptGridUrl, pending, savedSnapshot, references, visualStyle, capturePreset, styleOverride]);

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
      if (incoming.some(file => !/^image\/(?:jpeg|png|webp)$/i.test(file.type))) throw new Error('请上传 PNG、JPEG 或 WebP 原图');
      const values = await Promise.all(incoming.map(readAsDataUrl));
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
      const url = await uploadReference.current(value);
      uploaded.push(url);
      setReferences(previous => previous.map(item => item === value ? url : item));
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
      const data = await readApiJson<{ status: string; imageUrl?: string; candidateUrls?: string[]; error?: string }>(response, '查询生图状态失败', { taskStatus: true });
      if (data.status === 'completed' && data.imageUrl) {
        return { imageUrl: await uploadReference.current(data.imageUrl), candidateUrls: data.candidateUrls };
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
    imageModel: designModel,
    aestheticDirection,
    capturePreset,
    styleReference,
    apiKey: settings.apiKey,
    comfyui: localComfyUISettings(settings.comfyui),
    midjourneyProfile: resolveMidjourneyProfileSetting(settings),
    midjourneyStyle: { ...globalStyle, styleWeight: settings.midjourneyStyleWeight ?? 100, styleReferenceUrl: styleReference?.imageUrl },
  });

  const finishTask = async (job: PendingDesign) => {
    const result = await pollImage(job.taskId, job.stage === 'extension' ? 'GPT 延展中' : '角色定稿生成中');
    if (job.stage === 'extension') {
      if (job.masterUrl === selectedConcept) setBibleUrl(result.imageUrl);
    } else {
      let choices: string[];
      if (isMidjourneyImageModel(job.model) || job.layout === 'single') {
        // MJ already returns independent full images. Never split a portrait.
        choices = result.candidateUrls?.length ? result.candidateUrls : [result.imageUrl];
      } else {
        const response = await fetch('/api/split-grid', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: result.imageUrl, gridSize: job.count === 4 ? 2 : 3 }) });
        const split = await readApiJson<{ cells: string[] }>(response, '草稿拆分失败');
        choices = split.cells.slice(0, job.count);
      }
      if (!choices.length) throw new Error('任务已完成但没有可选图片；保留任务编号');
      setConceptGridUrl(result.imageUrl); setConcepts(choices); setSelectedConcept(choices[0]); setBibleUrl('');
      setMasterSource(isMidjourneyImageModel(job.model) ? 'midjourney' : 'generated'); setMasterPrompt(job.prompt || '');
    }
    setPending(null);
    setStatus(job.stage === 'extension' ? 'GPT 延展完成，原始定稿仍是主参考。' : '选择满意的原图即可入库；GPT 延展为可选步骤。');
  };

  const resumeTask = async () => {
    if (!pending) return;
    setBusyStage(pending.stage === 'extension' ? 'bible' : 'concepts');
    try { await finishTask(pending); }
    catch (error) { setStatus(`${error instanceof Error ? error.message : '查询失败'}；任务编号已保留，可继续查询，不会重新生成。`); }
    finally { setBusyStage(null); }
  };

  const generateConcepts = async () => {
    if (!name.trim() || !description.trim()) {
      alert('请先填写角色名称和具体外观');
      return;
    }
    if (imageModelRequiresApiKey(designModel) && !settings.apiKey) {
      setShowSettings(true);
      return;
    }
    setBusyStage('concepts');
    try {
      if (pending && !confirm('已有保留任务。重新生成会创建新的付费任务，是否继续？')) return;
      const referenceImages = await ensureUploadedReferences();
      setStatus(isMj ? 'MJ 正在创作单幅角色候选…' : singleMaster ? 'GPT 正在生成单幅角色定稿…' : `生成 ${candidateCount} 个角色方向…`);
      const response = await fetch(imageApiUrl('/api/character-design', settings.comfyui, designModel), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commonPayload(), stage: 'concepts', candidateCount, referenceImages }),
      });
      const data = await readApiJson<{ taskId: string; prompt: string; layout?: PendingDesign['layout'] }>(response, '启动角色定稿失败');
      const job: PendingDesign = { taskId: data.taskId, prompt: data.prompt, layout: data.layout, model: designModel, stage: 'concepts', count: candidateCount };
      setPending(job);
      await finishTask(job);
    } catch (error) {
      setStatus('未完成；已有图片和任务编号保留，可继续查询。');
      alert(error instanceof Error ? error.message : '角色草稿生成失败');
    } finally {
      setBusyStage(null);
    }
  };

  const generateBible = async () => {
    if (!selectedConcept) return;
    if (!settings.apiKey) { setShowSettings(true); return; }
    setBusyStage('bible');
    try {
      if (pending && !confirm('已有保留任务。生成延展会创建新的付费任务，是否继续？')) return;
      setStatus('GPT 沿用定稿原图，扩展四个角度与表情…');
      const response = await fetch(imageApiUrl('/api/character-design', settings.comfyui, 'gpt-image-2'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commonPayload(), imageModel: 'gpt-image-2', stage: 'extension', selectedConceptUrl: selectedConcept }),
      });
      const data = await readApiJson<{ taskId: string }>(response, '启动角色卡生成失败');
      const job: PendingDesign = { taskId: data.taskId, model: 'gpt-image-2', stage: 'extension', count: 4, masterUrl: selectedConcept };
      setPending(job);
      await finishTask(job);
    } catch (error) {
      setStatus('完整角色卡生成失败');
      alert(error instanceof Error ? error.message : '完整角色卡生成失败');
    } finally {
      setBusyStage(null);
    }
  };

  const saveToLibrary = () => {
    if (!selectedConcept || !name.trim()) { alert('请填写角色名称并选定原图'); return; }
    try {
    const existing = parseStoredArray(localStorage.getItem(CHARACTER_DESIGNS_STORAGE_KEY));
    const old = existing.find((item: any) => item?.name?.trim().toLowerCase() === name.trim().toLowerCase()) as { id?: string } | undefined;
    const record = {
      id: old?.id || `character-${Date.now()}`,
      name: name.trim(),
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
      visualMaster: { ...makeCharacterVisualMaster(selectedConcept, masterSource, masterPrompt), extensionUrl: bibleUrl || undefined },
    };
    localStorage.setItem(CHARACTER_DESIGNS_STORAGE_KEY, JSON.stringify([record, ...existing.filter((item: any) => item?.name?.trim().toLowerCase() !== record.name.toLowerCase())].slice(0, 50)));

    const historyCharacter = characterFromDesignRecord(record);
    if (historyCharacter) {
      const history = parseStoredArray(localStorage.getItem(CHARACTER_HISTORY_STORAGE_KEY));
      localStorage.setItem(CHARACTER_HISTORY_STORAGE_KEY, JSON.stringify(upsertCharacterHistory(history, historyCharacter)));
    }
    setStatus('已存入 AID 角色库，可在 Story 的“历史角色”中直接引用。');
    setSavedSnapshot(snapshot);
    } catch { setStatus('角色库保存失败，请检查浏览器存储空间；原图仍保留。'); }
  };

  const adoptReference = async (source: string) => {
    setBusyStage('upload');
    try {
      const url = await uploadReference.current(source);
      setConcepts([url]); setSelectedConcept(url); setBibleUrl(''); setConceptGridUrl(url);
      setMasterSource('upload'); setMasterPrompt('');
      setStatus('已采用上传原图，无需重新生成；填写名称后即可入库。');
    } catch (error) { setStatus(error instanceof Error ? error.message : '原图上传失败'); }
    finally { setBusyStage(null); }
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
              <div><p className="aid-eyebrow">MJ Master → GPT Continuity</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-4xl">MJ 定审美，GPT 做延展</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">先定人物、服装、光线与质感；满意的原图直接入库。GPT 只沿用定稿扩展角度和表情，Story 再融合产品、还原分镜动作，不重新定义风格。</p></div>
              <div className="flex gap-2">
                {['审美简报', '原图定稿 / 入库', 'GPT 延展（可选）'].map((label, index) => <div key={label} className={`rounded-full border px-3 py-2 font-mono text-[10px] ${currentStep >= index + 1 ? 'border-[var(--accent-green)]/50 bg-[var(--accent-green)]/10 text-[var(--accent-green)]' : 'border-[var(--border-color)] text-[var(--text-muted)]'}`}>0{index + 1} {label}</div>)}
              </div>
            </header>

            <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
              <fieldset disabled={!loaded || busyStage !== null} className="aid-panel h-fit space-y-5 p-5 xl:sticky xl:top-6">
                <div><p className="aid-step-kicker">01 · Brief</p><h2 className="mt-1 text-lg font-semibold text-white">角色简报</h2></div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="col-span-2"><span className="aid-field-label">角色名称 *</span><input value={name} onChange={event => setName(event.target.value)} className="aid-input w-full" placeholder="例如：Meme" /></label>
                  <label><span className="aid-field-label">身份 / 角色</span><input value={role} onChange={event => setRole(event.target.value)} className="aid-input w-full" placeholder="美人鱼、侦探…" /></label>
                  <label><span className="aid-field-label">年龄</span><input value={age} onChange={event => setAge(event.target.value)} className="aid-input w-full" placeholder="童年、20岁左右…" /></label>
                  <label className="col-span-2"><span className="aid-field-label">性格关键词</span><input value={personality} onChange={event => setPersonality(event.target.value)} className="aid-input w-full" placeholder="好奇、顽皮、温柔、勇敢" /></label>
                  <label className="col-span-2"><span className="aid-field-label">核心主题</span><input value={coreTheme} onChange={event => setCoreTheme(event.target.value)} className="aid-input w-full" placeholder="角色在故事里代表什么" /></label>
                  <label className="col-span-2"><span className="aid-field-label">人物外观 / 主提示词 *</span><textarea value={description} onChange={event => setDescription(event.target.value)} className="aid-input min-h-28 w-full resize-y" placeholder="可以直接粘贴你的 MJ 提示词：人物、五官、发丝、服装、材质、姿态与氛围。中英文均可。" /></label>
                  <label className="col-span-2"><span className="aid-field-label">服装与造型方向</span><textarea value={costumeDesc} onChange={event => setCostumeDesc(event.target.value)} className="aid-input min-h-20 w-full resize-y" placeholder="服装单品、颜色、材质、配饰、妆发与不可改变的细节" /></label>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between"><span className="aid-field-label !mb-0">参考图</span><span className="font-mono text-[10px] text-[var(--text-muted)]">{references.length}/{referenceLimit}</span></div>
                  <div className="grid grid-cols-4 gap-2">
                    {references.map((image, index) => <div key={`${image.slice(0, 24)}-${index}`} className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-black/20"><img src={image} alt={`参考 ${index + 1}`} className="aspect-square w-full object-contain" /><button disabled={busyStage !== null} onClick={() => void adoptReference(image)} className="w-full py-1 text-[10px] text-[var(--accent-green)] disabled:opacity-50">直接采用原图</button><button disabled={busyStage !== null} onClick={() => setReferences(previous => previous.filter((_, itemIndex) => itemIndex !== index))} className="w-full py-1 text-[10px] text-[var(--text-muted)]">移除</button></div>)}
                    {references.length < referenceLimit && <label className="grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] hover:border-[var(--accent-green)] hover:text-[var(--accent-green)]"><Upload size={18} /><input type="file" accept="image/*" multiple className="hidden" onChange={event => { if (event.target.files) void uploadReferences(event.target.files); event.target.value = ''; }} /></label>}
                  </div>
                </div>

                <p className="text-xs text-[var(--text-muted)]">PNG / JPEG / WebP，单张最多 8 MB；保留原始像素，不自动缩图或重压缩。</p>
                <label><span className="aid-field-label">角色定稿模型（独立于 Story 生图设置）</span><select disabled={busyStage !== null} value={designModel} onChange={event => setDesignModel(event.target.value)} className="aid-input w-full">{APIMART_IMAGE_MODEL_OPTIONS.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>
                {singleMaster && <div className="space-y-3"><label className="block"><span className="aid-field-label">定稿制作风格</span><select aria-label="定稿制作风格" value={visualStyle} onChange={event => setVisualStyle(event.target.value as VisualStyle)} className="aid-input w-full">{PRODUCTION_STYLE_PRESETS.map(style => <option key={style.value} value={style.value}>{style.label} · {style.description}</option>)}</select></label><label className="block"><span className="aid-field-label">定稿拍摄方式</span><select aria-label="定稿拍摄方式" value={capturePreset} onChange={event => setCapturePreset(event.target.value as CapturePreset)} className="aid-input w-full">{CAPTURE_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label} · {preset.description}</option>)}</select></label><p className="text-xs text-[var(--text-muted)]">跟随参考不追加默认风格；选择其他项会加入对应的真实提示词。无参考图时由主提示词和审美方向定稿。避免同时填写相互矛盾的媒介或光线。</p></div>}
                <ImageStyleReferenceControls value={styleReference} onChange={value => setStyleOverride(value || null)} disabled={busyStage !== null} onBusy={busy => setBusyStage(busy ? 'upload' : null)} />
                {isMj && styleReference && <label><span className="aid-field-label">MJ 风格权重 --sw（0–1000）</span><input aria-label="MJ 风格权重" type="number" min={0} max={1000} value={settings.midjourneyStyleWeight ?? 100} onChange={event => saveSettings({ ...settings, midjourneyStyleWeight: Number(event.target.value) })} className="aid-input w-full" /></label>}
                <details className="text-xs text-[var(--text-muted)]"><summary>查看当前风格提示词</summary><pre className="mt-2 whitespace-pre-wrap break-words">{buildImageStyleControls({ visualStyle, capturePreset, hasStyleReference: Boolean(styleReference) }) || '不追加预设：沿用参考图或你的主提示词。'}{styleReference?.description ? `\n风格说明：${styleReference.description}` : ''}</pre></details>
                {singleMaster ? <div><label className="block"><span className="aid-field-label">{isMj ? 'MJ' : 'GPT'} 审美方向（可选，原样保留）</span><textarea value={aestheticDirection} onChange={event => setAestheticDirection(event.target.value)} className="aid-input min-h-24 w-full" placeholder="live-action fantasy movie scene, detailed realistic skin texture, flowing fabric, intricate gold jewelry, soft even lighting, gentle shadows…" /></label><button onClick={() => { if (!aestheticDirection || confirm('用“古装电影实拍质感”替换当前审美方向？')) setAestheticDirection(HISTORICAL_CINEMA_AESTHETIC); }} className="mt-2 text-xs text-[var(--accent-green)]">使用预设：古装电影实拍质感</button><p className="mt-2 text-xs text-[var(--text-muted)]">{isMj ? '一笔 MJ 任务返回独立候选原图，不生成拼图；不强制 Raw。Profile / 风格参考沿用设置中的显式选择。' : 'GPT 每次生成一张完整定稿。预设提取构图、光源、皮肤和材质写法，不固定贵妃身份或镜头参数。'} 此处只用于创作定稿，不叠加到后续分镜。</p></div> : <><div><span className="aid-field-label">定稿制作风格</span><select value={visualStyle} onChange={event => setVisualStyle(event.target.value as VisualStyle)} className="aid-input w-full">{PRODUCTION_STYLE_PRESETS.map(style => <option key={style.value} value={style.value}>{style.label}</option>)}</select></div><div><span className="aid-field-label">探索数量</span><div className="grid grid-cols-2 gap-2">{([4, 9] as const).map(count => <button key={count} onClick={() => setCandidateCount(count)} className={`rounded-lg border px-4 py-3 text-sm ${candidateCount === count ? 'border-[var(--accent-green)] text-[var(--accent-green)]' : 'border-[var(--border-color)]'}`}><LayoutGrid size={15} className="mr-2 inline" />{count} 个方向</button>)}</div></div></>}
                {pending && <div className="rounded-lg border border-[var(--border-color)] p-3"><p className="break-all text-xs">保留任务：{pending.taskId}</p><button onClick={() => void resumeTask()} disabled={busyStage !== null} className="mt-2 text-sm text-[var(--accent-green)] disabled:opacity-50">继续查询（不重新生成）</button></div>}
                <button onClick={generateConcepts} disabled={busyStage !== null} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-green)] px-4 py-3 text-sm font-medium text-[#06231f] disabled:opacity-50">{busyStage === 'concepts' || busyStage === 'upload' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{concepts.length ? '重新探索角色方向' : '生成角色草稿'}</button>
              </fieldset>

              <section className="space-y-6">
                <div className="aid-panel p-5">
                  <div className="mb-4 flex items-center justify-between"><div><p className="aid-step-kicker">02 · Concepts</p><h2 className="mt-1 text-lg font-semibold text-white">选择一个形象方向</h2></div>{conceptGridUrl && <a href={conceptGridUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent-green)]">查看母图</a>}</div>
                  {concepts.length ? <div className={`grid gap-3 ${concepts.length > 4 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{concepts.map((concept, index) => <button key={concept} disabled={busyStage !== null} onClick={() => { setSelectedConcept(concept); setBibleUrl(''); }} className={`group relative overflow-hidden rounded-xl border bg-black/20 text-left ${selectedConcept === concept ? 'border-[var(--accent-green)] shadow-[0_0_0_1px_var(--accent-green)]' : 'border-[var(--border-color)] hover:border-[var(--border-strong)]'}`}><img src={concept} alt={`角色方向 ${index + 1}`} className="aspect-[9/16] w-full object-contain" /><span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 font-mono text-[10px]">{String(index + 1).padStart(2, '0')}</span>{selectedConcept === concept && <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-green)] text-[#06231f]"><Check size={16} /></span>}</button>)}</div> : <div className="grid min-h-[390px] place-items-center rounded-xl border border-dashed border-[var(--border-color)] bg-black/10 text-center text-[var(--text-muted)]"><div><ImagePlus size={42} className="mx-auto mb-3 opacity-50" /><p className="text-sm">候选原图将在这里显示</p><p className="mt-2 text-xs">也可以上传现有 MJ 原图，点击“直接采用原图”</p></div></div>}
                  {concepts.length > 0 && <div className="mt-4 space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3"><div><p className="text-sm text-white">已选择方向 {selectedIndex + 1} {isSaved && <span className="ml-2 text-[var(--accent-green)]">✓ 已入库</span>}</p><p className="mt-1 text-xs text-[var(--text-muted)]">这张原图同时作为身份、审美和材质主参考，不会被延展图替换。</p></div><div className="flex flex-wrap gap-2"><button disabled={busyStage !== null || isSaved} onClick={saveToLibrary} className="rounded-lg bg-[var(--accent-green)] px-4 py-2.5 text-sm text-[#06231f] disabled:opacity-50"><Library size={15} className="mr-2 inline" />{isSaved ? '已入库' : '原图直接入库'}</button><button onClick={() => void downloadImage(selectedConcept, `${name || 'character'}-master.png`)} className="rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm">下载定稿原图</button><button onClick={generateBible} disabled={!selectedConcept || busyStage !== null} className="rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm disabled:opacity-50">{busyStage === 'bible' && <Loader2 size={16} className="mr-2 inline animate-spin" />}GPT 四宫格延展（可选）</button></div></div>}
                </div>

                <div className="aid-panel p-5">
                  <div className="mb-4 flex items-center justify-between"><div><p className="aid-step-kicker">03 · Optional GPT Extension</p><h2 className="mt-1 text-lg font-semibold text-white">角度与表情延展</h2></div><span className="font-mono text-[10px] text-[var(--text-muted)]">GPT-IMAGE-2 · 2×2</span></div>
                  {bibleUrl ? <><div className="overflow-hidden rounded-xl border border-[var(--border-color)]"><img src={bibleUrl} alt={`${name} GPT 延展`} className="w-full object-contain" /></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><button onClick={() => void downloadImage(bibleUrl, `${name || 'character'}-extension.png`)} className="rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm"><Download size={15} className="mr-2 inline" /> 下载延展图</button><button disabled={isSaved || busyStage !== null} onClick={saveToLibrary} className="rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm disabled:opacity-50"><Library size={15} className="mr-2 inline" />{isSaved ? '✓ 已入库' : '保存原图与延展'}</button><button onClick={generateBible} disabled={busyStage !== null} className="rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm disabled:opacity-50"><RefreshCw size={15} className="mr-2 inline" /> 重新延展</button></div></> : <div className="grid min-h-[260px] place-items-center rounded-xl border border-dashed border-[var(--border-color)] bg-black/10 text-center text-[var(--text-muted)]"><div><UserRound size={44} className="mx-auto mb-3 opacity-50" /><p className="text-sm">不需要延展？直接使用定稿原图即可。</p><p className="mt-2 max-w-md text-xs leading-5">如需补充角度，GPT 只延展同一人物、妆发、服装和质感，不生成中性灰底定妆照，也不另加风格词。</p></div></div>}
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
