'use client';

import { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { readApiJson } from '@/lib/apiResponse';
import { fetchStoryApi } from '@/lib/comfyuiClient';
import { DEFAULT_TARGET_SHOT_COUNT, SHOT_COUNT_OPTIONS, targetDurationSeconds } from '@/lib/pipeline/shotCount';
import type { AppSettings } from '@/types';
import type { StoryAspectRatio } from '@/lib/storyAspectRatio';

interface Step1Props {
  storyContent: string;
  onStoryLoad: (content: string) => void;
  onNext: () => void;
  onBack?: () => void;
  isLoading?: boolean;
  language?: 'zh' | 'en';
  onLanguageChange?: (lang: 'zh' | 'en') => void;
  targetShotCount?: number;
  onTargetShotCountChange?: (count: number) => void;
  apiKey?: string;
  scriptProvider?: AppSettings['scriptProvider'];
  scriptModel?: string;
  dmxApiKey?: string;
  companionSettings?: AppSettings['comfyui'];
  aspectRatio?: StoryAspectRatio;
  onAspectRatioChange?: (aspectRatio: StoryAspectRatio) => void;
}

export default function Step1({ storyContent, onStoryLoad, onNext, onBack, isLoading, language = 'zh', onLanguageChange, targetShotCount = DEFAULT_TARGET_SHOT_COUNT, onTargetShotCountChange, apiKey, scriptProvider, scriptModel, dmxApiKey, companionSettings, aspectRatio = '16:9', onAspectRatioChange }: Step1Props) {
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [textInput, setTextInput] = useState(storyContent);
  const [isAdapting, setIsAdapting] = useState(false);
  const estimatedSeconds = targetDurationSeconds(targetShotCount);
  const estimatedDuration = estimatedSeconds >= 60
    ? `${Math.floor(estimatedSeconds / 60)}分${estimatedSeconds % 60 ? `${estimatedSeconds % 60}秒` : ''}`
    : `${estimatedSeconds}秒`;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setTextInput(content);
      onStoryLoad(content);
    };
    reader.readAsText(file);
  };

  const handleTextChange = (value: string) => {
    setTextInput(value);
    onStoryLoad(value);
  };

  const handleAdapt = async () => {
    if (!textInput.trim() || (!apiKey && !dmxApiKey)) return;
    setIsAdapting(true);
    try {
      const res = await fetchStoryApi('/api/expand-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: textInput, language, targetShotCount, apiKey, scriptProvider, scriptModel, dmxApiKey })
      }, companionSettings);
      if (!res.ok || !String(res.headers.get('content-type') || '').includes('text/event-stream')) {
        const unexpected = await readApiJson<{ error?: string }>(res, '剧本改编失败');
        throw new Error(unexpected.error || '剧本改编服务返回了非流式响应');
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.script) {
              setTextInput(data.script);
              onStoryLoad(data.script);
            }
          }
        }
      }
    } catch (error) {
      alert(`剧本改编失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsAdapting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="aid-page-lead">
        <div><p className="aid-eyebrow">Step 02 · Story brief</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">输入故事构想</h2><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">一句话也可以。AID 会先完成故事创作，再交付每镜动作、微表情、逐字台词与导演分镜。</p></div>
      </div>

      <section className="rounded-lg border border-[var(--accent-purple)]/25 bg-[var(--accent-purple)]/5 p-4">
        <p className="text-sm font-semibold text-white">智能编剧模式</p>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">你只需要提供人物和一个核心念头；系统会补全人物欲望、阻碍、转折、高潮选择和结局，并把每个剧情节拍变成演员能执行、视频模型能理解的镜头。</p>
        <div className="mt-3 flex flex-wrap gap-2">{['故事结构', '动作走位', '微表情与视线', '逐字台词', '镜头与剪辑'].map(label => <span key={label} className="rounded-full border border-white/10 bg-black/10 px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">{label}</span>)}</div>
      </section>

      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-mono text-[var(--text-secondary)]">输出语言</span>
        <button
          onClick={() => onLanguageChange?.('zh')}
          className={`px-3 py-1 rounded font-mono text-xs transition-colors ${language === 'zh' ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
        >中文</button>
        <button
          onClick={() => onLanguageChange?.('en')}
          className={`px-3 py-1 rounded font-mono text-xs transition-colors ${language === 'en' ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
        >English</button>
      </div>

      <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold text-[var(--text-primary)]">成片画幅</p><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">画幅会在剧本阶段锁定，并统一应用到分镜图、H3 视频和最终导出。</p></div>
          <div className="grid grid-cols-3 gap-2">
            {(['16:9', '9:16', '1:1'] as const).map(ratio => <button key={ratio} type="button" aria-pressed={aspectRatio === ratio} onClick={() => onAspectRatioChange?.(ratio)} className={`flex min-w-[104px] items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${aspectRatio === ratio ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]' : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--accent-blue)]'}`}><span className={`block rounded-sm border border-current ${ratio === '9:16' ? 'h-8 w-[18px]' : ratio === '1:1' ? 'h-7 w-7' : 'h-[18px] w-8'}`} /><span className="text-left"><b className="block font-mono text-xs">{ratio}</b><small className="text-[9px]">{ratio === '9:16' ? '竖屏' : ratio === '1:1' ? '方形' : '横屏'}</small></span></button>)}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">目标镜头数</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">剧本会先按这个数量分配情节与场次，再逐镜撰写。</p>
          </div>
          <p className="font-mono text-xs text-[var(--accent-blue)]">预计片长 ≈ {estimatedDuration}</p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {SHOT_COUNT_OPTIONS.map((count) => (
            <button
              key={count}
              type="button"
              aria-pressed={targetShotCount === count}
              onClick={() => onTargetShotCountChange?.(count)}
              className={`rounded border px-3 py-2 font-mono text-sm transition-colors ${
                targetShotCount === count
                  ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                  : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--accent-blue)] hover:text-[var(--text-primary)]'
              }`}
            >
              {count} 镜
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
          按平均每镜约 5 秒估算，实际片长会根据台词、动作和情绪停顿微调。
          {targetShotCount >= 45 ? ' 长篇剧本生成时间与模型消耗会明显增加。' : ''}
        </p>
      </section>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setInputMode('text')}
          className={`flex-1 py-2 px-4 rounded font-mono text-sm transition-colors ${
            inputMode === 'text'
              ? 'bg-[var(--accent-blue)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          直接输入
        </button>
        <button
          onClick={() => setInputMode('file')}
          className={`flex-1 py-2 px-4 rounded font-mono text-sm transition-colors ${
            inputMode === 'file'
              ? 'bg-[var(--accent-blue)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          上传文件
        </button>
      </div>

      {inputMode === 'text' ? (
        <div className="relative">
          <textarea
            value={textInput}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="例如：一位从不说谎的律师，为救女儿必须在法庭上撒一次谎。其余人物欲望、冲突、动作、表情和台词由系统完成。也可继续写明“必须”“不要”“结尾是”等硬性要求…"
            className="w-full h-64 p-4 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] resize-none"
          />
          {(apiKey || dmxApiKey) && (
            <button
              onClick={handleAdapt}
              disabled={!textInput.trim() || isAdapting}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-[var(--accent-purple,#a855f7)] hover:bg-[#9333ea] text-white disabled:opacity-50 rounded transition-colors"
            >
              {isAdapting ? <><Loader2 size={11} className="animate-spin" /> 正在改编…</> : <><Wand2 size={11} /> 改编剧本</>}
            </button>
          )}
        </div>
      ) : (
        <input
          type="file"
          accept=".md,.txt"
          onChange={handleFileUpload}
          className="w-full text-sm text-[var(--text-secondary)] font-mono file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-mono file:bg-[var(--accent-blue)] file:text-white hover:file:bg-[#0098ff] file:cursor-pointer"
        />
      )}

      <div className="flex justify-between pt-4 border-t border-[var(--border-color)]">
        {onBack && (
          <button onClick={onBack} className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-6 py-2.5 rounded font-mono text-sm hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2">
            <span>←</span> 返回
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!textInput.trim() || isLoading}
          className="ml-auto bg-[var(--accent-blue)] text-white px-6 py-2.5 rounded font-mono text-sm hover:bg-[#0098ff] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? <span className="animate-pulse">正在创作故事与演员调度…</span> : '智能生成电影级剧本 →'}
        </button>
      </div>
    </div>
  );
}
