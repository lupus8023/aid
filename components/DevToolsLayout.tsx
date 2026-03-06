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
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Top Toolbar */}
      {toolbar && (
        <div className="h-12 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center px-4">
          {toolbar}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        {sidebar && (
          <div className="w-80 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] overflow-y-auto">
            {sidebar}
          </div>
        )}

        {/* Center Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>

      {/* Bottom Status Bar */}
      {statusBar && (
        <div className="h-8 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center px-4 text-xs">
          {statusBar}
        </div>
      )}
    </div>
  );
}
