'use client';

import { useState, useCallback, useRef } from 'react';
import { CapturePreset, Character, Storyboard, ObjectItem, ProjectProductionTiming, VisualStyle } from '@/types';
import type { StoryAspectRatio } from '@/lib/storyAspectRatio';
import { StoryPlan, PipelineState } from '@/lib/pipeline/types';
import { createProjectId } from '@/lib/projectIdentity';
import type { VideoSegmentPlan } from '@/lib/videoSegments';

const CURRENT_PROJECT_V2_KEY = 'aid:current-project:v2';
const LEGACY_CURRENT_PROJECT_KEY = 'currentProject';

export interface ProjectData {
  id?: string;
  name: string;
  characters: Character[];
  objects?: ObjectItem[];
  storyContent: string;
  language?: 'zh' | 'en';
  targetShotCount?: number;
  aspectRatio?: StoryAspectRatio;
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
  productionTiming?: ProjectProductionTiming;
  storyOutline: string;
  storyboards: Storyboard[];
  // 全量持久化：音色参考 / 定妆 bible / 场景参考 / 编剧计划 / 编排状态
  voiceReferences?: Record<string, string>;
  costumeImages?: Record<string, string>;
  sceneImages?: string[];
  storyPlan?: StoryPlan;
  videoSegmentPlan?: VideoSegmentPlan;
  pipelineState?: PipelineState;
  createdAt: string;
  updatedAt: string;
}

// 判断 imageUrl 是否为可长期访问的云端 URL（blob URL 在刷新后失效）
function hasPublicUrl(imageUrl?: string): boolean {
  return typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl);
}

// 清洗角色：保留 voiceId（音色参考依赖它，之前被误删）；有云端 URL 时丢弃 base64 省空间，
// 否则用 base64 兜底（blob URL 不可持久化）；丢弃不可序列化的 File 对象。
function cleanCharacter(char: Character): Character {
  return {
    id: char.id,
    name: char.name,
    description: char.description,
    imageUrl: char.imageUrl || '',
    voiceId: char.voiceId,
    voiceProfile: char.voiceProfile,
    voiceSource: char.voiceSource,
    gender: char.gender,
    ageGroup: char.ageGroup,
    ...(hasPublicUrl(char.imageUrl) ? {} : { imageBase64: char.imageBase64 }),
  };
}

// 清洗物件：与角色同规则（修复之前角色/物件不对称的问题）。
function cleanObject(obj: ObjectItem): ObjectItem {
  return {
    id: obj.id,
    name: obj.name,
    description: obj.description,
    imageUrl: obj.imageUrl || '',
    ...(hasPublicUrl(obj.imageUrl) ? {} : { imageBase64: obj.imageBase64 }),
  };
}

// blob URL 只在当前页面生命周期有效。项目文件只保存云端兜底地址和
// IndexedDB cache key，刷新后再从持久化视频缓存创建新的 blob URL。
function cleanStoryboard(storyboard: Storyboard): Storyboard {
  const videoUrl = storyboard.videoUrl?.startsWith('blob:')
    ? storyboard.videoSourceUrl
    : storyboard.videoUrl;
  return { ...storyboard, videoUrl };
}

