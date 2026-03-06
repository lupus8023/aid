'use client';

import { useState, useCallback } from 'react';
import { Character, Storyboard } from '@/types';

export interface ProjectData {
  name: string;
  characters: Character[];
  storyContent: string;
  storyOutline: string;
  storyboards: Storyboard[];
  createdAt: string;
  updatedAt: string;
}

export function useProject() {
  const [projectName, setProjectName] = useState('未命名项目');

  // 保存项目到本地存储
  const saveProject = useCallback((data: Partial<ProjectData>) => {
    // 清理角色数据，移除大体积的 base64 和 File 对象
    const cleanedCharacters = (data.characters || []).map(char => ({
      id: char.id,
      name: char.name,
      description: char.description,
      imageUrl: char.imageUrl,
      // 不保存 imageBase64 和 imageFile，避免超出 localStorage 限制
    }));

    const projectData: ProjectData = {
      name: projectName,
      characters: cleanedCharacters,
      storyContent: data.storyContent || '',
      storyOutline: data.storyOutline || '',
      storyboards: data.storyboards || [],
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      localStorage.setItem('currentProject', JSON.stringify(projectData));
      console.log('项目已保存:', projectName);
    } catch (error) {
      console.error('保存项目失败:', error);
      // 如果仍然超限，尝试只保存基本信息
      try {
        const minimalData = {
          name: projectName,
          characters: cleanedCharacters,
          storyContent: '',
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
