'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, CircleAlert, Clipboard, Download, Laptop, LoaderCircle, ShieldCheck } from 'lucide-react';

const RELEASE_BASE = 'https://github.com/unclewongwong/aid/releases/latest/download';
const MAC_OPEN_COMMAND = "xattr -dr com.apple.quarantine '/Applications/AID Companion.app' && open '/Applications/AID Companion.app'";

type Platform = 'mac-arm' | 'mac-intel' | 'windows';

const downloads: Record<Platform, { label: string; detail: string; file: string }> = {
  'mac-arm': {
    label: 'Mac · Apple 芯片',
    detail: '适用于 M1 / M2 / M3 / M4 / M5',
    file: 'AID-Companion-mac-Apple-Silicon.zip',
  },
  'mac-intel': {
    label: 'Mac · Intel',
    detail: '适用于较早的 Intel 芯片 Mac',
    file: 'AID-Companion-mac-Intel.zip',
  },
  windows: {
    label: 'Windows · 64 位',
    detail: '适用于 Windows 10 / 11',
    file: 'AID-Companion-Windows-x64.zip',
  },
};

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'mac-arm';
  const value = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (value.includes('win')) return 'windows';
  // Browsers report `MacIntel` on Apple Silicon as well, so default modern
  // Macs to ARM and keep the Intel build one click away in the version list.
  return 'mac-arm';
}

export default function CompanionInstaller() {
  const [platform, setPlatform] = useState<Platform>('mac-arm');
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [expanded, setExpanded] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);

  useEffect(() => setPlatform(detectPlatform()), []);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const probe = async () => {
      let nextProbeDelay = 2000;
      try {
        const response = await fetch('http://127.0.0.1:3018/api/companion/status', {
          cache: 'no-store',
          signal: AbortSignal.timeout(1800),
        });
        if (!response.ok) throw new Error('offline');
        const result = await response.json();
        if (!result?.ok) throw new Error('offline');
        if (active) {
          setStatus('online');
          nextProbeDelay = 12000;
        }
      } catch {
        if (active) setStatus('offline');
      } finally {
        if (active) timer = window.setTimeout(probe, nextProbeDelay);
      }
    };
    void probe();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, []);

  const selected = downloads[platform];
  const statusView = useMemo(() => {
    if (status === 'online') return { icon: CheckCircle2, label: 'Companion 已连接', className: 'text-[#55d6c2]' };
    if (status === 'offline') return { icon: CircleAlert, label: '这台电脑尚未连接', className: 'text-[#ffc078]' };
    return { icon: LoaderCircle, label: '正在检测本地服务', className: 'text-[var(--text-secondary)]' };
  }, [status]);
  const StatusIcon = statusView.icon;
  const copyMacOpenCommand = async () => {
    await navigator.clipboard.writeText(MAC_OPEN_COMMAND);
    setCommandCopied(true);
    window.setTimeout(() => setCommandCopied(false), 1800);
  };

  return (
    <section className="mt-12 overflow-hidden rounded-[16px] border border-[#4da3ff]/30 bg-[linear-gradient(135deg,rgba(77,163,255,.12),rgba(20,23,26,.94)_42%)]" aria-labelledby="companion-heading">
      <div className="grid gap-7 p-6 md:p-7 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-[#4da3ff]/35 bg-[#4da3ff]/10 text-[#7dbbff]"><Laptop size={20} /></span>
            <div>
              <p className="aid-eyebrow">Local secure gateway</p>
              <h2 id="companion-heading" className="mt-1 text-xl font-semibold text-white">安装 AID Companion</h2>
            </div>
            <span className={`ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] ${statusView.className}`}>
              <StatusIcon size={14} className={status === 'checking' ? 'animate-spin' : ''} /> {statusView.label}
            </span>
          </div>
          <p className="mt-5 text-sm leading-6 text-[var(--text-secondary)] lg:pr-2">
            使用 ComfyUI 前安装一次即可。它不是本地模型，不占用显卡；只负责在这台电脑安全连接仙宫云，SSH 私钥不会上传到网站。
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ['01', '下载并解压', '选择对应系统版本'],
              ['02', '双击启动', '无需安装 Node.js'],
              ['03', '一键授权', '输入一次仙宫云 SSH 密码'],
            ].map(([number, title, detail]) => (
              <div key={number} className="rounded-xl border border-[var(--border-color)] bg-black/15 p-3.5">
                <span className="font-mono text-[10px] text-[#7dbbff]">{number}</span>
                <p className="mt-1 text-sm font-medium text-white">{title}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]/80 p-4">
          <a
            href={`${RELEASE_BASE}/${selected.file}`}
            className="flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-[#268de8] px-4 py-3 text-sm font-semibold text-white hover:bg-[#349bf5]"
          >
            <Download size={17} /> 下载 {selected.label}
          </a>
          <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">{selected.detail} · 自动获取最新版</p>
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            className="mt-4 flex w-full items-center justify-between border-t border-[var(--border-color)] pt-4 text-left text-xs text-[var(--text-secondary)] hover:text-white"
          >
            选择其他系统版本 <ChevronDown size={15} className={expanded ? 'rotate-180' : ''} />
          </button>
          {expanded && (
            <div className="mt-3 grid gap-2">
              {(Object.entries(downloads) as [Platform, typeof selected][]).filter(([key]) => key !== platform).map(([key, item]) => (
                <a key={key} href={`${RELEASE_BASE}/${item.file}`} className="flex items-center justify-between rounded-lg border border-[var(--border-color)] px-3 py-2.5 text-xs text-[var(--text-secondary)] hover:border-[#4da3ff]/50 hover:text-white">
                  <span>{item.label}</span><Download size={14} />
                </a>
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2 rounded-lg border border-[#55d6c2]/20 bg-[#55d6c2]/5 p-3 text-[11px] leading-5 text-[var(--text-muted)]">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#55d6c2]" />
            <span>首次运行：Mac 请把 App 拖入“应用程序”，再右键 App 选择“打开”；Windows 点“更多信息 → 仍要运行”。</span>
          </div>
          {platform !== 'windows' && (
            <div className="mt-3 rounded-lg border border-[#ffc078]/20 bg-[#ffc078]/5 p-3">
              <p className="text-[11px] leading-5 text-[var(--text-muted)]">若 Mac 仍提示“已损坏”，确认 App 已放入“应用程序”，复制下面的命令到“终端”执行一次：</p>
              <button type="button" onClick={() => void copyMacOpenCommand()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#ffc078]/30 px-3 py-2 text-xs text-[#ffc078] hover:bg-[#ffc078]/10">
                {commandCopied ? <Check size={14} /> : <Clipboard size={14} />}{commandCopied ? '已复制，去终端粘贴运行' : '复制 Mac 修复并打开命令'}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