export function useProject() {
  const [projectId, setProjectId] = useState(createProjectId);
  const [projectName, setProjectName] = useState('未命名项目');
  const lastKnownUpdatedAtRef = useRef<string>();

  // 保存项目到本地存储
  const saveProject = useCallback((data: Partial<ProjectData>) => {
    const targetId = data.id || projectId;
    try {
      // New builds read from a private v2 slot. Tabs that still execute an
      // older deployed bundle can keep writing the legacy key, but they can no
      // longer replace the active project's script, paid task ids or caches.
      const existingRaw = localStorage.getItem(CURRENT_PROJECT_V2_KEY);
      const existing = existingRaw ? JSON.parse(existingRaw) as Partial<ProjectData> : undefined;
      const existingTime = Date.parse(String(existing?.updatedAt || ''));
      const knownTime = Date.parse(String(lastKnownUpdatedAtRef.current || ''));
      if (existing?.id === targetId
        && Number.isFinite(existingTime)
        && Number.isFinite(knownTime)
        && existingTime > knownTime) {
        console.warn('跳过过期标签页的项目保存：检测到同项目已有更新版本');
        return;
      }
    } catch {
      // A malformed prior value is handled by the normal overwrite path.
    }
    const updatedAt = new Date().toISOString();
    const projectData: ProjectData = {
      id: targetId,
      name: data.name || projectName,
      characters: (data.characters || []).map(cleanCharacter),
      objects: (data.objects || []).map(cleanObject),
      storyContent: data.storyContent || '',
      language: data.language,
      targetShotCount: data.targetShotCount,
      aspectRatio: data.aspectRatio,
      visualStyle: data.visualStyle,
      capturePreset: data.capturePreset,
      productionTiming: data.productionTiming,
      storyOutline: data.storyOutline || '',
      storyboards: (data.storyboards || []).map(cleanStoryboard),
      voiceReferences: data.voiceReferences,
      costumeImages: data.costumeImages,
      sceneImages: data.sceneImages,
      storyPlan: data.storyPlan,
      videoSegmentPlan: data.videoSegmentPlan,
      pipelineState: data.pipelineState,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt,
    };

    try {
      const serialized = JSON.stringify(projectData);
      localStorage.setItem(CURRENT_PROJECT_V2_KEY, serialized);
      // Keep the legacy slot readable by an older Companion, but never use it
      // as the authority once v2 exists.
      localStorage.setItem(LEGACY_CURRENT_PROJECT_KEY, serialized);
      lastKnownUpdatedAtRef.current = updatedAt;
      console.log('项目已保存:', projectName);
    } catch (error) {
      console.error('保存项目失败:', error);
      // 如果仍然超限，尝试只保存基本信息（丢弃体积大的资产）
      try {
        const minimalData = {
          name: projectName,
          characters: projectData.characters,
          storyContent: '',
          language: projectData.language,
          targetShotCount: projectData.targetShotCount,
          aspectRatio: projectData.aspectRatio,
          visualStyle: projectData.visualStyle,
          capturePreset: projectData.capturePreset,
          productionTiming: projectData.productionTiming,
          storyOutline: '',
          storyboards: [],
          createdAt: projectData.createdAt,
          updatedAt: projectData.updatedAt
        };
        const serialized = JSON.stringify(minimalData);
        localStorage.setItem(CURRENT_PROJECT_V2_KEY, serialized);
        localStorage.setItem(LEGACY_CURRENT_PROJECT_KEY, serialized);
        lastKnownUpdatedAtRef.current = updatedAt;
        console.log('已保存最小化项目数据');
      } catch (fallbackError) {
        console.error('无法保存项目，存储空间不足');
      }
    }
  }, [projectId, projectName]);

  // 从本地存储加载项目
  const loadProject = useCallback(() => {
    const saved = localStorage.getItem(CURRENT_PROJECT_V2_KEY)
      || localStorage.getItem(LEGACY_CURRENT_PROJECT_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved) as ProjectData;
        lastKnownUpdatedAtRef.current = data.updatedAt;
        const id = data.id || createProjectId();
        if (!data.id) {
          data.id = id;
        }
        // One-way migration makes future reads immune to legacy tabs.
        localStorage.setItem(CURRENT_PROJECT_V2_KEY, JSON.stringify(data));
        setProjectId(id);
        setProjectName(data.name);
        return data;
      } catch (error) {
        console.error('加载项目失败:', error);
      }
    }
    return null;
  }, []);

  // 导出项目为 JSON
  const exportProject = useCallback((data: ProjectData) => {
    const json = JSON.stringify({ ...data, id: data.id || projectId, storyboards: data.storyboards.map(cleanStoryboard) }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [projectId]);

  const adoptProjectId = useCallback((id?: string): string => {
    const nextId = id || createProjectId();
    if (nextId !== projectId) lastKnownUpdatedAtRef.current = undefined;
    setProjectId(nextId);
    return nextId;
  }, [projectId]);

  // 创建新项目
  const newProject = useCallback(() => {
    if (confirm('创建新项目将清空当前数据，是否继续？')) {
      localStorage.removeItem(CURRENT_PROJECT_V2_KEY);
      localStorage.removeItem(LEGACY_CURRENT_PROJECT_KEY);
      lastKnownUpdatedAtRef.current = undefined;
      setProjectName('未命名项目');
      window.location.reload();
    }
  }, []);

  return {
    projectId,
    projectName,
    setProjectName,
    saveProject,
    loadProject,
    exportProject,
    adoptProjectId,
    newProject
  };
}
