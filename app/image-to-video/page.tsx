'use client';

import { useState } from 'react';
import { ArrowLeft, Upload, Video, X, Settings } from 'lucide-react';
import Link from 'next/link';
import CameraSelector from '@/components/CameraSelector';
import SettingsModal from '@/components/SettingsModal';
import { useSettings } from '@/hooks/useSettings';

export default function ImageToVideoPage() {
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [mainImage, setMainImage] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [cameraParams, setCameraParams] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handleMainImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setMainImage(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleReferenceImagesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setReferenceImages(prev => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  const pollTaskStatus = async (taskId: string) => {
    const maxAttempts = 180;
    for (let i = 0; i < maxAttempts; i++) {
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
          setVideoUrl(data.videoUrl);
          setIsGenerating(false);
          return;
        }
        if (data.status === 'failed') {
          alert('视频生成失败');
          setIsGenerating(false);
          return;
        }
      } catch (error) {
        console.error('轮询错误:', error);
      }
    }
    alert('视频生成超时');
    setIsGenerating(false);
  };

  const handleGenerate = async () => {
    if (!mainImage || !prompt) {
      alert('请上传主图片并输入动作描述');
      return;
    }

    if (!settings.apiKey) {
      alert('请先在设置中配置 API Key');
      return;
    }

    setIsGenerating(true);
    try {
      const fullPrompt = cameraParams ? `${prompt}. ${cameraParams}` : prompt;

      const response = await fetch('/api/image-to-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainImage,
          referenceImages,
          prompt: fullPrompt,
          aspectRatio,
          apiKey: settings.apiKey,
          videoModel: settings.videoModel
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '生成失败');
      }

      const data = await response.json();
      pollTaskStatus(data.taskId);
    } catch (error) {
      alert(`视频生成失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-white">
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="inline-flex items-center text-gray-400 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回首页
          </Link>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-gray-700 rounded"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <h1 className="text-3xl font-bold mb-8">图片转视频</h1>

        <div className="grid lg:grid-cols-2 gap-8">
          <div className="space-y-6 max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
            {/* 主图片上传 */}
            <div className="bg-[#252526] rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <Upload className="w-5 h-5 mr-2" />
                主图片
              </h2>
              <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center">
                {mainImage ? (
                  <img src={mainImage} alt="主图片" className="max-h-64 mx-auto rounded" />
                ) : (
                  <div>
                    <Upload className="w-12 h-12 mx-auto mb-4 text-gray-500" />
                    <p className="text-gray-400 mb-4">上传要转换的主图片</p>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleMainImageUpload}
                  className="hidden"
                  id="main-image-upload"
                />
                <label
                  htmlFor="main-image-upload"
                  className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded cursor-pointer"
                >
                  {mainImage ? '更换图片' : '选择图片'}
                </label>
              </div>
            </div>

            {/* 参考图片上传 */}
            <div className="bg-[#252526] rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">参考图片（可选）</h2>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {referenceImages.map((img, idx) => (
                  <div key={idx} className="relative">
                    <img src={img} alt={`参考${idx + 1}`} className="w-full h-24 object-cover rounded" />
                    <button
                      onClick={() => removeReferenceImage(idx)}
                      className="absolute top-1 right-1 bg-red-500 rounded-full p-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleReferenceImagesUpload}
                className="hidden"
                id="ref-images-upload"
              />
              <label
                htmlFor="ref-images-upload"
                className="inline-block px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded cursor-pointer text-sm"
              >
                添加参考图片
              </label>
            </div>

            {/* 画幅比例 */}
            <div className="bg-[#252526] rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">画幅比例</h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: '16:9' as const, label: '横屏 16:9' },
                  { value: '9:16' as const, label: '竖屏 9:16' },
                  { value: '1:1' as const, label: '方形 1:1' }
                ].map((ratio) => (
                  <button
                    key={ratio.value}
                    onClick={() => setAspectRatio(ratio.value)}
                    className={`p-3 rounded border ${
                      aspectRatio === ratio.value
                        ? 'border-blue-500 bg-blue-500/20'
                        : 'border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    {ratio.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 动作描述 */}
            <div className="bg-[#252526] rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">动作描述</h2>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述你想要的动作效果，例如：镜头缓慢推进，人物微笑转头..."
                className="w-full h-32 bg-[#1e1e1e] border border-gray-600 rounded p-3 text-white resize-none focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* 镜头参数选择器 */}
            <CameraSelector onParamsChange={setCameraParams} />

            {/* 生成按钮 */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !mainImage || !prompt}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold flex items-center justify-center"
            >
              <Video className="w-5 h-5 mr-2" />
              {isGenerating ? '生成中...' : '生成视频'}
            </button>
          </div>

          {/* 右侧：预览 */}
          <div className="bg-[#252526] rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">视频预览</h2>
            <div className={`bg-[#1e1e1e] rounded-lg flex items-center justify-center ${
              aspectRatio === '16:9' ? 'aspect-video' :
              aspectRatio === '9:16' ? 'aspect-[9/16]' :
              'aspect-square'
            }`}>
              {videoUrl ? (
                <video src={videoUrl} controls className="w-full h-full rounded-lg" />
              ) : (
                <div className="text-center text-gray-500">
                  <Video className="w-16 h-16 mx-auto mb-4" />
                  <p>视频将在这里显示</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />
    </div>
  );
}
