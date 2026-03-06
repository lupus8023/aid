'use client';

import { Save, FolderPlus, Download, RefreshCw, FolderOpen, Settings, Home } from 'lucide-react';
import Link from 'next/link';

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
      <div className="flex items-center gap-2 md:gap-4 min-w-0">
        <Link href="/">
          <img
            src="/logo.png"
            alt="AI Storyboard Studio"
            className="h-6 md:h-8 flex-shrink-0 cursor-pointer"
          />
        </Link>
        <span className="hidden md:inline text-xs text-[var(--text-secondary)]">|</span>
        <input
          type="text"
          value={projectName}
          onChange={(e) => onProjectNameChange?.(e.target.value)}
          className="text-xs font-mono text-[var(--text-primary)] bg-transparent border-b border-transparent hover:border-[var(--border-color)] focus:border-[var(--accent-blue)] focus:outline-none px-1 transition-colors min-w-0 max-w-[100px] md:max-w-none"
          placeholder="Project name"
        />
      </div>

      {/* Right: Action Buttons */}
      <div className="flex items-center gap-1 md:gap-2">
        <Link href="/">
          <button className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors">
            <Home size={14} />
            <span className="hidden md:inline">Home</span>
          </button>
        </Link>

        <button
          onClick={onSettings}
          className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
        >
          <Settings size={14} />
          <span className="hidden md:inline">Settings</span>
        </button>

        <button
          onClick={onNewProject}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
        >
          <FolderPlus size={14} />
          New
        </button>

        <button
          onClick={onOpen}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
        >
          <FolderOpen size={14} />
          Open
        </button>

        <button
          onClick={onSave}
          className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded transition-colors"
        >
          <Save size={14} />
          <span className="hidden md:inline">Save</span>
        </button>

        <button
          onClick={onExport}
          className="hidden md:flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
        >
          <Download size={14} />
          Export
        </button>
      </div>
    </div>
  );
}
