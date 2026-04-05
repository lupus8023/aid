'use client';

import { Storyboard } from '@/types';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Eye, Download, Copy, FileText, Video, Edit2, Save, X, Edit } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface StoryboardCardProps {
  storyboard: Storyboard;
  onRetry?: (storyboard: Storyboard) => void;
  onPreview?: (storyboard: Storyboard) => void;
  onGenerateVideo?: (storyboard: Storyboard) => void;
  onUpdate?: (storyboard: Storyboard) => void;
}

export default function StoryboardCard({
  storyboard,
  onRetry,
  onPreview,
  onGenerateVideo,
  onUpdate
}: StoryboardCardProps) {
  const router = useRouter();
  const [showPrompt, setShowPrompt] = useState(false);
  const [detectedAspectRatio, setDetectedAspectRatio] = useState<'16:9' | '9:16' | null>(null);

  // 编辑状态
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedDescription, setEditedDescription] = useState(storyboard.description);
  const [editedPrompt, setEditedPrompt] = useState(storyboard.prompt);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const audioUrl = e.target?.result as string;
        onUpdate?.({ ...storyboard, audioUrl });
      };
      reader.readAsDataURL(file);
    }
  };

  // 当图片加载完成后,检测其宽高比
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const aspectRatio = img.naturalWidth / img.naturalHeight;

    // 判断是横屏还是竖屏 (阈值设为1,大于1为横屏,小于1为竖屏)
    if (aspectRatio > 1) {
      setDetectedAspectRatio('16:9');
    } else {
      setDetectedAspectRatio('9:16');
    }
  };

  // 获取实际使用的宽高比:优先使用 storyboard 的设置,其次使用检测到的,最后默认横屏
  const getAspectRatio = () => {
    return storyboard.aspectRatio || detectedAspectRatio || '16:9';
  };

  const getStatusIcon = () => {
    switch (storyboard.status) {
      case 'completed':
        return <CheckCircle2 size={16} className="text-[var(--success)]" />;
      case 'failed':
        return <AlertCircle size={16} className="text-[var(--error)]" />;
      case 'generating':
        return <Loader2 size={16} className="text-[var(--accent-blue)] animate-spin" />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-[var(--border-color)]" />;
    }
  };

  const getStatusColor = () => {
    switch (storyboard.status) {
      case 'completed':
        return 'text-[var(--success)]';
      case 'generating':
        return 'text-[var(--accent-blue)]';
      case 'failed':
        return 'text-[var(--error)]';
      default:
        return 'text-[var(--text-secondary)]';
    }
  };

  const getStatusText = () => {
    switch (storyboard.status) {
      case 'completed':
        return 'completed';
      case 'generating':
        return 'rendering...';
      case 'failed':
        return 'failed';
      default:
        return 'pending';
    }
  };

  const handleDownload = async () => {
    if (!storyboard.imageUrl) return;

    try {
      // Fetch the image
      const response = await fetch(storyboard.imageUrl);
      const blob = await response.blob();

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scene-${storyboard.sceneNumber}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download image');
    }
  };

  const handleCopyDescription = async () => {
    try {
      await navigator.clipboard.writeText(storyboard.description);
      alert('Description copied to clipboard!');
    } catch (error) {
      console.error('Copy failed:', error);
      alert('Failed to copy description');
    }
  };

  // 保存描述编辑
  const handleSaveDescription = () => {
    if (onUpdate) {
      onUpdate({
        ...storyboard,
        description: editedDescription
      });
    }
    setIsEditingDescription(false);
  };

  // 取消描述编辑
  const handleCancelDescription = () => {
    setEditedDescription(storyboard.description);
    setIsEditingDescription(false);
  };

  // 保存Prompt编辑
  const handleSavePrompt = () => {
    if (onUpdate) {
      onUpdate({
        ...storyboard,
        prompt: editedPrompt
      });
    }
    setIsEditingPrompt(false);
  };

  // 取消Prompt编辑
  const handleCancelPrompt = () => {
    setEditedPrompt(storyboard.prompt);
    setIsEditingPrompt(false);
  };

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg overflow-hidden hover:border-[var(--accent-blue)] transition-colors">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="text-sm font-medium">场景 {storyboard.sceneNumber}</span>
        </div>
        <span className={`text-xs ${getStatusColor()}`}>{getStatusText()}</span>
      </div>

      {/* Image Preview */}
      <div className={`relative bg-[var(--bg-tertiary)] ${getAspectRatio() === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
        {storyboard.imageUrl ? (
          <img
            src={storyboard.imageUrl}
            alt={`Scene ${storyboard.sceneNumber}`}
            className="w-full h-full object-cover"
            onLoad={handleImageLoad}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-secondary)] text-sm">
            {storyboard.status === 'generating' ? 'Generating...' : 'No image'}
          </div>
        )}
      </div>

      {/* Video Preview */}
      {storyboard.videoUrl && (
        <div className={`relative bg-[var(--bg-primary)] ${getAspectRatio() === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`}>
          <video
            src={storyboard.videoUrl}
            controls
            className="w-full h-full"
          />
        </div>
      )}

      {/* Video Status */}
      {storyboard.videoStatus === 'generating' && (
        <div className="px-4 py-2 bg-[var(--bg-tertiary)] border-t border-[var(--border-color)] flex items-center gap-2">
          <Loader2 size={14} className="text-[var(--accent-blue)] animate-spin" />
          <span className="text-xs font-mono text-[var(--text-secondary)]">Generating video...</span>
        </div>
      )}

      {/* Content */}
      <div className="p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-[var(--text-secondary)]">Scene Description</div>
            <div className="flex items-center gap-2">
              {!isEditingDescription && (
                <>
                  <button
                    onClick={() => setIsEditingDescription(true)}
                    className="text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors"
                    title="Edit description"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={handleCopyDescription}
                    className="text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors"
                    title="Copy description"
                  >
                    <Copy size={12} />
                  </button>
                </>
              )}
              {isEditingDescription && (
                <>
                  <button
                    onClick={handleSaveDescription}
                    className="text-[var(--success)] hover:text-[var(--accent-green)] transition-colors"
                    title="Save"
                  >
                    <Save size={12} />
                  </button>
                  <button
                    onClick={handleCancelDescription}
                    className="text-[var(--error)] hover:text-[var(--accent-red)] transition-colors"
                    title="Cancel"
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
          {isEditingDescription ? (
            <textarea
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)] resize-none"
              rows={3}
            />
          ) : (
            <p className="text-sm text-[var(--text-primary)] line-clamp-2">
              {storyboard.description}
            </p>
          )}
        </div>

        {/* Prompt Section */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className="flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors"
            >
              <FileText size={12} />
              <span>{showPrompt ? 'Hide Prompt' : 'View Prompt'}</span>
            </button>
            {showPrompt && !isEditingPrompt && (
              <button
                onClick={() => setIsEditingPrompt(true)}
                className="text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors"
                title="Edit prompt"
              >
                <Edit2 size={12} />
              </button>
            )}
            {showPrompt && isEditingPrompt && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSavePrompt}
                  className="text-[var(--success)] hover:text-[var(--accent-green)] transition-colors"
                  title="Save"
                >
                  <Save size={12} />
                </button>
                <button
                  onClick={handleCancelPrompt}
                  className="text-[var(--error)] hover:text-[var(--accent-red)] transition-colors"
                  title="Cancel"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
          {showPrompt && (
            isEditingPrompt ? (
              <textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                className="mt-2 w-full p-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--accent-blue)] resize-none"
                rows={10}
              />
            ) : (
              <div className="mt-2 p-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded text-xs text-[var(--text-primary)] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                {storyboard.prompt}
              </div>
            )
          )}
        </div>

        <div>
          <div className="text-xs text-[var(--text-secondary)] mb-1">Characters</div>
          <div className="flex flex-wrap gap-1">
            {storyboard.characters.map((char, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 text-xs bg-[var(--bg-tertiary)] text-[var(--accent-green)] rounded"
              >
                {char}
              </span>
            ))}
          </div>
        </div>

        {/* Objects Section */}
        {storyboard.objects && storyboard.objects.length > 0 && (
          <div>
            <div className="text-xs text-[var(--text-secondary)] mb-1">Objects</div>
            <div className="flex flex-wrap gap-1">
              {storyboard.objects.map((obj, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 text-xs bg-[var(--bg-tertiary)] text-[var(--accent-purple)] rounded"
                >
                  {obj}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {/* Audio Upload - Above buttons */}
      {storyboard.status === 'completed' && storyboard.imageUrl && onGenerateVideo && storyboard.videoStatus !== 'generating' && (
        <div className="px-4 py-2 border-t border-[var(--border-color)]">
          <input
            type="file"
            accept="audio/*"
            onChange={handleAudioUpload}
            className="hidden"
            id={`audio-upload-${storyboard.id}`}
          />
          <label
            htmlFor={`audio-upload-${storyboard.id}`}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded cursor-pointer transition-colors"
          >
            🎵 {storyboard.audioUrl ? 'Audio Reference ✓' : 'Upload Audio Reference'}
          </label>
        </div>
      )}

      <div className="px-4 py-3 border-t border-[var(--border-color)] flex gap-2">
        {storyboard.status === 'failed' && onRetry && (
          <button
            onClick={() => onRetry(storyboard)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded transition-colors"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        )}

        {storyboard.status === 'completed' && storyboard.imageUrl && (
          <>
            {storyboard.videoUrl && (
              <button
                onClick={() => {
                  const videos = JSON.stringify([storyboard.videoUrl]);
                  router.push(`/editor?videos=${encodeURIComponent(videos)}`);
                }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded transition-colors"
              >
                <Edit size={14} />
                Edit
              </button>
            )}

            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-green)] hover:bg-[#5dd18d] text-[var(--bg-primary)] rounded transition-colors"
            >
              <Download size={14} />
              Save
            </button>

            {onRetry && (
              <button
                onClick={() => onRetry(storyboard)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-orange)] hover:bg-[#ff9f43] text-white rounded transition-colors"
              >
                <RefreshCw size={14} />
                Regenerate
              </button>
            )}

            {onGenerateVideo && storyboard.videoStatus !== 'generating' && (
              <button
                onClick={() => onGenerateVideo(storyboard)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--accent-purple)] hover:bg-[#9b59b6] text-white rounded transition-colors"
              >
                <Video size={14} />
                {storyboard.videoUrl ? 'Regenerate Video' : 'Generate Video'}
              </button>
            )}

            {onPreview && (
              <button
                onClick={() => onPreview(storyboard)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
              >
                <Eye size={14} />
                Preview
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
