// 使用示例 - 如何集成新的 UI 组件

import DevToolsLayout from '@/components/DevToolsLayout';
import Toolbar from '@/components/Toolbar';
import StatusBar from '@/components/StatusBar';
import StoryboardCard from '@/components/StoryboardCard';
import { useProject } from '@/hooks/useProject';

export default function ImprovedPage() {
  const { projectName, saveProject, exportProject, newProject } = useProject();

  // 你的现有状态...
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);

  // 重试失败的分镜
  const handleRetry = async (storyboard: Storyboard) => {
    // 重新生成该分镜
    setStoryboards(prev =>
      prev.map(sb =>
        sb.id === storyboard.id ? { ...sb, status: 'generating' } : sb
      )
    );

    // 调用生成 API
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard, characters })
      });

      const data = await response.json();

      setStoryboards(prev =>
        prev.map(sb =>
          sb.id === storyboard.id
            ? { ...sb, status: 'completed', imageUrl: data.imageUrl }
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

  // 保存项目
  const handleSave = () => {
    saveProject({
      characters,
      storyContent,
      storyOutline,
      storyboards
    });
    alert('项目已保存！');
  };

  // 导出项目
  const handleExport = () => {
    exportProject({
      name: projectName,
      characters,
      storyContent,
      storyOutline,
      storyboards,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  };

  return (
    <DevToolsLayout
      toolbar={
        <Toolbar
          projectName={projectName}
          onNewProject={newProject}
          onSave={handleSave}
          onExport={handleExport}
        />
      }
      statusBar={
        <StatusBar
          totalScenes={storyboards.length}
          completedScenes={storyboards.filter(s => s.status === 'completed').length}
          failedScenes={storyboards.filter(s => s.status === 'failed').length}
          isGenerating={isGenerating}
        />
      }
    >
      {/* 你的主要内容 */}
      <div className="grid grid-cols-3 gap-4 p-6">
        {storyboards.map(storyboard => (
          <StoryboardCard
            key={storyboard.id}
            storyboard={storyboard}
            onRetry={handleRetry}
            onPreview={(sb) => window.open(sb.imageUrl, '_blank')}
          />
        ))}
      </div>
    </DevToolsLayout>
  );
}
