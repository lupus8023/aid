'use client';

import { useState, useCallback, useEffect } from 'react';
import { AppSettings } from '@/types';
import { SEEDREAM_5_PRO } from '@/lib/imageModels';

const DEFAULT_SETTINGS: AppSettings = {
  apiProvider: 'apimart',
  apiKey: process.env.NEXT_PUBLIC_APIMART_API_KEY || '',
  scriptProvider: 'auto',
  scriptModel: 'gpt-4o',
  imageModel: SEEDREAM_5_PRO,
  midjourneyProfileEnabled: true,
  midjourneyProfile: 'votj2t8',
  videoModel: 'doubao-seedance-1-5-pro',
  videoProvider: 'apimart',
  fal: {
    apiKey: '',
    resolution: '768P',
    promptExpansionMode: 'disabled',
  },
  comfyui: {
    sshHost: 'me21gb3rds8p0h44.ssh.x-gpu.com',
    sshPort: 43213,
    sshUser: 'root',
    sshKeyPath: '~/.ssh/id_ed25519',
    useLocalCompanion: true,
    localCompanionUrl: 'http://127.0.0.1:3018',
    comfyPort: 8188,
    workflowRoot: '/root/ComfyUI',
    imageWorkflowPath: '',
    multiImageWorkflowPath: '',
    firstLastWorkflowPath: '',
    h3Fl2vaProfile: 'balanced8',
    timeoutSeconds: 7200,
  },
  aspectRatio: '16:9', // 默认横屏
};

const LEGACY_VIDEO_MODEL_MAP: Record<string, string> = {
  'grok-imagine-1.0-video-apimart': 'grok-imagine-1.5-video-apimart',
};

const LEGACY_IMAGE_MODEL_MAP: Record<string, string> = {
  'doubao-seedream-5-0-lite': SEEDREAM_5_PRO,
};

function migrateSettings(settings: AppSettings): AppSettings {
  const migratedVideoModel = LEGACY_VIDEO_MODEL_MAP[settings.videoModel] || settings.videoModel;
  const migratedImageModel = LEGACY_IMAGE_MODEL_MAP[settings.imageModel] || settings.imageModel;
  const legacyComfyUI = settings.comfyui as (AppSettings['comfyui'] & {
    sshPrivateKey?: string;
    sshPrivateKeyPassphrase?: string;
  }) | undefined;
  const legacyKeyPath = String(legacyComfyUI?.sshKeyPath || '');
  const comfyui = {
    ...DEFAULT_SETTINGS.comfyui!,
    ...(legacyComfyUI || {}),
    sshKeyPath: /^(?:\/|~\/)/.test(legacyKeyPath)
      ? legacyKeyPath
      : DEFAULT_SETTINGS.comfyui!.sshKeyPath,
    useLocalCompanion: legacyComfyUI?.useLocalCompanion ?? true,
    localCompanionUrl: legacyComfyUI?.localCompanionUrl || 'http://127.0.0.1:3018',
  };
  delete comfyui.sshPrivateKey;
  delete comfyui.sshPrivateKeyPassphrase;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    scriptProvider: settings.scriptProvider || 'auto',
    imageModel: migratedImageModel,
    videoModel: migratedVideoModel,
    videoProvider: settings.videoProvider || 'apimart',
    fal: {
      ...DEFAULT_SETTINGS.fal,
      ...(settings.fal || {}),
    },
    comfyui,
  };
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // 从 localStorage 加载设置
  useEffect(() => {
    const saved = localStorage.getItem('appSettings');
    if (saved) {
      try {
        const parsed = migrateSettings(JSON.parse(saved) as AppSettings);
        setSettings(parsed);
        localStorage.setItem('appSettings', JSON.stringify(parsed));
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }
  }, []);

  // 保存设置到 localStorage
  const saveSettings = useCallback((newSettings: AppSettings) => {
    const migrated = migrateSettings(newSettings);
    setSettings(migrated);
    localStorage.setItem('appSettings', JSON.stringify(migrated));
  }, []);

  // 重置为默认设置
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.setItem('appSettings', JSON.stringify(DEFAULT_SETTINGS));
    console.log('Settings reset to defaults');
  }, []);

  return {
    settings,
    saveSettings,
    resetSettings,
  };
}
