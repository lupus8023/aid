'use client';

import Link from 'next/link';
import { Smartphone, Film } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-6">
      <div className="max-w-5xl w-full">
          <div className="text-center mb-12">
            <img src="/logo.png" alt="AI Video Studio" className="h-24 mx-auto mb-6" />
            <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-3">Choose Your Creation Mode</h1>
            <p className="text-[var(--text-secondary)] text-base">Select how you want to create videos</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Image to Video */}
            <Link href="/image-to-video">
              <div className="group bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-6 cursor-pointer hover:border-[var(--accent-blue)] transition-all">
                <div className="w-12 h-12 bg-[var(--accent-blue)] bg-opacity-10 rounded-lg flex items-center justify-center mb-4">
                  <Smartphone className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Image to Video</h2>
                <p className="text-[var(--text-secondary)] text-sm mb-3">Upload images, add motion descriptions and camera parameters to generate professional videos</p>
                <ul className="text-xs text-[var(--text-secondary)] space-y-1">
                  <li>• Multiple camera parameters</li>
                  <li>• Custom lens specifications</li>
                  <li>• Professional motion control</li>
                </ul>
              </div>
            </Link>

            {/* AI Story Generation */}
            <Link href="/story">
              <div className="group bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-6 cursor-pointer hover:border-[var(--accent-blue)] transition-all">
                <div className="w-12 h-12 bg-[var(--accent-blue)] bg-opacity-10 rounded-lg flex items-center justify-center mb-4">
                  <Film className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">AI Story Generation</h2>
                <p className="text-[var(--text-secondary)] text-sm mb-3">Automatically analyze stories, generate complete storyboards and videos</p>
                <ul className="text-xs text-[var(--text-secondary)] space-y-1">
                  <li>• Intelligent story analysis</li>
                  <li>• Auto-generate storyboards</li>
                  <li>• Batch video generation</li>
                </ul>
              </div>
            </Link>
          </div>
        </div>
      </div>
  );
}
