'use client';

import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, CheckCircle2, Clapperboard, Sparkles } from 'lucide-react';

export type ScriptGenerationPhase = 'idle' | 'planning' | 'directing' | 'validating';

const PHASES = [
  {
    id: 'planning' as const,
    label: '正在适配人物与构思故事',
    kicker: 'STORY ARCHITECTURE',
    icon: BrainCircuit,
    messages: ['先匹配指定人物，适配原稿身份与称谓', '保留原稿动作与剧情，梳理人物目标', '建立前后相扣的因果链与观众悬念'],
  },
  {
    id: 'directing' as const,
    label: '正在组织电影镜头',
    kicker: 'SCENE DIRECTION',
    icon: Clapperboard,
    messages: ['把故事节拍拆成可以拍摄的动作', '编排景别、机位、视线与动作接点', '为演员补充表情、呼吸、走位和逐字台词'],
  },
  {
    id: 'validating' as const,
    label: '正在完成剧本检查',
    kicker: 'DELIVERY CHECK',
    icon: Sparkles,
    messages: ['检查每个镜头是否推动情节', '核对对白、人物和镜头数量', '整理最终可执行的导演分镜'],
  },
];

function elapsedLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function scriptGenerationPhaseLabel(phase: ScriptGenerationPhase): string {
  return PHASES.find(item => item.id === phase)?.label || '正在准备剧本创作';
}

interface ScriptThinkingPanelProps {
  phase: Exclude<ScriptGenerationPhase, 'idle'>;
  targetShotCount: number;
}

export default function ScriptThinkingPanel({ phase, targetShotCount }: ScriptThinkingPanelProps) {
  const [elapsed, setElapsed] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const activeIndex = PHASES.findIndex(item => item.id === phase);
  const active = PHASES[Math.max(0, activeIndex)];
  const ActiveIcon = active.icon;

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setMessageIndex(0);
    const timer = window.setInterval(() => {
      setMessageIndex(index => (index + 1) % active.messages.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [active]);

  const message = useMemo(() => active.messages[messageIndex] || active.messages[0], [active, messageIndex]);

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label={active.label}
      className="relative overflow-hidden rounded-xl border border-[var(--accent-blue)]/35 bg-[linear-gradient(135deg,rgba(0,166,255,0.11),rgba(168,85,247,0.08)_48%,rgba(10,14,22,0.82))] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.22)] md:p-6"
    >
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[var(--accent-purple)]/10 blur-3xl motion-safe:animate-pulse" />
      <div className="pointer-events-none absolute -bottom-24 left-1/4 h-44 w-44 rounded-full bg-[var(--accent-blue)]/10 blur-3xl motion-safe:animate-pulse" />

      <div className="relative flex items-start gap-4">
        <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/20 text-[var(--accent-blue)]">
          <span className="absolute inset-1 rounded-lg border border-dashed border-[var(--accent-blue)]/30 motion-safe:animate-[spin_8s_linear_infinite] motion-reduce:hidden" />
          <ActiveIcon size={21} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] tracking-[0.22em] text-[var(--accent-blue)]">{active.kicker}</p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-white">{active.label}<span className="ml-1 inline-flex w-5 justify-start"><span className="motion-safe:animate-pulse">…</span></span></h3>
            </div>
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
              {targetShotCount} 镜 · {elapsedLabel(elapsed)}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2" aria-hidden="true">
            {PHASES.map((item, index) => {
              const complete = index < activeIndex;
              const current = index === activeIndex;
              return (
                <div key={item.id} className="min-w-0">
                  <div className={`h-1 overflow-hidden rounded-full ${complete || current ? 'bg-[var(--accent-blue)]/25' : 'bg-white/8'}`}>
                    <div className={`h-full rounded-full bg-[var(--accent-blue)] transition-all duration-500 ${complete ? 'w-full' : current ? 'w-2/3 motion-safe:animate-pulse' : 'w-0'}`} />
                  </div>
                  <div className={`mt-2 flex items-center gap-1.5 text-[10px] ${complete || current ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                    {complete ? <CheckCircle2 size={11} className="text-[var(--accent-green)]" /> : <span className={`h-1.5 w-1.5 rounded-full ${current ? 'bg-[var(--accent-blue)] motion-safe:animate-pulse' : 'bg-white/15'}`} />}
                    <span className="truncate">{item.label.replace('正在', '')}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex min-h-10 items-center gap-3 rounded-lg border border-white/8 bg-black/15 px-3.5 py-2.5">
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map(index => <i key={index} style={{ animationDelay: `${index * 180}ms` }} className="h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)] motion-safe:animate-bounce" />)}
            </span>
            <p key={`${phase}-${messageIndex}`} className="text-xs leading-5 text-[var(--text-secondary)] motion-safe:animate-pulse">{message}</p>
          </div>

          <p className="mt-3 text-[10px] leading-4 text-[var(--text-muted)]">先完成选角与身份适配，再编剧和生成导演分镜。已有动作与普通台词保留；人物对应不明确时会提示，请保持本页打开。</p>
        </div>
      </div>
    </section>
  );
}
