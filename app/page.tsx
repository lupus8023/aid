'use client';

import Link from 'next/link';
import { ArrowUpRight, Film, Image, Layers3, Palette, Sparkles, Smartphone, UserRoundCog, Zap } from 'lucide-react';
import CompanionInstaller from '@/components/CompanionInstaller';

const creationModes = [
  {
    href: '/image-to-video',
    icon: Smartphone,
    label: '图生视频',
    english: 'Image to Video',
    description: '通过参考图、镜头运动与声音提示，生成可直接使用的视频。',
    meta: 'MiniMax H3 · ComfyUI / APIMart',
    accent: 'pink',
  },
  {
    href: '/image-to-image',
    icon: Image,
    label: '图像创作',
    english: 'Image to Image',
    description: '基于多张参考图生成棚拍、电商和视觉创意图像。',
    meta: '最多 4 张参考图',
    accent: 'orange',
  },
  {
    href: '/story',
    icon: Film,
    label: '故事工作台',
    english: 'AI Story',
    description: '从角色与故事开始，完成分镜、图像、视频和成片导出。',
    meta: '六步完整创作流程',
    accent: 'teal',
  },
  {
    href: '/series',
    icon: Layers3,
    label: '连续剧制片',
    english: 'Series Studio',
    description: '从整季总纲、分集悬念到角色定稿，连续制作每集18镜短剧。',
    meta: '18镜 / 约2分钟 · 自动选声 · 分集交付',
    accent: 'purple',
  },
  {
    href: '/character-design',
    icon: Palette,
    label: '角色设计',
    english: 'Character Design',
    description: '从文字与参考图探索角色方向，锁定后生成完整生产角色卡。',
    meta: '4 / 9 款草稿 · 角色卡',
    accent: 'pink',
  },
  {
    href: '/batch',
    icon: Layers3,
    label: '批量生产',
    english: 'Batch Production',
    description: '读取 Excel 任务与本地素材，按顺序生成并逐条保存成品。',
    meta: 'MiniMax H3 · 本地文件夹',
    accent: 'purple',
  },
  {
    href: '/character-replace',
    icon: UserRoundCog,
    label: '视频换人物',
    english: 'Character Replace',
    description: '保留参考视频的动作、镜头与背景，把画面人物替换成指定角色。',
    meta: 'SCAIL2 · SAM3.1 · ComfyUI',
    accent: 'blue',
  },
] as const;

const accentClasses = {
  pink: 'border-[#ff78b2]/35 bg-[#ff78b2]/10 text-[#ff9bc5]',
  orange: 'border-[#f4a261]/35 bg-[#f4a261]/10 text-[#ffc088]',
  teal: 'border-[#55d6c2]/35 bg-[#55d6c2]/10 text-[#7ce7d7]',
  purple: 'border-[#a78bfa]/35 bg-[#a78bfa]/10 text-[#c1afff]',
  blue: 'border-[#4da3ff]/35 bg-[#4da3ff]/10 text-[#7dbbff]',
};

const cardAccentClasses = {
  pink: 'hover:border-[#ff78b2]/55',
  orange: 'hover:border-[#f4a261]/55',
  teal: 'hover:border-[#55d6c2]/55',
  purple: 'hover:border-[#a78bfa]/55',
  blue: 'hover:border-[#4da3ff]/55',
};

const arrowAccentClasses = {
  pink: 'group-hover:border-[#ff78b2] group-hover:bg-[#ff78b2] group-hover:text-[#2b101c]',
  orange: 'group-hover:border-[#f4a261] group-hover:bg-[#f4a261] group-hover:text-[#28170a]',
  teal: 'group-hover:border-[#55d6c2] group-hover:bg-[#55d6c2] group-hover:text-[#0b2420]',
  purple: 'group-hover:border-[#a78bfa] group-hover:bg-[#a78bfa] group-hover:text-[#1d1534]',
  blue: 'group-hover:border-[#4da3ff] group-hover:bg-[#4da3ff] group-hover:text-[#071a2f]',
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/80">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 md:px-8">
          <img src="/logo.png" alt="AID" className="h-8 w-auto" />
          <div className="flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)] shadow-[0_0_10px_var(--accent-green)]" />
            LOCAL CREATIVE WORKSPACE
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-10 md:px-8 md:py-16">
        <section className="mb-10 grid items-end gap-8 border-b border-[var(--border-color)] pb-10 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="max-w-3xl">
            <div className="aid-eyebrow mb-4 flex items-center gap-2"><Sparkles size={13} /> AID Creative Studio</div>
            <h1 className="text-4xl font-semibold tracking-[-0.035em] text-white md:text-5xl lg:text-6xl">选择你的创作工作流</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--text-secondary)] md:text-lg">
              从单条视觉生成到 MiniMax H3 批量生产，在同一个工作台完成素材、参数、生成与下载。
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="rounded-lg border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 p-2 text-[var(--accent-green)]"><Zap size={17} /></div>
            <div>
              <p className="text-sm font-medium text-white">ComfyUI 本地通道已集成</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">私钥只在本机 companion 使用，云端页面不保存。</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="creation-modes-heading">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="aid-eyebrow">Creation modes</p>
              <h2 id="creation-modes-heading" className="mt-2 text-xl font-semibold text-white">开始创作</h2>
            </div>
            <span className="font-mono text-xs text-[var(--text-muted)]">{String(creationModes.length).padStart(2, '0')} WORKSPACES</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {creationModes.map((mode, index) => {
              const Icon = mode.icon;
              return (
                <Link
                  key={mode.href}
                  href={mode.href}
                  className={`group flex min-h-[280px] flex-col rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5 hover:-translate-y-1 hover:bg-[var(--bg-tertiary)] hover:shadow-[0_22px_60px_-38px_black] ${cardAccentClasses[mode.accent]}`}
                >
                  <div className="flex items-start justify-between">
                    <div className={`grid h-11 w-11 place-items-center rounded-xl border ${accentClasses[mode.accent]}`}><Icon size={20} strokeWidth={1.8} /></div>
                    <span className="font-mono text-xs text-[var(--text-muted)]">0{index + 1}</span>
                  </div>
                  <div className="mt-7">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">{mode.english}</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">{mode.label}</h3>
                    <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{mode.description}</p>
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-3 pt-7">
                    <span className="text-xs leading-5 text-[var(--text-muted)]">{mode.meta}</span>
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] ${arrowAccentClasses[mode.accent]}`}>
                      <ArrowUpRight size={15} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
        <CompanionInstaller />
      </main>
    </div>
  );
}
