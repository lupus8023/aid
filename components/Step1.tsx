'use client';

import { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';

interface Step1Props {
  storyContent: string;
  onStoryLoad: (content: string) => void;
  onNext: () => void;
  onBack?: () => void;
  isLoading?: boolean;
  language?: 'zh' | 'en';
  onLanguageChange?: (lang: 'zh' | 'en') => void;
  apiKey?: string;
  scriptModel?: string;
}

export default function Step1({ storyContent, onStoryLoad, onNext, onBack, isLoading, language = 'zh', onLanguageChange, apiKey, scriptModel }: Step1Props) {
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [textInput, setTextInput] = useState(storyContent);
  const [isExpanding, setIsExpanding] = useState(false);

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

  const handleExpand = async () => {
    if (!textInput.trim() || !apiKey) return;
    setIsExpanding(true);
    try {
      const res = await fetch('/api/expand-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: textInput, language, apiKey, scriptModel })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
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
      alert(`Expand failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExpanding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[var(--accent-blue)] pl-4 mb-8">
        <h2 className="text-2xl font-mono text-[var(--accent-green)] mb-2">
          <span className="text-[var(--text-secondary)]">02.</span> Story Brief
        </h2>
        <p className="text-[var(--text-secondary)] font-mono text-sm">
          Enter your story concept or synopsis
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-mono text-[var(--text-secondary)]">Output Language:</span>
        <button
          onClick={() => onLanguageChange?.('zh')}
          className={`px-3 py-1 rounded font-mono text-xs transition-colors ${language === 'zh' ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
        >中文</button>
        <button
          onClick={() => onLanguageChange?.('en')}
          className={`px-3 py-1 rounded font-mono text-xs transition-colors ${language === 'en' ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
        >English</button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setInputMode('text')}
          className={`flex-1 py-2 px-4 rounded font-mono text-sm transition-colors ${
            inputMode === 'text'
              ? 'bg-[var(--accent-blue)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          Direct Input
        </button>
        <button
          onClick={() => setInputMode('file')}
          className={`flex-1 py-2 px-4 rounded font-mono text-sm transition-colors ${
            inputMode === 'file'
              ? 'bg-[var(--accent-blue)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          Upload File
        </button>
      </div>

      {inputMode === 'text' ? (
        <div className="relative">
          <textarea
            value={textInput}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Enter your story brief, concept, or synopsis here..."
            className="w-full h-64 p-4 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] resize-none"
          />
          {apiKey && (
            <button
              onClick={handleExpand}
              disabled={!textInput.trim() || isExpanding}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-[var(--accent-purple,#a855f7)] hover:bg-[#9333ea] text-white disabled:opacity-50 rounded transition-colors"
            >
              {isExpanding ? <><Loader2 size={11} className="animate-spin" /> Expanding...</> : <><Wand2 size={11} /> AI Expand</>}
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
            <span>←</span> Back
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!textInput.trim() || isLoading}
          className="ml-auto bg-[var(--accent-blue)] text-white px-6 py-2.5 rounded font-mono text-sm hover:bg-[#0098ff] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? <span className="animate-pulse">Generating script...</span> : 'Next: Generate Script →'}
        </button>
      </div>
    </div>
  );
}
