'use client';

import { useState, useCallback, useEffect } from 'react';
import { AppSettings } from '@/types';

const DEFAULT_SETTINGS: AppSettings = {
  apiProvider: 'apimart',
  apiKey: process.env.NEXT_PUBLIC_APIMART_API_KEY || '',
  scriptModel: 'gpt-4o',
  imageModel: 'doubao-seedream-5-0-lite',
  videoModel: 'doubao-seedance-1-5-pro',
  aspectRatio: '16:9', // 默认横屏
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // 从 localStorage 加载设置
  useEffect(() => {
    const saved = localStorage.getItem('appSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as AppSettings;
        setSettings(parsed);
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }
  }, []);

  // 保存设置到 localStorage
  const saveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('appSettings', JSON.stringify(newSettings));
    console.log('Settings saved:', newSettings);
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
