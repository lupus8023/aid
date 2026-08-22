'use client';

import { scopedVideoCacheKey } from './projectIdentity';

const DATABASE_NAME = 'aid-media-cache';
const DATABASE_VERSION = 1;
const VIDEO_STORE = 'videos';

interface CachedVideoRecord {
  key: string;
  blob: Blob;
  sourceUrl?: string;
  storedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持本地视频缓存'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(VIDEO_STORE)) {
        database.createObjectStore(VIDEO_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地视频缓存'));
  });
}

export function videoCacheKeyForStoryboard(projectId: string, storyboardId: string, generationSignature?: string): string {
  return scopedVideoCacheKey(projectId, storyboardId, generationSignature);
}

export async function requestPersistentVideoStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function putCachedVideo(key: string, blob: Blob, sourceUrl?: string): Promise<void> {
  if (!blob.size) throw new Error('视频文件为空，无法保存到本地');
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(VIDEO_STORE, 'readwrite');
      transaction.objectStore(VIDEO_STORE).put({
        key,
        blob,
        sourceUrl,
        storedAt: new Date().toISOString(),
      } satisfies CachedVideoRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('本地视频写入失败'));
      transaction.onabort = () => reject(transaction.error || new Error('本地视频写入已取消'));
    });
  } finally {
    database.close();
  }
}

export async function getCachedVideo(key: string): Promise<CachedVideoRecord | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(VIDEO_STORE, 'readonly').objectStore(VIDEO_STORE).get(key);
      request.onsuccess = () => resolve(request.result as CachedVideoRecord | undefined);
      request.onerror = () => reject(request.error || new Error('本地视频读取失败'));
    });
  } finally {
    database.close();
  }
}

export async function cacheVideoSource(key: string, sourceUrl: string): Promise<{ objectUrl: string; size: number }> {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`视频下载失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  await putCachedVideo(key, blob, sourceUrl.startsWith('http') ? sourceUrl : undefined);
  return { objectUrl: URL.createObjectURL(blob), size: blob.size };
}

export async function cachedVideoObjectUrl(key: string): Promise<string | undefined> {
  const record = await getCachedVideo(key);
  return record?.blob?.size ? URL.createObjectURL(record.blob) : undefined;
}
