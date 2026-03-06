'use client';

import { Save, FolderPlus, Download, RefreshCw, FolderOpen, Settings } from 'lucide-react';

interface ToolbarProps {
  onNewProject: () => void;
  onSave: () => void;
  onExport: () => void;
  onOpen: () => void;
  onSettings: () => void;
  projectName?: string;
  onProjectNameChange?: (name: string) => void;
}

export default function Toolbar({
  onNewProject,
  onSave,
  onExport,
  onOpen,
  onSettings,
  projectName = 'Untitled Project',
  onProjectNameChange
}: ToolbarProps) {
  return (
    <div className="flex items-center justify-between w-full">
      {/* Left: Project Name */}
      <div className="flex items-center gap-4">
        <img
          src="/logo.png"
          alt="AI Storyboard Studio"
          className="h-8"
        />
        <span className="text-xs text-[var(--text-secondary)]">|</span>
        <input
          type="text"
          value={projectName}
          onChange={(e) => onProjectNameChange?.(e.target.value)}
          className="text-xs font-mono text-[var(--text-primary)] bg-transparent border-b border-transparent hover:border-[var(--border-color)] focus:border-[var(--accent-blue)] focus:outline-none px-1 transition-colors"
          placeholder="Project name"
        />
      </div>

      {/* Right: Action Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSettings}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
        >
          <Settings size={14} />
          Settings
        </button>

        <button
          onClick={onNewProject}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
        >
          <FolderPlus size={14} />
          New
        </button>

        <button
          onClick={onOpen}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
        >
          <FolderOpen size={14} />
          Open
        </button>

        <button
          onClick={onSave}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded transition-colors"
        >
          <Save size={14} />
          Save
        </button>

        <button
          onClick={onExport}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
        >
          <Download size={14} />
          Export
        </button>
      </div>
    </div>
  );
}
