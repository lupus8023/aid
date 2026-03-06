import { useState, useEffect } from 'react';
import { ObjectItem } from '@/types';
import { compressImageToThumbnail } from '@/utils/imageCompression';

const STORAGE_KEY = 'object_history';
const MAX_HISTORY = 20; // 最多保存20个历史记录（避免localStorage容量限制）

export function useObjectHistory() {
  const [history, setHistory] = useState<ObjectItem[]>([]);

  // 加载历史记录
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setHistory(parsed);
      }
    } catch (error) {
      console.error('Failed to load object history:', error);
    }
  }, []);

  // 添加到历史记录
  const addToHistory = async (object: ObjectItem) => {
    try {
      // 压缩图片为缩略图
      let thumbnailBase64 = '';
      if (object.imageFile) {
        thumbnailBase64 = await compressImageToThumbnail(object.imageFile);
      }

      // 保存名称、描述和缩略图
      const historyItem = {
        id: object.id,
        name: object.name,
        description: object.description,
        imageUrl: thumbnailBase64, // 保存缩略图
        imageBase64: thumbnailBase64, // 保存缩略图
      };

      // 检查是否已存在相同名称的物体
      const exists = history.some(o => o.name === object.name);
      if (exists) {
        // 如果存在，更新该物体
        const updated = history.map(o =>
          o.name === object.name ? historyItem : o
        );
        setHistory(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } else {
        // 如果不存在，添加新物体
        const updated = [historyItem, ...history].slice(0, MAX_HISTORY);
        setHistory(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    } catch (error: any) {
      console.error('Failed to save object to history:', error);
      if (error.name === 'QuotaExceededError') {
        alert('History storage is full. Please delete some items from history to continue.');
      }
    }
  };

  // 从历史记录中删除
  const removeFromHistory = (id: string) => {
    try {
      const updated = history.filter(o => o.id !== id);
      setHistory(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Failed to remove object from history:', error);
    }
  };

  // 清空历史记录
  const clearHistory = () => {
    try {
      setHistory([]);
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear object history:', error);
    }
  };

  return {
    history,
    addToHistory,
    removeFromHistory,
    clearHistory
  };
}
