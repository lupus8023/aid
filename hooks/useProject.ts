'use client';

import { useState, useCallback } from 'react';
import { Character, Storyboard, ObjectItem } from '@/types';
import { StoryPlan, PipelineState } from '@/lib/pipeline/types';

export interface ProjectData {
  name: string;
  characters: Character[];
  objects?: ObjectItem[];
  storyContent: string;
  targetShotCount?: number;
  storyOutline: string;
  storyboards: Storyboard[];
  // 全量持久化：音色参考 / 定妆 bible / 场景参考 / 编剧计划 / 编排状态
  voiceReferences?: Record<string, string>;
  costumeImages?: Record<string, string>;
  sceneImages?: string[];
  storyPlan?: StoryPlan;
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

export function useProject() {
  const [projectName, setProjectName] = useState('未命名项目');

  // 保存项目到本地存储
  const saveProject = useCallback((data: Partial<ProjectData>) => {
    const projectData: ProjectData = {
      name: projectName,
      characters: (data.characters || []).map(cleanCharacter),
      objects: (data.objects || []).map(cleanObject),
      storyContent: data.storyContent || '',
      targetShotCount: data.targetShotCount,
      storyOutline: data.storyOutline || '',
      storyboards: data.storyboards || [],
      voiceReferences: data.voiceReferences,
      costumeImages: data.costumeImages,
      sceneImages: data.sceneImages,
      storyPlan: data.storyPlan,
      pipelineState: data.pipelineState,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      localStorage.setItem('currentProject', JSON.stringify(projectData));
      console.log('项目已保存:', projectName);
    } catch (error) {
      console.error('保存项目失败:', error);
      // 如果仍然超限，尝试只保存基本信息（丢弃体积大的资产）
      try {
        const minimalData = {
          name: projectName,
          characters: projectData.characters,
          storyContent: '',
          targetShotCount: projectData.targetShotCount,
          storyOutline: '',
          storyboards: [],
          createdAt: projectData.createdAt,
          updatedAt: projectData.updatedAt
        };
        localStorage.setItem('currentProject', JSON.stringify(minimalData));
        console.log('已保存最小化项目数据');
      } catch (fallbackError) {
        console.error('无法保存项目，存储空间不足');
      }
    }
  }, [projectName]);

  // 从本地存储加载项目
  const loadProject = useCallback(() => {
    const saved = localStorage.getItem('currentProject');
    if (saved) {
      try {
        const data = JSON.parse(saved) as ProjectData;
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
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // 创建新项目
  const newProject = useCallback(() => {
    if (confirm('创建新项目将清空当前数据，是否继续？')) {
      localStorage.removeItem('currentProject');
      setProjectName('未命名项目');
      window.location.reload();
    }
  }, []);

  return {
    projectName,
    setProjectName,
    saveProject,
    loadProject,
    exportProject,
    newProject
  };
}
