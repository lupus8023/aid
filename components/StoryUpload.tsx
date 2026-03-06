'use client';

import { useState } from 'react';

interface StoryUploadProps {
  onStoryLoad: (content: string) => void;
}

export default function StoryUpload({ onStoryLoad }: StoryUploadProps) {
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [storyContent, setStoryContent] = useState('');
  const [textInput, setTextInput] = useState('');
  const [fileName, setFileName] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setStoryContent(content);
      setFileName(file.name);
      onStoryLoad(content);
    };
    reader.readAsText(file);
  };

  const handleTextSubmit = () => {
    if (textInput.trim()) {
      setStoryContent(textInput);
      onStoryLoad(textInput);
    }
  };

  return (
    <div className="bg-[var(--bg-secondary)] p-6 rounded border border-[var(--border-color)]">
      <h3 className="text-lg font-mono text-[var(--accent-green)] mb-4 flex items-center gap-2">
        <span className="text-[var(--accent-blue)]">{'{'}</span>
        story
        <span className="text-[var(--accent-blue)]">{'}'}</span>
      </h3>

      {/* Mode Selector */}
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

      {/* Text Input Mode */}
      {inputMode === 'text' && (
        <div className="mb-4">
          <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
            <span className="text-[var(--accent-orange)]">script:</span> Enter your story
          </label>
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Enter your story script here..."
            className="w-full h-64 p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)] resize-none"
          />
          <button
            onClick={handleTextSubmit}
            disabled={!textInput.trim()}
            className="mt-2 px-4 py-2 bg-[var(--accent-green)] text-[var(--bg-primary)] rounded font-mono text-sm hover:bg-[#5dd18d] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)] disabled:cursor-not-allowed transition-colors"
          >
            Load Story
          </button>
        </div>
      )}

      {/* File Upload Mode */}
      {inputMode === 'file' && (
        <div className="mb-4">
          <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
            <span className="text-[var(--accent-orange)]">script:</span> Markdown or Text file
          </label>
          <input
            type="file"
            accept=".md,.txt"
            onChange={handleFileUpload}
            className="w-full text-sm text-[var(--text-secondary)] font-mono file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-mono file:bg-[var(--accent-blue)] file:text-white hover:file:bg-[#0098ff] file:cursor-pointer"
          />
        </div>
      )}

      {storyContent && (
        <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-[var(--accent-yellow)]">loaded:</span>
            <span className="text-xs font-mono text-[var(--accent-green)]">
              {fileName || 'Direct Input'}
            </span>
          </div>
          <div className="bg-[var(--bg-primary)] p-4 rounded border border-[var(--border-color)] max-h-64 overflow-y-auto">
            <pre className="whitespace-pre-wrap text-sm font-mono text-[var(--text-primary)]">{storyContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
