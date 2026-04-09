'use client';

import { useState } from 'react';
import { Upload, Video, X, Settings, Home, ChevronDown, ChevronUp, Edit } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DevToolsLayout from '@/components/DevToolsLayout';
import CameraSelector from '@/components/CameraSelector';
import SettingsModal from '@/components/SettingsModal';
import { useSettings } from '@/hooks/useSettings';

export default function ImageToVideoPage() {
  const router = useRouter();
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [mainImage, setMainImage] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [lastFrameImage, setLastFrameImage] = useState<string | null>(null);
  const [videoFiles, setVideoFiles] = useState<string[]>([]);
  const [audioFiles, setAudioFiles] = useState<string[]>([]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [cameraParams, setCameraParams] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [duration, setDuration] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handleMainImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const maxSize = 6 * 1024 * 1024; // 6MB in bytes
      if (file.size > maxSize) {
        alert('Warning: Image size exceeds 6MB. Please upload a smaller image.');
        e.target.value = ''; // Clear the input
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => setMainImage(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleLastFrameImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const maxSize = 6 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('Warning: Image size exceeds 6MB. Please upload a smaller image.');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => setLastFrameImage(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => setVideoFiles(prev => [...prev, e.target?.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => setAudioFiles(prev => [...prev, e.target?.result as string]);
      reader.readAsDataURL(file);
    });
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
          alert('Video generation failed');
          setIsGenerating(false);
          return;
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }
    alert('Video generation timeout');
    setIsGenerating(false);
  };

  const handleGenerate = async () => {
    if (!mainImage || !prompt) {
      alert('Please upload main image and enter motion description');
      return;
    }

    if (!settings.apiKey) {
      alert('Please configure API Key in settings');
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
          referenceImages: lastFrameImage ? [lastFrameImage] : [],
          prompt: fullPrompt,
          aspectRatio,
          duration,
          apiKey: settings.apiKey,
          videoModel: settings.videoModel,
          videoFiles,
          audioFiles,
          videoUrls,
          audioUrls
        })
      });

      if (!response.ok) {
        let errorMessage = 'Generation failed';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error (${response.status})`;
        }
        throw new Error(errorMessage);
      }

      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error('Server returned invalid response. Please check Netlify logs.');
      }

      pollTaskStatus(data.taskId);
    } catch (error) {
      alert(`Video generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsGenerating(false);
    }
  };

  const toolbar = (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2 md:gap-4">
        <Link href="/">
          <img src="/logo.png" alt="AI Video Studio" className="h-6 md:h-8 cursor-pointer" />
        </Link>
        <span className="hidden md:inline text-xs text-[var(--text-secondary)]">|</span>
        <span className="text-xs font-mono text-[var(--text-primary)]">Image to Video</span>
      </div>
      <div className="flex items-center gap-1 md:gap-2">
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded"
        >
          <Settings size={14} />
          <span className="hidden md:inline">Settings</span>
        </button>
        <Link href="/">
          <button className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded">
            <Home size={14} />
            <span className="hidden md:inline">Home</span>
          </button>
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <DevToolsLayout toolbar={toolbar}>
        <div className="flex flex-col md:flex-row h-full">
          {/* Left: Input Controls */}
          <div className="w-full md:w-2/3 p-4 md:p-6 overflow-y-auto md:border-r border-[var(--border-color)]">
            <div className="space-y-4 md:space-y-6">
              {/* First Frame and Last Frame */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* First Frame */}
                <div>
                  <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">First Frame</h2>
                  <p className="text-xs text-[var(--text-secondary)] mb-2">Image size &lt; 6MB</p>
                  <div className="border-2 border-dashed border-[var(--border-color)] rounded-lg p-6 text-center bg-[var(--bg-secondary)]">
                    {mainImage ? (
                      <img src={mainImage} alt="First Frame" className="max-h-48 mx-auto rounded" />
                    ) : (
                      <div>
                        <Upload className="w-10 h-10 mx-auto mb-3 text-[var(--text-secondary)]" />
                        <p className="text-[var(--text-secondary)] text-sm mb-3">Upload first frame</p>
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
                      className="inline-block px-4 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      {mainImage ? 'Change' : 'Select'}
                    </label>
                  </div>
                </div>

                {/* Last Frame */}
                <div>
                  <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">Last Frame (Optional)</h2>
                  <p className="text-xs text-[var(--text-secondary)] mb-2">Image size &lt; 6MB</p>
                  <div className="border-2 border-dashed border-[var(--border-color)] rounded-lg p-6 text-center bg-[var(--bg-secondary)]">
                    {lastFrameImage ? (
                      <img src={lastFrameImage} alt="Last Frame" className="max-h-48 mx-auto rounded" />
                    ) : (
                      <div>
                        <Upload className="w-10 h-10 mx-auto mb-3 text-[var(--text-secondary)]" />
                        <p className="text-[var(--text-secondary)] text-sm mb-3">Upload last frame</p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLastFrameImageUpload}
                      className="hidden"
                      id="last-frame-upload"
                    />
                    <label
                      htmlFor="last-frame-upload"
                      className="inline-block px-4 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      {lastFrameImage ? 'Change' : 'Select'}
                    </label>
                  </div>
                </div>
              </div>

              {/* Aspect Ratio */}
              <div>
                <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">Aspect Ratio</h2>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: '16:9' as const, label: '16:9 Landscape' },
                    { value: '9:16' as const, label: '9:16 Portrait' },
                    { value: '1:1' as const, label: '1:1 Square (Not for Veo)' }
                  ].map((ratio) => (
                    <button
                      key={ratio.value}
                      onClick={() => setAspectRatio(ratio.value)}
                      className={`p-2 text-xs font-mono rounded border ${
                        aspectRatio === ratio.value
                          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                          : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
                      }`}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">Duration</h2>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={5}
                    max={15}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={5}
                    max={15}
                    value={duration}
                    onChange={(e) => setDuration(Math.min(15, Math.max(5, Number(e.target.value))))}
                    className="w-16 px-2 py-1 text-sm font-mono bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                  />
                  <span className="text-sm font-mono text-[var(--text-secondary)]">seconds</span>
                </div>
              </div>

              {/* Motion Description */}
              <div>
                <h2 className="text-sm font-mono text-[var(--text-primary)] mb-3">Motion Description</h2>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the motion effect you want, e.g., camera slowly pushes in, person smiles and turns head..."
                  className="w-full h-24 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-3 text-sm text-[var(--text-primary)] resize-none focus:outline-none focus:border-[var(--accent-blue)] font-mono"
                />
              </div>

              {/* Camera Parameters */}
              <CameraSelector onParamsChange={setCameraParams} />

              {/* Seedance 2.0 Enhanced Features */}
              {settings.videoModel?.includes('seedance-2') && (
                <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
                  <h2 className="text-sm font-mono text-[var(--accent-green)]">Seedance 2.0 Enhanced Features</h2>

                  <div>
                    <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
                      Reference Videos (Max 3, Total ≤15s)
                    </label>
                    <input
                      type="file"
                      accept="video/*"
                      multiple
                      onChange={handleVideoUpload}
                      className="hidden"
                      id="video-upload"
                    />
                    <label
                      htmlFor="video-upload"
                      className="inline-block px-3 py-1.5 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      Upload Videos ({videoFiles.length})
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2">
                      Reference Audio (Max 3, Total ≤15s)
                    </label>
                    <input
                      type="file"
                      accept="audio/*"
                      multiple
                      onChange={handleAudioUpload}
                      className="hidden"
                      id="audio-upload"
                    />
                    <label
                      htmlFor="audio-upload"
                      className="inline-block px-3 py-1.5 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded cursor-pointer"
                    >
                      Upload Audio ({audioFiles.length})
                    </label>
                  </div>
                </div>
              )}

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !mainImage || !prompt}
                className="w-full py-3 bg-[var(--accent-blue)] hover:bg-[#006bb3] disabled:opacity-50 disabled:cursor-not-allowed rounded font-mono text-sm text-white flex items-center justify-center gap-2"
              >
                <Video className="w-4 h-4" />
                {isGenerating ? 'Generating...' : 'Generate Video'}
              </button>
            </div>
          </div>

          {/* Right: Video Preview */}
          <div className="w-full md:w-1/3 p-4 md:p-6 bg-[var(--bg-secondary)] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-mono text-[var(--text-primary)]">Video Preview</h2>
              <button
                onClick={() => setIsPreviewOpen(!isPreviewOpen)}
                className="md:hidden p-1 hover:bg-[var(--bg-hover)] rounded"
              >
                {isPreviewOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
            <div className={`${isPreviewOpen ? 'block' : 'hidden'} md:block`}>
            <div className={`bg-[var(--bg-primary)] rounded-lg flex items-center justify-center border border-[var(--border-color)] mb-4 ${
              aspectRatio === '16:9' ? 'aspect-video' :
              aspectRatio === '9:16' ? 'aspect-[9/16]' :
              'aspect-square'
            }`} style={{ maxHeight: aspectRatio === '9:16' ? '600px' : '400px' }}>
              {videoUrl ? (
                <video src={videoUrl} controls className="w-full h-full rounded-lg" />
              ) : (
                <div className="text-center text-[var(--text-secondary)]">
                  <Video className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-xs">Video will appear here</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {videoUrl && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    const videos = JSON.stringify([videoUrl]);
                    router.push(`/editor?videos=${encodeURIComponent(videos)}`);
                  }}
                  className="w-full py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#059669] text-white rounded flex items-center justify-center gap-2"
                >
                  <Edit size={14} />
                  Edit Video
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(videoUrl);
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `video-${Date.now()}.mp4`;
                        a.click();
                        window.URL.revokeObjectURL(url);
                      } catch (error) {
                        console.error('Download failed:', error);
                        alert('Download failed');
                      }
                    }}
                    className="flex-1 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded"
                  >
                    Save Video
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="flex-1 py-2 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded disabled:opacity-50"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </DevToolsLayout>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />
    </>
  );
}
