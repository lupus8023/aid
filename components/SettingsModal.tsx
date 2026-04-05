'use client';

import { useState, useEffect } from 'react';
import { AppSettings } from '@/types';
import { X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave
}: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);

  // 当 settings 或 isOpen 变化时，更新 localSettings
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
    }
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-color)]">
          <h2 className="text-xl font-mono text-[var(--accent-green)]">
            <span className="text-[var(--text-secondary)]">{'<'}</span>
            Settings
            <span className="text-[var(--text-secondary)]">{' />'}</span>
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* API Provider */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              API Provider
            </label>
            <select
              value={localSettings.apiProvider}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                apiProvider: e.target.value as AppSettings['apiProvider']
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="apimart">APIMart</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              API Key
            </label>
            <input
              type="password"
              value={localSettings.apiKey}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                apiKey: e.target.value
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              placeholder="Enter your API key"
            />
          </div>

          {/* Script Model */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Script Generation Model
            </label>
            <input
              type="text"
              value={localSettings.scriptModel}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                scriptModel: e.target.value
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              placeholder="e.g., gpt-4o, claude-3-opus"
            />
          </div>

          {/* Image Model */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Image Generation Model
            </label>
            <select
              value={localSettings.imageModel}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                imageModel: e.target.value
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="doubao-seedream-5-0-lite">doubao-seedream-5-0-lite</option>
              <option value="doubao-seedance-4-5">doubao-seedance-4-5</option>
              <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview</option>
            </select>
          </div>

          {/* Video Model */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Video Generation Model
            </label>
            <select
              value={localSettings.videoModel}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                videoModel: e.target.value
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="sora-2-vip">sora-2-vip</option>
              <option value="doubao-seedance-2.0">doubao-seedance-2.0</option>
              <option value="doubao-seedance-2.0-fast">doubao-seedance-2.0-fast</option>
              <option value="doubao-seedance-1-5-pro">doubao-seedance-1-5-pro</option>
              <option value="veo3.1-fast">veo3.1-fast (Fast)</option>
              <option value="veo3.1-quality">veo3.1-quality</option>
            </select>
          </div>

          {/* Fish Audio API Key */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Fish Audio API Key
            </label>
            <input
              type="password"
              value={localSettings.fishAudioKey || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, fishAudioKey: e.target.value })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              placeholder="fish.audio API key for TTS"
            />
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Aspect Ratio (横屏/竖屏)
            </label>
            <select
              value={localSettings.aspectRatio}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                aspectRatio: e.target.value as '16:9' | '9:16' | '1:1'
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="16:9">16:9 (横屏 Landscape)</option>
              <option value="9:16">9:16 (竖屏 Portrait)</option>
              {localSettings.videoModel.includes('seedance') && (
                <option value="1:1">1:1 (方形 Square)</option>
              )}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-[var(--border-color)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
