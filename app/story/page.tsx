'use client';

import { useState, useEffect } from 'react';
import DevToolsLayout from '@/components/DevToolsLayout';
import Toolbar from '@/components/Toolbar';
import StatusBar from '@/components/StatusBar';
import StepIndicator from '@/components/StepIndicator';
import Step1 from '@/components/Step1';
import Step2 from '@/components/Step2';
import Step3 from '@/components/Step3';
import Step4 from '@/components/Step4';
import SettingsModal from '@/components/SettingsModal';
import { Character, ObjectItem, Storyboard } from '@/types';
import { useProject } from '@/hooks/useProject';
import { useSettings } from '@/hooks/useSettings';

export default function StoryPage() {
  const { projectName, setProjectName, saveProject, loadProject, exportProject, newProject } = useProject();
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [objects, setObjects] = useState<ObjectItem[]>([]);
  const [storyContent, setStoryContent] = useState('');
  const [storyOutline, setStoryOutline] = useState('');
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const savedProject = loadProject();
    if (savedProject) {
      setCharacters(savedProject.characters);
      setStoryContent(savedProject.storyContent);
      setStoryOutline(savedProject.storyOutline);
      setStoryboards(savedProject.storyboards);
      if (savedProject.storyboards.length > 0) {
        setCurrentStep(4);
      } else if (savedProject.storyOutline) {
        setCurrentStep(3);
      } else if (savedProject.storyContent && savedProject.characters.length > 0) {
        setCurrentStep(2);
      }
    }
  }, [loadProject]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (characters.length > 0 || objects.length > 0 || storyContent || storyboards.length > 0) {
        saveProject({
          characters,
          objects,
          storyContent,
          storyOutline,
          storyboards,
          createdAt: new Date().toISOString()
        });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [characters, objects, storyContent, storyOutline, storyboards, saveProject]);

  const handleSave = () => {
    saveProject({
      characters,
      objects,
      storyContent,
      storyOutline,
      storyboards,
      createdAt: new Date().toISOString()
    });
    alert('项目已保存！');
  };

  const handleOpen = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        setProjectName(data.name || 'Untitled Project');
        setCharacters(data.characters || []);
        setObjects(data.objects || []);
        setStoryContent(data.storyContent || '');
        setStoryOutline(data.storyOutline || '');
        setStoryboards(data.storyboards || []);
        if (data.storyboards?.length > 0) {
          setCurrentStep(4);
        } else if (data.storyOutline) {
          setCurrentStep(3);
        } else if (data.storyContent && data.characters?.length > 0) {
          setCurrentStep(2);
        } else {
          setCurrentStep(1);
        }
        alert('Project loaded successfully!');
      } catch (error) {
        alert('Failed to load project file');
      }
    };
    input.click();
  };

  const handleExport = () => {
    exportProject({
      name: projectName,
      characters,
      objects,
      storyContent,
      storyOutline,
      storyboards,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  };

  const handleRetry = async (storyboard: Storyboard) => {
    setStoryboards(prev =>
      prev.map(sb =>
        sb.id === storyboard.id ? { ...sb, status: 'generating' } : sb
      )
    );
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboard,
          characters,
          objects,
          aspectRatio: storyboard.aspectRatio || settings.aspectRatio,
          imageModel: settings.imageModel,
          apiKey: settings.apiKey
        })
      });
      if (!response.ok) throw new Error('Failed to generate image');
      const data = await response.json();
      setStoryboards(prev =>
        prev.map(sb =>
          sb.id === storyboard.id
            ? { ...sb, status: 'completed', imageUrl: data.imageUrl, taskId: data.taskId }
            : sb
        )
      );
    } catch (error) {
      setStoryboards(prev =>
        prev.map(sb =>
          sb.id === storyboard.id ? { ...sb, status: 'failed' } : sb
        )
      );
    }
  };

  const handleUpdateStoryboard = (updatedStoryboard: Storyboard) => {
    setStoryboards(prev =>
      prev.map(sb =>
        sb.id === updatedStoryboard.id ? updatedStoryboard : sb
      )
    );
  };

  const pollVideoStatus = async (storyboardId: string, taskId: string) => {
    const maxAttempts = 180;
    const intervalMs = 10000;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        const response = await fetch('/api/check-video-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            apiKey: settings.apiKey
          })
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data.status === 'completed' && data.videoUrl) {
          setStoryboards(prev =>
            prev.map(sb =>
              sb.id === storyboardId
                ? { ...sb, videoStatus: 'completed', videoUrl: data.videoUrl }
                : sb
            )
          );
          return;
        }
        if (data.status === 'failed') {
          setStoryboards(prev =>
            prev.map(sb =>
              sb.id === storyboardId ? { ...sb, videoStatus: 'failed' } : sb
            )
          );
          return;
        }
      } catch (error) {
        console.error('Error polling video status:', error);
      }
    }
    setStoryboards(prev =>
      prev.map(sb =>
        sb.id === storyboardId ? { ...sb, videoStatus: 'failed' } : sb
      )
    );
  };

  const handleGenerateVideo = async (storyboard: Storyboard) => {
    if (!settings.apiKey) {
      alert('请先在设置中配置 API Key');
      return;
    }
    setStoryboards(prev =>
      prev.map(sb =>
        sb.id === storyboard.id ? { ...sb, videoStatus: 'generating' } : sb
      )
    );
    try {
      const response = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboard,
          apiKey: settings.apiKey,
          videoModel: settings.videoModel,
          aspectRatio: storyboard.aspectRatio || settings.aspectRatio
        })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate video');
      }
      const data = await response.json();
      setStoryboards(prev =>
        prev.map(sb =>
          sb.id === storyboard.id
            ? { ...sb, videoTaskId: data.taskId }
            : sb
        )
      );
      pollVideoStatus(storyboard.id, data.taskId);
    } catch (error) {
      alert(`视频生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setStoryboards(prev =>
        prev.map(sb =>
          sb.id === storyboard.id ? { ...sb, videoStatus: 'failed' } : sb
        )
      );
    }
  };

  const handleGenerateOutline = async () => {
    if (!storyContent) {
      alert('请先上传故事文件');
      return;
    }
    if (characters.length === 0) {
      alert('请先添加至少一个角色');
      return;
    }
    setIsAnalyzing(true);
    try {
      const response = await fetch('/api/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyContent, characters, objects, apiKey: settings.apiKey })
      });
      if (!response.ok) throw new Error('Failed to generate outline');
      const data = await response.json();
      setStoryOutline(data.outline);
      setCurrentStep(2);
    } catch (error) {
      alert('大纲生成失败，请检查 API 配置');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeStory = async () => {
    setIsAnalyzing(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyContent, characters, objects, aspectRatio: settings.aspectRatio, apiKey: settings.apiKey })
      });
      if (!response.ok) throw new Error('Failed to analyze story');
      const data = await response.json();
      setStoryboards(data.storyboards);
      setCurrentStep(3);
    } catch (error) {
      alert('故事分析失败，请检查 API 配置');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateImages = async () => {
    setIsGenerating(true);
    setCurrentStep(4);
    for (let i = 0; i < storyboards.length; i++) {
      const storyboard = storyboards[i];
      setStoryboards(prev =>
        prev.map(sb =>
          sb.id === storyboard.id ? { ...sb, status: 'generating' } : sb
        )
      );
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyboard,
            characters,
            aspectRatio: storyboard.aspectRatio || settings.aspectRatio,
            imageModel: settings.imageModel
          })
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to generate image');
        }
        const data = await response.json();
        setStoryboards(prev =>
          prev.map(sb =>
            sb.id === storyboard.id
              ? { ...sb, status: 'completed', imageUrl: data.imageUrl, taskId: data.taskId }
              : sb
          )
        );
      } catch (error) {
        setStoryboards(prev =>
          prev.map(sb =>
            sb.id === storyboard.id ? { ...sb, status: 'failed' } : sb
          )
        );
      }
    }
    setIsGenerating(false);
    alert('所有分镜图片生成完成！');
  };

  return (
    <DevToolsLayout
      toolbar={
        <Toolbar
          projectName={projectName}
          onProjectNameChange={setProjectName}
          onNewProject={newProject}
          onOpen={handleOpen}
          onSave={handleSave}
          onExport={handleExport}
          onSettings={() => setShowSettings(true)}
        />
      }
      statusBar={
        <StatusBar
          totalScenes={storyboards.length}
          completedScenes={storyboards.filter(s => s.status === 'completed').length}
          failedScenes={storyboards.filter(s => s.status === 'failed').length}
          isGenerating={isGenerating}
          currentTask={isAnalyzing ? '分析故事中...' : isGenerating ? '生成图片中...' : undefined}
        />
      }
    >
      <div className="h-full overflow-y-auto bg-[var(--bg-primary)]">
        <div className="max-w-7xl mx-auto p-6">
          <StepIndicator
            currentStep={currentStep}
            steps={['Setup', 'Outline', 'Scenes', 'Render']}
          />
          {currentStep === 1 && (
            <Step1
              characters={characters}
              objects={objects}
              storyContent={storyContent}
              onCharactersChange={setCharacters}
              onObjectsChange={setObjects}
              onStoryLoad={setStoryContent}
              onNext={handleGenerateOutline}
              isLoading={isAnalyzing}
            />
          )}
          {currentStep === 2 && (
            <Step2
              outline={storyOutline}
              onBack={() => setCurrentStep(1)}
              onNext={handleAnalyzeStory}
              isLoading={isAnalyzing}
            />
          )}
          {currentStep === 3 && (
            <Step3
              storyboards={storyboards}
              onBack={() => setCurrentStep(2)}
              onNext={handleGenerateImages}
              onRetry={handleRetry}
              onGenerateVideo={handleGenerateVideo}
            />
          )}
          {currentStep === 4 && (
            <Step4
              storyboards={storyboards}
              isGenerating={isGenerating}
              onBack={() => setCurrentStep(3)}
              onRetry={handleRetry}
              onGenerateVideo={handleGenerateVideo}
              onUpdate={handleUpdateStoryboard}
            />
          )}
        </div>
      </div>
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />
    </DevToolsLayout>
  );
}
