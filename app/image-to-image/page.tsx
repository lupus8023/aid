'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, Home, Image as ImageIcon, Loader2, RefreshCw, Settings, Sparkles, Upload, Layers3, Ratio } from 'lucide-react';
import DevToolsLayout from '@/components/DevToolsLayout';
import SettingsModal from '@/components/SettingsModal';
import { useSettings } from '@/hooks/useSettings';

export default function ImageToImagePage() {
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [userIntent, setUserIntent] = useState('');
  const [scaleNotes, setScaleNotes] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('1:1');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');

  const handleImageUpload = (files: FileList | File[]) => {
    const selectedFiles = Array.from(files).slice(0, 4 - referenceImages.length);
    if (selectedFiles.length === 0) return;

    if (selectedFiles.some(file => file.size > 8 * 1024 * 1024)) {
      alert('Each image size should be less than 8MB');
      return;
    }

    Promise.all(selectedFiles.map(file => new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    }))).then((images) => {
      setReferenceImages(prev => [...prev, ...images].slice(0, 4));
      setImageUrl(null);
      setGeneratedPrompt('');
    });
  };

  const pollImageStatus = async (taskId: string) => {
    for (let i = 0; i < 90; i++) {
      setStatusText(`Generating studio image... ${i + 1}/90`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      const response = await fetch('/api/check-image-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, apiKey: settings.apiKey })
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (data.status === 'completed' && data.imageUrl) {
        setImageUrl(data.imageUrl);
        setStatusText('Completed');
        return;
      }

      if (data.status === 'failed') {
        throw new Error('Image generation failed');
      }
    }

    throw new Error('Image generation timeout');
  };

  const handleGenerate = async () => {
    if (referenceImages.length === 0) {
      alert('Please upload at least one reference image first');
      return;
    }

    if (!settings.apiKey) {
      alert('Please configure API Key in settings');
      setShowSettings(true);
      return;
    }

    setIsGenerating(true);
    setStatusText('Creating image generation task...');
    setImageUrl(null);

    try {
      const response = await fetch('/api/image-to-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImages,
          userIntent,
          scaleNotes,
          aspectRatio,
          imageModel: settings.imageModel,
          apiKey: settings.apiKey,
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start generation');
      }

      const { taskId, prompt } = await response.json();
      setGeneratedPrompt(prompt);
      await pollImageStatus(taskId);
    } catch (error) {
      alert(`Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setStatusText('Failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!imageUrl) return;

    try {
      const downloadUrl = imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')
        ? imageUrl
        : `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`Image download failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `studio-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      alert('图片下载失败，请稍后重试');
    }
  };

  const toolbar = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link href="/">
          <img src="/logo.png" alt="AI Video Studio" className="h-7 cursor-pointer" />
        </Link>
        <span className="h-5 w-px bg-[var(--border-color)]" />
        <div><span className="block text-xs font-medium text-[var(--text-primary)]">图像创作</span><span className="hidden font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)] sm:block">Image to Image</span></div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSettings(true)}
          className="flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
        >
          <Settings size={14} /> 设置
        </button>
        <Link href="/">
          <button className="flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 text-xs hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]">
            <Home size={14} /> 首页
          </button>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="aid-theme-orange contents">
      <DevToolsLayout toolbar={toolbar}>
        <div className="min-h-full bg-[var(--bg-primary)]">
          <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 p-4 md:p-7 xl:grid-cols-[minmax(0,1fr)_480px]">
            <div className="aid-form-stack space-y-5">
              <header className="aid-page-lead !border-0 !bg-transparent !p-0 !shadow-none">
                <div><p className="aid-eyebrow">Image creation console</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">用参考图控制创意结果</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">上传主体与风格参考，补充创意方向和尺寸关系，生成更稳定的商业视觉。</p></div>
                <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">{referenceImages.length}/4 REFERENCES</span>
              </header>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3"><div><p className="aid-step-kicker">01 · 素材</p><h2 className="mt-1 text-base font-semibold text-white">参考图片</h2></div><span className="text-xs text-[var(--text-muted)]">最多 4 张 · 单张 8MB</span></div>
                <div className="grid grid-cols-2 gap-3">
                  {referenceImages.map((image, index) => (
                    <div key={`${image.slice(0, 32)}-${index}`} className="relative border border-[var(--border-color)] rounded-lg overflow-hidden bg-[var(--bg-primary)]">
                      <img src={image} alt={`Reference ${index + 1}`} className="w-full h-40 object-contain" />
                      <button
                        type="button"
                        onClick={() => setReferenceImages(prev => prev.filter((_, i) => i !== index))}
                        className="absolute top-2 right-2 px-2 py-1 text-xs font-mono bg-black/70 hover:bg-black text-white rounded"
                      >
                        Remove
                      </button>
                    </div>
                  ))}

                  {referenceImages.length < 4 && (
                    <label className="h-40 border-2 border-dashed border-[var(--border-color)] rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-[var(--bg-hover)] transition-colors bg-[var(--bg-primary)]">
                      <Upload size={32} className="text-[var(--text-secondary)] mb-3" />
                      <span className="text-sm text-[var(--text-primary)]">上传参考图片</span>
                      <span className="mt-1 text-xs text-[var(--text-secondary)]">支持多选 · 已上传 {referenceImages.length}/4</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) handleImageUpload(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div><p className="aid-step-kicker">02 · 创作参数</p><h2 className="mt-1 text-base font-semibold text-white">描述目标画面</h2></div>
                <div>
                  <label className="aid-field-label">场景与创意方向</label>
                  <textarea
                    value={userIntent}
                    onChange={(e) => setUserIntent(e.target.value)}
                    placeholder="例如：高级香水广告图，黑色亚克力台面，柔和轮廓光，奢华商业摄影；或：电商主图，纯净白底，产品清晰居中。"
                    className="w-full h-32 p-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-sm font-mono text-[var(--text-primary)] resize-none focus:outline-none focus:border-[var(--accent-blue)]"
                  />
                </div>

                <div>
                  <label className="aid-field-label">比例与尺寸参考（可选）</label>
                  <textarea
                    value={scaleNotes}
                    onChange={(e) => setScaleNotes(e.target.value)}
                    placeholder="例如：人物身高约 170cm，手持香水瓶高约 12cm；产品在人物手中约占手掌高度的 2/3；瓶身为细长圆柱，宽高比约 1:4。"
                    className="w-full h-24 p-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-sm font-mono text-[var(--text-primary)] resize-none focus:outline-none focus:border-[var(--accent-blue)]"
                  />
                  <p className="text-xs font-mono text-[var(--text-secondary)] mt-1">
                    Optional: helps preserve person/object identity, object proportions, and realistic scale relationships.
                  </p>
                </div>

                <div>
                  <label className="aid-field-label">画面比例</label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16' | '1:1')}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                  >
                    <option value="1:1">1:1 Square</option>
                    <option value="16:9">16:9 Landscape</option>
                    <option value="9:16">9:16 Portrait</option>
                  </select>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || referenceImages.length === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {isGenerating ? statusText || '正在生成…' : '生成视觉图片'}
                </button>
              </div>
            </div>

            <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
              <div className="aid-panel flex min-h-[560px] flex-col p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div><p className="aid-eyebrow">Output</p><h2 className="mt-1 text-sm font-semibold text-white">生成结果</h2></div>
                  <ImageIcon size={16} className="text-[var(--accent-purple)]" />
                </div>

                <div className="flex-1 bg-black/20 rounded border border-[var(--border-color)] flex items-center justify-center overflow-hidden">
                  {imageUrl ? (
                    <img src={imageUrl} alt="Generated studio photo" className="w-full h-full object-contain" />
                  ) : isGenerating ? (
                    <div className="text-center text-[var(--text-secondary)] font-mono text-sm">
                      <Loader2 size={36} className="animate-spin mx-auto mb-3" />
                      {statusText || 'Generating...'}
                    </div>
                  ) : (
                    <div className="text-center text-[var(--text-secondary)] font-mono text-sm">
                      <ImageIcon size={48} className="mx-auto mb-3 opacity-50" />
                      生成图片会显示在这里
                    </div>
                  )}
                </div>

                {imageUrl && (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={handleDownload}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#5dd18d] text-white rounded"
                    >
                      <Download size={14} /> 下载图片
                    </button>
                    <button
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono bg-[var(--accent-purple)] hover:bg-[#9b59b6] text-white rounded disabled:opacity-50"
                    >
                      <RefreshCw size={14} /> 重新生成
                    </button>
                  </div>
                )}
              </div>

              <div className="aid-panel divide-y divide-[var(--border-color)] px-4">
                <div className="flex items-center justify-between py-3 text-xs"><span className="flex items-center gap-2 text-[var(--text-secondary)]"><Layers3 size={14} />参考素材</span><span className="font-mono text-white">{referenceImages.length} / 4</span></div>
                <div className="flex items-center justify-between py-3 text-xs"><span className="flex items-center gap-2 text-[var(--text-secondary)]"><Ratio size={14} />输出比例</span><span className="font-mono text-white">{aspectRatio}</span></div>
              </div>
              {generatedPrompt && (
                <div className="aid-panel p-4">
                  <h3 className="mb-2 text-sm font-semibold text-white">生成提示词</h3>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap text-xs font-mono text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded p-3">
                    {generatedPrompt}
                  </pre>
                </div>
              )}
            </aside>
          </div>
        </div>
      </DevToolsLayout>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />
    </div>
  );
}
