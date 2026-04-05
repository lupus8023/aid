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
import Step5 from '@/components/Step5';
import Step6 from '@/components/Step6';
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
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [costumeImages, setCostumeImages] = useState<Record<string, string>>({}); // { 角色名: URL }
  const [costumeGenerating, setCostumeGenerating] = useState<Record<string, boolean>>({}); // { 角色名: bool }
  const [sceneImage, setSceneImage] = useState<string>('');
  const [sceneGenerating, setSceneGenerating] = useState(false);

  useEffect(() => {
    const savedProject = loadProject();
    if (savedProject) {
      setCharacters(savedProject.characters || []);
      setObjects(savedProject.objects || []);
      setStoryContent(savedProject.storyContent || '');
      setStoryboards(savedProject.storyboards || []);
      if (savedProject.storyboards?.length > 0) setCurrentStep(4);
      else if (savedProject.storyContent && savedProject.characters?.length > 0) setCurrentStep(2);
    }
  }, [loadProject]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (characters.length > 0 || storyContent || storyboards.length > 0) {
        saveProject({ characters, objects, storyContent, storyOutline: '', storyboards, createdAt: new Date().toISOString() });
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [characters, objects, storyContent, storyboards, saveProject]);

  const handleSave = () => {
    saveProject({ characters, objects, storyContent, storyOutline: '', storyboards, createdAt: new Date().toISOString() });
    alert('Project saved!');
  };

  const handleOpen = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        setProjectName(data.name || 'Untitled Project');
        setCharacters(data.characters || []);
        setObjects(data.objects || []);
        setStoryContent(data.storyContent || '');
        setStoryboards(data.storyboards || []);
        if (data.storyboards?.length > 0) setCurrentStep(4);
        else if (data.storyContent && data.characters?.length > 0) setCurrentStep(2);
        else setCurrentStep(1);
        alert('Project loaded!');
      } catch {
        alert('Failed to load project file');
      }
    };
    input.click();
  };

  const handleExport = () => {
    exportProject({ name: projectName, characters, objects, storyContent, storyOutline: '', storyboards, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  const handleUpdateStoryboard = (updated: Storyboard) => {
    setStoryboards(prev => prev.map(sb => sb.id === updated.id ? updated : sb));
  };

  // Step2 → Step3: generate shot script from story + characters
  const handleGenerateScript = async () => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
    setIsLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyContent, characters, objects, aspectRatio: settings.aspectRatio, apiKey: settings.apiKey, language: settings.language || 'zh' })
      });
      if (!response.ok) throw new Error('Failed to generate script');
      const data = await response.json();
      setStoryboards(data.storyboards);
      setCurrentStep(3);
    } catch (error) {
      alert(`Script generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Step4: individual image generation
  const handleGenerateImage = async (storyboard: Storyboard) => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, status: 'generating' } : sb));
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard, characters, objects, aspectRatio: storyboard.aspectRatio || settings.aspectRatio, imageModel: settings.imageModel, apiKey: settings.apiKey, costumeImages, sceneImage })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed to generate image');
      const data = await response.json();
      pollImageStatus(storyboard.id, data.taskId);
    } catch (error) {
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, status: 'failed' } : sb));
    }
  };

  const pollImageStatus = async (storyboardId: string, taskId: string) => {
    for (let i = 0; i < 90; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      try {
        const response = await fetch('/api/check-image-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey: settings.apiKey })
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data.status === 'completed' && data.imageUrl) {
          setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, status: 'completed', imageUrl: data.imageUrl, taskId } : sb));
          return;
        }
        if (data.status === 'failed') {
          setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, status: 'failed' } : sb));
          return;
        }
      } catch { /* continue polling */ }
    }
    setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, status: 'failed' } : sb));
  };

  const handleGenerateCostume = async (type: 'costume' | 'scene', characterName?: string) => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
    const character = characterName ? characters.find(c => c.name === characterName) : undefined;
    const sceneStyle = storyboards[0]?.sceneStyle;

    if (type === 'costume' && characterName) {
      setCostumeGenerating(prev => ({ ...prev, [characterName]: true }));
    } else {
      setSceneGenerating(true);
    }

    try {
      const response = await fetch('/api/generate-costume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, name: characterName,
          description: character?.description || '',
          costumeDesc: characterName ? storyboards[0]?.characterCostume?.[characterName] : undefined,
          sceneStyle,
          referenceImageUrl: character?.imageUrl,
          aspectRatio: settings.aspectRatio,
          imageModel: settings.imageModel,
          apiKey: settings.apiKey
        })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed');
      const { taskId } = await response.json();

      // Poll for completion
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch('/api/check-image-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey: settings.apiKey })
        });
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        if (statusData.status === 'completed' && statusData.imageUrl) {
          if (type === 'costume' && characterName) {
            setCostumeImages(prev => ({ ...prev, [characterName]: statusData.imageUrl }));
          } else {
            setSceneImage(statusData.imageUrl);
          }
          return;
        }
        if (statusData.status === 'failed') throw new Error('Image generation failed');
      }
      throw new Error('Timeout');
    } catch (error) {
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (type === 'costume' && characterName) {
        setCostumeGenerating(prev => ({ ...prev, [characterName]: false }));
      } else {
        setSceneGenerating(false);
      }
    }
  };

  const handleGenerateVideoPrompt = async (storyboard: Storyboard) => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: 'generating...' } : sb));
    try {
      const response = await fetch('/api/generate-video-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard, apiKey: settings.apiKey })
      });
      if (!response.ok) throw new Error('Failed to generate video prompt');
      const data = await response.json();
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: data.videoPrompt } : sb));
    } catch (error) {
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoPrompt: '' } : sb));
      alert(`Failed to generate video prompt`);
    }
  };

  const handleGenerateAudio = async (storyboard: Storyboard) => {
    if (!settings.fishAudioKey) { alert('Please configure Fish Audio API Key in settings'); return; }
    const hasLines = (storyboard.dialogueLines?.length ?? 0) > 0 || Object.keys(storyboard.dialogue || {}).length > 0;
    if (!hasLines) return;

    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, audioStatus: 'generating' } : sb));
    try {
      // Use ordered dialogueLines if available, fall back to dialogue object
      const rawLines = storyboard.dialogueLines?.length
        ? storyboard.dialogueLines
        : Object.entries(storyboard.dialogue || {}).map(([character, text]) => ({ character, text }));

      const lines = rawLines
        .filter(l => l.text?.trim())
        .map(l => ({
          character: l.character,
          text: l.text,
          voiceId: characters.find(c => c.name === l.character)?.voiceId
        }));

      const response = await fetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, fishAudioKey: settings.fishAudioKey })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed');
      const { characterAudios } = await response.json();

      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id
        ? { ...sb, audioStatus: 'completed', characterAudios }
        : sb
      ));
    } catch (error) {
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, audioStatus: 'failed' } : sb));
      alert(`Audio generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleGenerateVideo = async (storyboard: Storyboard) => {
    if (!settings.apiKey) { alert('Please configure API Key in settings'); return; }
    setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoStatus: 'generating' } : sb));
    try {
      const response = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard, apiKey: settings.apiKey, videoModel: settings.videoModel, aspectRatio: storyboard.aspectRatio || settings.aspectRatio, characterAudios: storyboard.characterAudios || [] })
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Failed to generate video');
      const data = await response.json();
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoTaskId: data.taskId } : sb));
      pollVideoStatus(storyboard.id, data.taskId);
    } catch (error) {
      alert(`Video generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStoryboards(prev => prev.map(sb => sb.id === storyboard.id ? { ...sb, videoStatus: 'failed' } : sb));
    }
  };

  const pollVideoStatus = async (storyboardId: string, taskId: string) => {
    for (let i = 0; i < 180; i++) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      try {
        const response = await fetch('/api/check-video-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, apiKey: settings.apiKey })
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data.status === 'completed' && data.videoUrl) {
          setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, videoStatus: 'completed', videoUrl: data.videoUrl } : sb));
          return;
        }
        if (data.status === 'failed') {
          setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, videoStatus: 'failed' } : sb));
          return;
        }
      } catch { /* continue polling */ }
    }
    setStoryboards(prev => prev.map(sb => sb.id === storyboardId ? { ...sb, videoStatus: 'failed' } : sb));
  };

  const completedImages = storyboards.filter(s => s.status === 'completed').length;
  const completedVideos = storyboards.filter(s => s.videoStatus === 'completed').length;

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
          completedScenes={completedImages}
          failedScenes={storyboards.filter(s => s.status === 'failed').length}
          isGenerating={isLoading}
          currentTask={isLoading ? 'Generating script...' : undefined}
        />
      }
    >
      <div className="h-full overflow-y-auto bg-[var(--bg-primary)]">
        <div className="max-w-7xl mx-auto p-3 md:p-6">
          <StepIndicator
            currentStep={currentStep}
            steps={['Characters', 'Story', 'Script', 'Images', 'Videos', 'Export']}
          />
          {currentStep === 1 && (
            <Step2
              characters={characters}
              objects={objects}
              onCharactersChange={setCharacters}
              onObjectsChange={setObjects}
              onBack={() => {}}
              onNext={() => setCurrentStep(2)}
              isLoading={false}
            />
          )}
          {currentStep === 2 && (
            <Step1
              storyContent={storyContent}
              onStoryLoad={setStoryContent}
              onNext={handleGenerateScript}
              onBack={() => setCurrentStep(1)}
              isLoading={isLoading}
              language={settings.language || 'zh'}
              onLanguageChange={(lang) => saveSettings({ ...settings, language: lang })}
            />
          )}
          {currentStep === 3 && (
            <Step3
              storyboards={storyboards}
              characters={characters}
              objects={objects}
              costumeImages={costumeImages}
              costumeGenerating={costumeGenerating}
              sceneImage={sceneImage}
              sceneGenerating={sceneGenerating}
              onBack={() => setCurrentStep(2)}
              onNext={() => setCurrentStep(4)}
              onUpdate={handleUpdateStoryboard}
              onGenerateCostume={handleGenerateCostume}
            />
          )}
          {currentStep === 4 && (
            <Step4
              storyboards={storyboards}
              onBack={() => setCurrentStep(3)}
              onNext={() => setCurrentStep(5)}
              onGenerateImage={handleGenerateImage}
              onRetry={handleGenerateImage}
              onUpdate={handleUpdateStoryboard}
            />
          )}
          {currentStep === 5 && (
            <Step5
              storyboards={storyboards}
              characters={characters}
              onBack={() => setCurrentStep(4)}
              onNext={() => setCurrentStep(6)}
              onGenerateVideo={handleGenerateVideo}
              onGenerateVideoPrompt={handleGenerateVideoPrompt}
              onGenerateAudio={handleGenerateAudio}
              onUpdate={handleUpdateStoryboard}
            />
          )}
          {currentStep === 6 && (
            <Step6
              storyboards={storyboards}
              onBack={() => setCurrentStep(5)}
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
