import { useState, useEffect } from 'react';
import { Character } from '@/types';
import { compressImageToThumbnail } from '@/utils/imageCompression';
import {
  CHARACTER_DESIGNS_STORAGE_KEY,
  CHARACTER_HISTORY_STORAGE_KEY,
  mergeCharacterHistory,
  parseStoredArray,
  upsertCharacterHistory,
} from '@/lib/characterLibrary';

export function useCharacterHistory() {
  const [history, setHistory] = useState<Character[]>([]);

  // 加载历史记录
  useEffect(() => {
    try {
      const saved = parseStoredArray(localStorage.getItem(CHARACTER_HISTORY_STORAGE_KEY));
      const designs = parseStoredArray(localStorage.getItem(CHARACTER_DESIGNS_STORAGE_KEY));
      const merged = mergeCharacterHistory(saved, designs);
      setHistory(merged);
      localStorage.setItem(CHARACTER_HISTORY_STORAGE_KEY, JSON.stringify(merged));
    } catch (error) {
      console.error('Failed to load character history:', error);
    }
  }, []);

  // 添加到历史记录
  const addToHistory = async (character: Character) => {
    try {
      // 压缩图片为缩略图
      let thumbnailBase64 = '';
      if (character.imageFile) {
        thumbnailBase64 = await compressImageToThumbnail(character.imageFile);
      }

      // 保存名称、描述和缩略图
      const historyItem = {
        id: character.id,
        name: character.name,
        description: character.description,
        imageUrl: thumbnailBase64,
        imageBase64: thumbnailBase64,
        voiceId: character.voiceId,
      };

      const saved = parseStoredArray(localStorage.getItem(CHARACTER_HISTORY_STORAGE_KEY));
      const updated = upsertCharacterHistory(saved, historyItem);
      setHistory(updated);
      localStorage.setItem(CHARACTER_HISTORY_STORAGE_KEY, JSON.stringify(updated));
    } catch (error: any) {
      console.error('Failed to save character to history:', error);
      if (error.name === 'QuotaExceededError') {
        alert('History storage is full. Please delete some items from history to continue.');
      }
    }
  };

  // 从历史记录中删除
  const removeFromHistory = (id: string) => {
    try {
      const updated = history.filter(c => c.id !== id);
      setHistory(updated);
      localStorage.setItem(CHARACTER_HISTORY_STORAGE_KEY, JSON.stringify(updated));
      const designs = parseStoredArray(localStorage.getItem(CHARACTER_DESIGNS_STORAGE_KEY));
      localStorage.setItem(CHARACTER_DESIGNS_STORAGE_KEY, JSON.stringify(
        designs.filter(item => !item || typeof item !== 'object' || (item as { id?: string }).id !== id),
      ));
    } catch (error) {
      console.error('Failed to remove character from history:', error);
    }
  };

  // 清空历史记录
  const clearHistory = () => {
    try {
      setHistory([]);
      localStorage.removeItem(CHARACTER_HISTORY_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear character history:', error);
    }
  };

  return {
    history,
    addToHistory,
    removeFromHistory,
    clearHistory
  };
}
