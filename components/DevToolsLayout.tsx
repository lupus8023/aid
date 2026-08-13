'use client';

import { ReactNode } from 'react';

interface DevToolsLayoutProps {
  children: ReactNode;
  toolbar?: ReactNode;
  sidebar?: ReactNode;
  statusBar?: ReactNode;
}

export default function DevToolsLayout({
  children,
  toolbar,
  sidebar,
  statusBar
}: DevToolsLayoutProps) {
  return (
    <div className="flex h-screen min-h-[560px] flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Top Toolbar */}
      {toolbar && (
        <div className="relative z-30 flex h-14 shrink-0 items-center border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/95 px-3 shadow-[0_8px_32px_-24px_var(--shadow)] backdrop-blur md:px-5">
          {toolbar}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Left Sidebar */}
        {sidebar && (
          <div className="w-80 shrink-0 overflow-y-auto border-r border-[var(--border-color)] bg-[var(--bg-secondary)]">
            {sidebar}
          </div>
        )}

        {/* Center Content */}
        <main className="min-w-0 flex-1 overflow-y-auto scroll-smooth">
          {children}
        </main>
      </div>

      {/* Bottom Status Bar */}
      {statusBar && (
        <div className="flex h-8 shrink-0 items-center border-t border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 text-xs">
          {statusBar}
        </div>
      )}
    </div>
  );
}
