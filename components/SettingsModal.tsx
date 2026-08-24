'use client';

import { useState, useEffect } from 'react';
import { AppSettings } from '@/types';
import { Check, Copy, X } from 'lucide-react';
import { comfyUIApiUrl, localComfyUISettings } from '@/lib/comfyuiClient';
import { APIMART_IMAGE_MODEL_OPTIONS, getImageModelCapabilities } from '@/lib/imageModels';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void | boolean;
}

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave
}: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [comfyTest, setComfyTest] = useState<{ loading: boolean; message: string; ok: boolean }>({
    loading: false,
    message: '',
    ok: false,
  });
  const [sshCommandCopied, setSshCommandCopied] = useState(false);

  // 当 settings 或 isOpen 变化时，更新 localSettings
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings);
    }
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (onSave(localSettings) !== false) onClose();
  };

  const updateComfyUI = (key: string, value: string | number | boolean) => {
    setLocalSettings(current => ({
      ...current,
      comfyui: {
        ...(current.comfyui || {
          sshHost: '', sshPort: 22, sshUser: 'root', sshKeyPath: '~/.ssh/id_ed25519',
          useLocalCompanion: true, localCompanionUrl: 'http://127.0.0.1:3018', comfyPort: 8188,
          workflowRoot: '/root/ComfyUI', imageWorkflowPath: '', multiImageWorkflowPath: '',
          firstLastWorkflowPath: '', timeoutSeconds: 7200,
        }),
        [key]: value,
      },
    }));
  };

  const sshPublicKeyCommand = (() => {
    const config = localSettings.comfyui;
    const keyPath = String(config?.sshKeyPath || '~/.ssh/id_ed25519').replace(/\.pub$/, '');
    const publicKeyPath = `${keyPath}.pub`;
    const sshUser = String(config?.sshUser || 'root');
    const sshHost = String(config?.sshHost || 'me21gb3rds8p0h44.ssh.x-gpu.com');
    const sshPort = Number(config?.sshPort) || 43213;
    const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
    return `cat ${quote(publicKeyPath)} | ssh -p ${sshPort} ${sshUser}@${sshHost} 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'`;
  })();

  const copySshPublicKeyCommand = async () => {
    await navigator.clipboard.writeText(sshPublicKeyCommand);
    setSshCommandCopied(true);
    window.setTimeout(() => setSshCommandCopied(false), 2000);
  };

  const testComfyUI = async () => {
    setComfyTest({ loading: true, message: '正在连接…', ok: false });
    try {
      const response = await fetch(comfyUIApiUrl('/api/comfyui/test', localSettings.comfyui), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: localComfyUISettings(localSettings.comfyui) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '连接失败');
      const workflowCount = Object.keys(result.workflows || {}).length;
      setComfyTest({ loading: false, message: `连接成功 · ${result.version} · ${workflowCount} 个 H3 工作流校验通过`, ok: true });
    } catch (error) {
      let message = error instanceof Error ? error.message : '连接失败';
      if (/Load failed|Failed to fetch|NetworkError/i.test(message)) {
        try {
          const statusResponse = await fetch(comfyUIApiUrl('/api/companion/status', localSettings.comfyui), {
            cache: 'no-store',
            signal: AbortSignal.timeout(2500),
          });
          if (statusResponse.ok) {
            const status = await statusResponse.json();
            message = `Companion ${status.version || ''} 在线，但 SSH/ComfyUI 完整测试连接被中断。请更新 Companion 后重试；若使用 Safari，请改用 Chrome 并允许访问本地网络。`;
          } else {
            message = '网页无法访问本地 Companion。请确认 Companion 正在运行；若使用 Safari，请改用 Chrome 并允许访问本地网络。';
          }
        } catch {
          message = '网页无法访问本地 Companion。请确认 Companion 正在运行；若使用 Safari，请改用 Chrome 并允许访问本地网络。';
        }
      }
      setComfyTest({
        loading: false,
        message,
        ok: false,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm md:p-6" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-secondary)] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/40 px-5 py-4 md:px-6">
          <div>
            <p className="aid-eyebrow">Workspace configuration</p>
            <h2 id="settings-title" className="mt-1 text-lg font-semibold text-white">AID 设置</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-lg border border-transparent text-[var(--text-secondary)] hover:border-[var(--border-color)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="关闭设置"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 md:p-6">
          {/* API Provider */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              API Provider
            </label>
            <select
              value={localSettings.apiProvider}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                apiProvider: e.target.value as AppSettings['apiProvider']
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="apimart">APIMart</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              API Key
            </label>
            <input
              type="password"
              value={localSettings.apiKey}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                apiKey: e.target.value
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              placeholder="Enter your API key"
            />
          </div>

          {/* Script Provider */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Script API Provider
            </label>
            <select
              value={localSettings.scriptProvider || 'auto'}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                scriptProvider: e.target.value as NonNullable<AppSettings['scriptProvider']>
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="auto">Auto · DMX first, APIMart fallback</option>
              <option value="dmx">DMX only</option>
              <option value="apimart">APIMart only</option>
            </select>
            <p className="mt-1.5 text-xs leading-5 text-[var(--text-secondary)]">
              “仅使用”模式不会静默切换供应商，错误信息会直接标明失败来源。
            </p>
          </div>

          {/* Script Model */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Script Generation Model
            </label>
            <input
              type="text"
              value={localSettings.scriptModel}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                scriptModel: e.target.value
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              placeholder="e.g., gpt-4o, claude-3-opus"
            />
          </div>

          {/* Image Model */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Image Generation Model
            </label>
            <select
              value={localSettings.imageModel}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                imageModel: e.target.value
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              {APIMART_IMAGE_MODEL_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs leading-5 text-[var(--text-secondary)]">
              {(() => {
                const capability = getImageModelCapabilities(localSettings.imageModel);
                return `${capability.label} · 最高 ${capability.maxResolution} · 最多 ${capability.maxReferenceImages} 张参考图`;
              })()}
            </p>
            {localSettings.imageModel === 'comfyui-z-image-turbo' && (
              <p className="mt-1.5 text-xs leading-5 text-[var(--accent-yellow)]">
                通过本机 Companion 调用仙宫云官方 Z-Image-Turbo BF16 工作流。当前分支是纯文生图；Story 会使用角色/物体文字设定，图生图与严格参考图身份锁定请切换 APIMart 模型。
              </p>
            )}
          </div>

          {/* Video Provider */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Video Generation Provider
            </label>
            <select
              value={localSettings.videoProvider || 'apimart'}
              onChange={(e) => setLocalSettings({ ...localSettings, videoProvider: e.target.value as 'apimart' | 'comfyui' })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="apimart">APIMart API</option>
              <option value="comfyui">Cloud ComfyUI · SSH Private Workflow</option>
            </select>
          </div>

          {/* Video Model */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Video Generation Model
            </label>
            <select
              value={(localSettings.videoProvider || 'apimart') === 'comfyui' ? 'MiniMax-H3' : localSettings.videoModel}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                videoModel: e.target.value
              })}
              disabled={(localSettings.videoProvider || 'apimart') === 'comfyui'}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="sora-2-vip">sora-2-vip</option>
              <option value="MiniMax-H3">
                {(localSettings.videoProvider || 'apimart') === 'comfyui'
                  ? 'MiniMax H3 · 仙宫云 4-step LoRA (2-15s, ~720P, native audio)'
                  : 'MiniMax-H3 (4-15s, 2K, audio sync)'}
              </option>
              <option value="grok-imagine-1.5-video-apimart">Grok Imagine 1.5 (6-30s, 480p/720p)</option>
              <option value="Omni-Flash-Ext">Omni-Flash-Ext (4/6/8/10s, 720p/1080p/4k)</option>
              <option value="doubao-seedance-2.0">doubao-seedance-2.0</option>
              <option value="doubao-seedance-2.0-fast">doubao-seedance-2.0-fast</option>
              <option value="doubao-seedance-1-5-pro">doubao-seedance-1-5-pro</option>
              <option value="happyhorse-1.0">happyhorse-1.0</option>
              <option value="veo3.1-fast">veo3.1-fast (Fast)</option>
              <option value="veo3.1-quality">veo3.1-quality</option>
              <option value="wan2.7">wan2.7</option>
            </select>
            {(localSettings.videoProvider || 'apimart') === 'comfyui' && (
              <p className="mt-2 text-xs font-mono text-[var(--text-secondary)]">
                ComfyUI 通道固定使用仙宫云 MiniMax H3：单图参考、多图参考或首尾帧，并原生生成同步音视频；声音参考为可选项。
              </p>
            )}
          </div>

          {((localSettings.videoProvider || 'apimart') === 'comfyui' || localSettings.imageModel === 'comfyui-z-image-turbo') && (
            <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-tertiary)]">
              <div>
                <h3 className="text-sm font-mono text-[var(--accent-green)]">ComfyUI SSH Connection</h3>
                <p className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
                  ComfyUI 请求由这台电脑上的 AID Companion 执行。Companion 使用每台电脑独立生成的设备密钥；Netlify 不接触私钥。
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-mono text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={localSettings.comfyui?.useLocalCompanion !== false}
                  onChange={(e) => updateComfyUI('useLocalCompanion', e.target.checked)}
                />
                Use Local aid Companion (Recommended)
              </label>
              <label className="block text-xs font-mono text-[var(--text-secondary)]">
                Local Companion URL
                <input
                  type="text"
                  value={localSettings.comfyui?.localCompanionUrl || 'http://127.0.0.1:3018'}
                  onChange={(e) => updateComfyUI('localCompanionUrl', e.target.value)}
                  className="mt-1 w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                />
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ['sshHost', 'SSH Host', 'text'],
                  ['sshPort', 'SSH Port', 'number'],
                  ['sshUser', 'SSH User', 'text'],
                  ['comfyPort', 'ComfyUI Port', 'number'],
                  ['timeoutSeconds', 'Generation Timeout (s)', 'number'],
                ].map(([key, label, type]) => (
                  <label key={key} className="text-xs font-mono text-[var(--text-secondary)]">
                    {label}
                    <input
                      type={type}
                      value={(localSettings.comfyui as any)?.[key] ?? ''}
                      onChange={(e) => updateComfyUI(key, type === 'number' ? Number(e.target.value) : e.target.value)}
                      className="mt-1 w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                    />
                  </label>
                ))}
              </div>
              {[
                ['sshKeyPath', 'Local SSH Private Key Path', '~/.ssh/id_ed25519'],
                ['workflowRoot', 'Remote Workflow Root', '/root/ComfyUI'],
                ['imageWorkflowPath', 'Single-reference Ref2VA Workflow', '留空自动搜索'],
                ['multiImageWorkflowPath', 'Multi-reference Ref2VA Workflow', '留空自动搜索'],
                ['firstLastWorkflowPath', 'First / Last-frame Workflow', '留空自动搜索'],
              ].map(([key, label, placeholder]) => (
                <label key={key} className="block text-xs font-mono text-[var(--text-secondary)]">
                  {label}
                  <input
                    type="text"
                    value={(localSettings.comfyui as any)?.[key] ?? ''}
                    placeholder={placeholder}
                    onChange={(e) => updateComfyUI(key, e.target.value)}
                    className="mt-1 w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                  />
                </label>
              ))}
              <div className="space-y-2 p-3 rounded border border-[var(--accent-yellow)]/50 bg-[var(--bg-primary)]">
                <div>
                  <p className="text-xs font-mono text-[var(--accent-yellow)]">首次连接 / 仙宫云实例重启后</p>
                  <p className="mt-1 text-[10px] font-mono leading-relaxed text-[var(--text-secondary)]">
                    每台电脑都有不同的 Companion 公钥。请先打开这台电脑上的 AID Companion，输入一次当前仙宫云 SSH 密码并点击“一键授权这台电脑”。如果仍提示 Permission denied，下面的命令仅用于手动授权你在 SSH Key Path 中指定的系统公钥。
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-black/30 px-2 py-2 text-[10px] leading-relaxed text-[var(--text-primary)]">
                    {sshPublicKeyCommand}
                  </code>
                  <button
                    type="button"
                    onClick={copySshPublicKeyCommand}
                    className="shrink-0 inline-flex items-center gap-1 rounded border border-[var(--border-color)] px-2 py-2 text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]"
                    title="复制授权命令"
                  >
                    {sshCommandCopied ? <Check size={12} /> : <Copy size={12} />}
                    {sshCommandCopied ? '已复制' : '复制'}
                  </button>
                </div>
                <p className="text-[10px] font-mono text-[var(--text-secondary)]">
                  新电脑首次使用必须单独授权；仙宫云实例重建或授权丢失后，各电脑也需要重新授权。完成后点击 “Test ComfyUI Connection”。
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={testComfyUI}
                  disabled={comfyTest.loading}
                  className="px-3 py-2 text-xs font-mono bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded disabled:opacity-50"
                >
                  {comfyTest.loading ? 'Testing…' : 'Test ComfyUI Connection'}
                </button>
                {comfyTest.message && (
                  <span className={`text-xs font-mono ${comfyTest.ok ? 'text-[var(--accent-green)]' : 'text-red-400'}`}>
                    {comfyTest.message}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Language */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Output Language
            </label>
            <select
              value={localSettings.language || 'zh'}
              onChange={(e) => setLocalSettings({ ...localSettings, language: e.target.value as 'zh' | 'en' })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="zh">中文 Chinese</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* Fish Audio API Key */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Fish Audio API Key
            </label>
            <input
              type="password"
              value={localSettings.fishAudioKey || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, fishAudioKey: e.target.value })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              placeholder="fish.audio API key for TTS"
            />
          </div>

          {/* DMXAPI Key */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              DMXAPI Key <span className="text-[var(--text-secondary)] text-xs">(for script generation)</span>
            </label>
            <input
              type="password"
              value={localSettings.dmxApiKey || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, dmxApiKey: e.target.value })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              placeholder="dmxapi.cn API key"
            />
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-sm font-mono text-[var(--text-secondary)] mb-2">
              Aspect Ratio (横屏/竖屏)
            </label>
            <select
              value={localSettings.aspectRatio}
              onChange={(e) => setLocalSettings({
                ...localSettings,
                aspectRatio: e.target.value as '16:9' | '9:16' | '1:1'
              })}
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="16:9">16:9 (横屏 Landscape)</option>
              <option value="9:16">9:16 (竖屏 Portrait)</option>
              {localSettings.videoModel.includes('seedance') && (
                <option value="1:1">1:1 (方形 Square)</option>
              )}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--border-color)] bg-[var(--bg-tertiary)]/40 px-5 py-4 md:px-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-mono bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-mono bg-[var(--accent-blue)] hover:bg-[#006bb3] text-white rounded transition-colors"
          >
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
