"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Film,
  Layers3,
  Library,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Users,
  Workflow,
  X,
} from "lucide-react";
import SettingsModal from "@/components/SettingsModal";
import SeriesCastPicker from "@/components/SeriesCastPicker";
import { useSettings } from "@/hooks/useSettings";
import { readApiJson } from "@/lib/apiResponse";
import { PRODUCTION_STYLE_PRESETS } from "@/lib/promptArchitecture";
import { seriesRequest } from "@/lib/series/runner";
import { episodeScreenplay } from "@/lib/series/domain";
import { seriesStageBlocker } from "@/lib/series/readiness";
import type {
  SeriesCharacter,
  SeriesLibraryActor,
  SeriesEpisode,
  SeriesJob,
  SeriesJobKind,
  SeriesProject,
  SeriesSnapshot,
} from "@/lib/series/types";

const field =
  "w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-white outline-none focus:border-[#a78bfa] disabled:opacity-50";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs font-medium transition hover:border-[#a78bfa]/60 hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-40";
const primary = `${button} !border-[#a78bfa] !bg-[#a78bfa] !text-[#1d1534] hover:!bg-[#bca7fa]`;
const tabs = [
  { id: "outline", label: "故事总纲", icon: BookOpen },
  { id: "cast", label: "角色与场景", icon: Users },
  { id: "episodes", label: "分集故事", icon: Layers3 },
  { id: "queue", label: "制作队列", icon: Workflow },
  { id: "films", label: "成片", icon: Film },
] as const;
type Tab = (typeof tabs)[number]["id"];
const jobNames: Record<SeriesJobKind, string> = {
  develop: "整季编剧",
  prepare: "角色与场景定稿",
  script: "18镜剧本",
  produce: "单集成片",
};
const statusNames = {
  queued: "排队中",
  running: "制作中",
  paused: "已暂停",
  failed: "需处理",
  completed: "已完成",
};

function saveFile(
  content: string,
  fileName: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs text-[var(--text-secondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function EpisodeEditor({
  project,
  episode,
  disabled,
  onClose,
  onSave,
}: {
  project: SeriesProject;
  episode: SeriesEpisode;
  disabled: boolean;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [showShots, setShowShots] = useState(false);
  const [jsonError, setJsonError] = useState("");
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/60"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`第${episode.number}集详情`}
        className="flex h-full w-full max-w-3xl flex-col border-l border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border-color)] px-6 py-5">
          <div>
            <p className="text-xs text-[#c1afff]">
              EPISODE {String(episode.number).padStart(2, "0")} / V
              {episode.version}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{episode.title}</h2>
          </div>
          <button className={button} onClick={onClose} aria-label="关闭详情">
            <X size={16} />
          </button>
        </header>
        <div className="flex gap-3 px-6 pt-4">
          <button className={button} onClick={() => setShowShots(false)}>
            分集故事
          </button>
          <button className={button} onClick={() => setShowShots(true)}>
            18镜剧本 {episode.script ? "✓" : "待生成"}
          </button>
          <button
            className={`${button} ml-auto`}
            onClick={() =>
              saveFile(
                episodeScreenplay(project, episode),
                `${project.name}-第${episode.number}集.md`,
                "text/markdown",
              )
            }
          >
            <Download size={14} />
            剧本
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {disabled && (
            <p className="mb-4 rounded-lg bg-amber-400/10 p-3 text-xs text-amber-200">
              队列正在运行。可以查看；如需修改，请先暂停并等待断点保存。
            </p>
          )}
          {!showShots ? (
            <form
              key={`${episode.id}-${episode.version}`}
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                onSave(Object.fromEntries(new FormData(e.currentTarget)));
              }}
            >
              <Labeled label="集名">
                <input
                  className={field}
                  name="title"
                  defaultValue={episode.title}
                  required
                  disabled={disabled}
                />
              </Labeled>
              {(
                [
                  ["synopsis", "本集故事"],
                  ["opening", "开场如何承接上一集"],
                  ["goal", "本集目标"],
                  ["conflict", "阻力与矛盾"],
                  ["choice", "人物的主动选择"],
                  ["resolution", "本集兑现的回报"],
                  ["hook", "结尾钩子"],
                  ["nextOpening", "下一集如何回应"],
                ] as const
              ).map(([key, label]) => (
                <Labeled key={key} label={label}>
                  <textarea
                    className={field}
                    name={key}
                    defaultValue={episode[key]}
                    rows={key === "synopsis" ? 5 : 2}
                    disabled={disabled}
                    required={key !== "nextOpening"}
                  />
                </Labeled>
              ))}
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                修改故事会清除本集待重做的镜头与制作断点，并标记后续分集需要更新。旧成片仍可下载。
              </p>
              <button className={primary} disabled={disabled}>
                <Check size={14} />
                保存新版本
              </button>
            </form>
          ) : episode.script ? (
            <>
              <div className="mb-5 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                <span>18个镜头</span>
                <span>
                  {episode.script.reduce((n, s) => n + s.seconds, 0)}秒
                </span>
                <span>人物与场景均引用全剧档案</span>
              </div>
              <div className="space-y-3">
                {episode.script.map((shot) => (
                  <article
                    key={shot.number}
                    className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4"
                  >
                    <div className="mb-3 flex justify-between text-xs">
                      <span className="font-mono text-[#c1afff]">
                        SHOT {String(shot.number).padStart(2, "0")}
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        {
                          project.locations.find(
                            (l) => l.id === shot.locationId,
                          )?.name
                        }{" "}
                        · {shot.seconds}s
                      </span>
                    </div>
                    <p className="text-sm leading-6">{shot.visual}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                      {shot.action}
                    </p>
                    {shot.dialogue.map((d, i) => (
                      <p
                        key={i}
                        className="mt-3 border-l-2 border-[#a78bfa]/50 pl-3 text-sm"
                      >
                        <span className="text-[#c1afff]">
                          {
                            project.characters.find(
                              (c) => c.id === d.characterId,
                            )?.name
                          }
                        </span>{" "}
                        <span className="text-xs text-[var(--text-muted)]">
                          {d.emotion}
                        </span>
                        <br />
                        {d.text}
                      </p>
                    ))}
                    <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
                      {shot.sound} · {shot.purpose}
                    </p>
                  </article>
                ))}
              </div>
              <details className="mt-6">
                <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
                  编辑结构化镜头剧本
                </summary>
                <form
                  className="mt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    try {
                      const script = JSON.parse(
                        String(new FormData(e.currentTarget).get("script")),
                      );
                      setJsonError("");
                      onSave({ script });
                    } catch {
                      setJsonError("JSON格式有误，请检查后再保存");
                    }
                  }}
                >
                  <textarea
                    name="script"
                    className={`${field} font-mono text-xs`}
                    rows={18}
                    defaultValue={JSON.stringify(episode.script, null, 2)}
                    disabled={disabled}
                  />
                  {jsonError && (
                    <p className="my-2 text-xs text-red-300">{jsonError}</p>
                  )}
                  <button className={`${primary} mt-3`} disabled={disabled}>
                    校验并保存镜头
                  </button>
                </form>
              </details>
            </>
          ) : (
            <div className="py-20 text-center text-[var(--text-secondary)]">
              <BookOpen className="mx-auto mb-4 opacity-50" size={36} />
              <p className="text-sm">分集故事已就绪，尚未展开18镜。</p>
              <p className="mt-2 text-xs">
                点击列表中的“写18镜”，或成片时自动补齐。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CharacterCard({
  character,
  disabled,
  onSave,
  onLibrary,
}: {
  character: SeriesCharacter;
  disabled: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onLibrary: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
      {character.bibleUrl || character.imageUrl ? (
        <img
          src={character.bibleUrl || character.imageUrl}
          alt={`${character.name}角色定稿`}
          className="aspect-[4/3] w-full bg-[#141517] object-contain"
        />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-[#1d1e23]">
          <Users size={40} className="text-[#a78bfa]/30" />
        </div>
      )}
      <div className="p-4">
        <div className="flex justify-between gap-2">
          <h3 className="font-medium">{character.name}</h3>
          <span
            className={`text-xs ${character.locked ? "text-emerald-300" : "text-amber-200"}`}
          >
            {character.locked ? "已定稿" : "待定稿"} · v{character.version}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {character.role}{" "}
          {character.appearance === "voice_only" ? "· 仅声音" : ""}
        </p>
        {character.casting && (
          <p className="mt-3 text-xs text-[#c1afff]">
            由角色库「{character.casting.name}」出演 · 形象已复用
          </p>
        )}
        <button
          type="button"
          className={`${button} mt-3 w-full`}
          disabled={disabled}
          onClick={onLibrary}
        >
          <Library size={14} />
          {character.casting ? "更换角色库演员" : "从角色库选角"}
        </button>
        <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">
          {character.voiceBrief}
        </p>
        {character.voiceId && (
          <p className="mt-3 text-xs text-[#c1afff]">
            {character.voiceSource === "user" ? "指定音色" : "自动选声"} ·{" "}
            {character.voiceProfile || character.voiceId}
          </p>
        )}
        {character.voiceReferenceUrl && (
          <audio
            controls
            preload="none"
            src={character.voiceReferenceUrl}
            className="mt-3 h-8 w-full"
          />
        )}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
            编辑外形 / 指定参考与音色
          </summary>
          <form
            key={character.version}
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              onSave(Object.fromEntries(new FormData(e.currentTarget)));
            }}
          >
            <Labeled label="外形与服装">
              <textarea
                className={field}
                rows={4}
                name="description"
                defaultValue={character.description}
                disabled={disabled}
              />
            </Labeled>
            <Labeled label="声音简报">
              <textarea
                className={field}
                rows={2}
                name="voiceBrief"
                defaultValue={character.voiceBrief}
                disabled={disabled}
              />
            </Labeled>
            <Labeled label="参考图HTTPS地址（留空自动生成）">
              <input
                className={field}
                name="imageUrl"
                defaultValue={character.imageUrl}
                disabled={disabled}
              />
            </Labeled>
            <Labeled label="Fish音色ID（留空自动搜索）">
              <input
                className={`${field} font-mono text-xs`}
                name="voiceId"
                defaultValue={character.voiceId}
                disabled={disabled}
              />
            </Labeled>
            <button className={button} disabled={disabled}>
              保存并重新定稿
            </button>
          </form>
        </details>
      </div>
    </article>
  );
}

export default function SeriesPage() {
  const { settings, saveSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [snapshot, setSnapshot] = useState<SeriesSnapshot>({
    projects: [],
    jobs: [],
    workerOnline: false,
  });
  const [base, setBase] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<Tab>("outline");
  const [creating, setCreating] = useState(false);
  const [trashTarget, setTrashTarget] = useState<SeriesProject>();
  const [showTrash, setShowTrash] = useState(false);
  const [trashError, setTrashError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [episodeId, setEpisodeId] = useState("");
  const [preview, setPreview] = useState("");
  const [castingId, setCastingId] = useState("");
  const project = snapshot.projects.find((p) => p.id === selectedId);
  const jobs = useMemo(
    () => snapshot.jobs.filter((j) => j.seriesId === selectedId),
    [snapshot.jobs, selectedId],
  );
  const editingLocked = jobs.some((j) =>
    ["queued", "running"].includes(j.status),
  );
  const ready = Boolean(
    project?.bible &&
    project.episodes.length === project.episodeCount &&
    !project.episodes.some((e) => e.needsReview),
  );
  const completed =
    project?.episodes.filter((e) =>
      e.deliveries.some((d) => d.episodeVersion === e.version),
    ).length || 0;
  const prepareBlocker = !connected ? "请先连接 Companion" :
    busy ? "正在保存，请稍候" :
    editingLocked ? "请等待当前任务完成，或先暂停制作队列" :
    seriesStageBlocker(project, "prepare");
  const latestDevelopment = jobs.filter(j => j.kind === "develop").at(-1);

  const refresh = useCallback(async (server: string) => {
    const response = await fetch(`${server}/api/companion/series`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    const data = await readApiJson<SeriesSnapshot>(
      response,
      "无法连接连续剧服务",
    );
    setSnapshot(data);
    setConnected(true);
    setSelectedId((id) =>
      data.projects.some((p) => p.id === id) ? id : data.projects[0]?.id || "",
    );
    return data;
  }, []);
  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
      const configured = String(
        settings.comfyui?.localCompanionUrl || "http://127.0.0.1:3018",
      ).replace(/\/+$/, "");
      const candidates = [...new Set([...(local ? [""] : []), configured])];
      for (const candidate of candidates) {
        if (cancelled) return;
        try {
          await refresh(candidate);
          if (!cancelled) {
            setBase(candidate);
            setError("");
          }
          return;
        } catch {}
      }
      if (!cancelled) {
        setConnected(false);
        setError(
          "连续剧需要新版 Companion 提供本地保存与执行队列。请启动或更新 Companion，并允许网页访问本地网络；本地开发也可直接使用此页面。",
        );
      }
    };
    void connect();
    return () => {
      cancelled = true;
    };
  }, [settings.comfyui?.localCompanionUrl, refresh]);
  useEffect(() => {
    if (base === undefined) return;
    const timer = setInterval(() => {
      void refresh(base).catch(() => setConnected(false));
    }, 4000);
    return () => clearInterval(timer);
  }, [base, refresh]);
  useEffect(() => {
    setSelection([]);
    setEpisodeId("");
    setCastingId("");
    setPreview("");
  }, [selectedId]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEpisodeId("");
        setCreating(false);
        if (!busy) {
          setTrashTarget(undefined);
          setShowTrash(false);
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy]);

  const trashAction = async (kind: "trash" | "restore", target: { id: string; name: string; revision: number }) => {
    if (busy || base === undefined || !connected) return;
    setBusy(true);
    setTrashError("");
    try {
      const response = await fetch(`${base}/api/companion/status`, {
        cache: "no-store", signal: AbortSignal.timeout(5000),
      });
      const status = await readApiJson<{ seriesTrash?: boolean }>(response, "无法检查回收站支持");
      if (!status.seriesTrash)
        throw new Error("删除与恢复连续剧需要 Companion v0.1.106 或更新版本，请先更新 Companion。");
      await seriesRequest({ action: kind, seriesId: target.id, revision: target.revision, confirmName: target.name }, base);
      await refresh(base);
      setTrashTarget(undefined);
      if (kind === "restore") {
        setShowTrash(false);
        setSelectedId(target.id);
        setTab("outline");
      }
      setNotice(kind === "trash"
        ? `「${target.name}」已移入回收站，可从左栏恢复；素材与成片保留。`
        : `「${target.name}」已恢复，制作队列保持暂停。需要制作时请手动继续。`);
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : "回收站操作失败");
      // Refresh stale revisions without silently approving a different project version.
      await refresh(base).catch(() => setConnected(false));
    } finally {
      setBusy(false);
    }
  };

  const action = async (body: Record<string, unknown>, success = "") => {
    if (base === undefined) {
      setError("请先连接连续剧服务");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await seriesRequest<{
        project?: SeriesProject;
        added?: number;
      }>({ seriesId: selectedId, ...body }, base);
      await refresh(base);
      if (result.project && body.action === "create") {
        setSelectedId(result.project.id);
        setCreating(false);
        setTab("outline");
      }
      setNotice(
        result.added === 0
          ? "没有新的待执行内容；已有任务或成片不会重复生成。"
          : success,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const enqueue = async (kind: SeriesJobKind, episodeIds?: string[]) => {
    if (kind === "prepare") {
      if (base === undefined || prepareBlocker) return;
      try {
        const response = await fetch(`${base}/api/companion/status`, {
          cache: "no-store", signal: AbortSignal.timeout(5000),
        });
        const status = await readApiJson<{ seriesIndependentPreparation?: boolean }>(response, "无法检查定稿支持");
        if (!status.seriesIndependentPreparation)
          throw new Error("独立角色场景定稿需要 Companion v0.1.105 或更新版本，请更新后重新连接。");
      } catch (err) {
        setError(err instanceof Error ? err.message : "无法检查定稿支持");
        return;
      }
    }
    await action(
      { action: "enqueue", kind, episodeIds, settings },
      "已加入队列，系统将自动补齐所需步骤。",
    );
  };
  const openCastLibrary = async (characterId: string) => {
    if (base === undefined || busy || editingLocked) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${base}/api/companion/status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      const status = await readApiJson<{ seriesLibraryCasting?: boolean }>(
        response,
        "无法检查角色库支持",
      );
      if (!status.seriesLibraryCasting)
        throw new Error(
          "角色库选角需要 Companion v0.1.103 或更新版本，请更新后重新连接。",
        );
      setCastingId(characterId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法打开角色库");
    } finally {
      setBusy(false);
    }
  };
  const selectLibraryActor = async (actor: SeriesLibraryActor) => {
    if (!project || base === undefined || editingLocked)
      throw new Error("请连接服务并暂停制作队列后再选角");
    setBusy(true);
    try {
      await seriesRequest(
        {
          action: "cast-character",
          seriesId: project.id,
          revision: project.revision,
          characterId: castingId,
          actor,
        },
        base,
      );
      await refresh(base);
      setNotice(
        `已由「${actor.name}」出演剧中角色；形象直接复用，旧成片保留。`,
      );
    } finally {
      setBusy(false);
    }
  };
  const deliveryUrl = (id: string, download = false) =>
    `${base || ""}/api/companion/series/delivery?seriesId=${encodeURIComponent(selectedId)}&id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`;
  const episodeStatus = (
    episode: SeriesEpisode,
  ): { label: string; color: string } => {
    if (episode.needsReview)
      return { label: "故事待更新", color: "text-amber-200" };
    const active = jobs.find(
      (j) =>
        j.episodeId === episode.id &&
        ["queued", "running", "paused"].includes(j.status),
    );
    if (active)
      return { label: statusNames[active.status], color: "text-[#c1afff]" };
    if (episode.deliveries.some((d) => d.episodeVersion === episode.version))
      return { label: "成片就绪", color: "text-emerald-300" };
    if (
      jobs.filter((j) => j.episodeId === episode.id).at(-1)?.status === "failed"
    )
      return { label: "制作需处理", color: "text-red-300" };
    return {
      label: episode.script ? "18镜就绪" : "故事就绪",
      color: "text-[var(--text-secondary)]",
    };
  };

  return (
    <div className="aid-theme-purple min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/95 px-4 backdrop-blur md:px-7">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/"
            className="text-[var(--text-secondary)]"
            aria-label="返回首页"
          >
            <ArrowLeft size={18} />
          </Link>
          <span className="h-6 w-px bg-[var(--border-color)]" />
          <Layers3 size={21} className="text-[#c1afff]" />
          <div>
            <p className="text-sm font-semibold">连续剧制片</p>
            <p className="text-[9px] tracking-[.16em] text-[var(--text-muted)]">
              SERIES STUDIO
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`mr-2 hidden text-[11px] md:block ${connected ? "text-emerald-300" : "text-amber-200"}`}
          >
            {connected
              ? snapshot.workerMode === "companion"
                ? "Companion 后台托管"
                : snapshot.workerOnline
                  ? "页面执行器在线"
                  : "本地存储已连接"
              : "未连接本地服务"}
          </span>
          <button className={button} onClick={() => setShowSettings(true)}>
            <Settings size={14} />
            <span className="hidden sm:inline">设置</span>
          </button>
          <button
            className={primary}
            onClick={() => setCreating(true)}
            disabled={!connected}
          >
            <Plus size={14} />
            新建连续剧
          </button>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1800px] flex-col lg:min-h-[calc(100vh-64px)] lg:flex-row">
        <aside className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/30 p-4 lg:w-60 lg:border-b-0 lg:border-r lg:p-5">
          <p className="mb-4 text-[10px] tracking-widest text-[var(--text-muted)]">
            我的连续剧 · {snapshot.projects.length}
          </p>
          <div className="flex gap-2 overflow-x-auto lg:block lg:space-y-2">
            {snapshot.projects.map((p) => (
              <button
                key={p.id}
                className={`min-w-[180px] rounded-xl border p-3 text-left transition lg:w-full ${p.id === selectedId ? "border-[#a78bfa]/40 bg-[#a78bfa]/10" : "border-transparent hover:bg-[var(--bg-tertiary)]"}`}
                onClick={() => {
                  setSelectedId(p.id);
                  setTab("outline");
                  setNotice("");
                }}
              >
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                  {p.genre} · {p.episodeCount}集 ·{" "}
                  {p.episodes.filter((e) => e.deliveries.length).length}集已交付
                </p>
              </button>
            ))}
          </div>
          <button
            className={`${button} mt-4 w-full`}
            disabled={!connected || busy}
            onClick={() => { setTrashError(""); setShowTrash(true); }}
          >
            <Trash2 size={14} />回收站 · {snapshot.trashedProjects?.length || 0}
          </button>
          <div className="mt-8 hidden border-t border-[var(--border-color)] pt-5 lg:block">
            <p className="text-xs text-[var(--text-secondary)]">
              一次定稿，全剧复用
            </p>
            <p className="mt-2 text-[11px] leading-6 text-[var(--text-muted)]">
              人物形象、声音与场景统一管理。每集独立制作、保留版本、随时下载。
            </p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-7 lg:p-9">
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm leading-6 text-red-200"
            >
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="关闭错误">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <p
              role="status"
              className="mb-5 rounded-lg border border-[#a78bfa]/20 bg-[#a78bfa]/10 px-4 py-3 text-xs text-[#d2c5ff]"
            >
              {notice}
            </p>
          )}
          {!project ? (
            <div className="mx-auto max-w-2xl py-16 md:py-28">
              <p className="text-xs tracking-[.2em] text-[#c1afff]">
                从一个故事，到一整季
              </p>
              <h1 className="mt-5 text-3xl font-semibold leading-tight md:text-5xl">
                让每一个结尾，
                <br />
                成为下一集的开始。
              </h1>
              <p className="mt-6 max-w-lg text-sm leading-7 text-[var(--text-secondary)]">
                写下故事创意，系统规划长线冲突与分集悬念，建立全剧角色和声音，再将每集18镜逐步制作成片。
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  className={`${primary} px-5 py-3`}
                  disabled={!connected}
                  onClick={() => setCreating(true)}
                >
                  <Plus size={16} />
                  创建第一部连续剧
                </button>
                {!connected && (
                  <button
                    className={button}
                    onClick={() => window.location.reload()}
                  >
                    <RefreshCw size={14} />
                    重新连接
                  </button>
                )}
              </div>
              <div className="mt-14 grid grid-cols-3 gap-5 border-t border-[var(--border-color)] pt-6">
                {[
                  ["01", "整季故事"],
                  ["02", "角色定稿"],
                  ["03", "分集成片"],
                ].map(([n, label]) => (
                  <div key={n}>
                    <p className="font-mono text-xs text-[#a78bfa]">{n}</p>
                    <p className="mt-2 text-sm">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div>
                  <p className="text-[10px] tracking-widest text-[#bba6f5]">
                    SERIES / {project.genre}
                  </p>
                  <h1 className="mt-2 text-2xl font-semibold md:text-3xl">
                    {project.name}
                  </h1>
                  <p className="mt-3 text-xs text-[var(--text-secondary)]">
                    {project.episodeCount} 集{" "}
                    <span className="mx-2 opacity-40">/</span> 每集18镜 ·
                    约2分钟 <span className="mx-2 opacity-40">/</span>{" "}
                    {project.aspectRatio}{" "}
                    <span className="mx-2 opacity-40">/</span> {completed}{" "}
                    集成片就绪
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={`${button} text-red-300`}
                    disabled={busy || !connected}
                    onClick={() => { setTrashError(""); setTrashTarget(project); }}
                  >
                    <Trash2 size={14} />删除连续剧
                  </button>
                  <button
                    className={button}
                    onClick={() =>
                      saveFile(
                        JSON.stringify(project, null, 2),
                        `${project.name}-制作档案.json`,
                      )
                    }
                  >
                    <Download size={14} />
                    档案
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void action(
                        { action: project.paused ? "resume" : "pause" },
                        project.paused
                          ? "队列已恢复"
                          : "正在暂停，已提交的生成任务仍会在供应商侧完成。",
                      )
                    }
                  >
                    {project.paused ? <Play size={14} /> : <Pause size={14} />}
                    {project.paused ? "继续队列" : "暂停队列"}
                  </button>
                  <button
                    className={primary}
                    disabled={busy || !ready}
                    onClick={() => void enqueue("produce")}
                  >
                    <Play size={14} />
                    一键成片
                  </button>
                </div>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  {
                    label: "故事规划",
                    value: `${project.episodes.filter((e) => !e.needsReview).length} / ${project.episodeCount}`,
                    done: ready,
                  },
                  {
                    label: "角色定稿",
                    value: `${project.characters.filter((c) => c.locked).length} / ${project.characters.length}`,
                    done:
                      !!project.characters.length &&
                      project.characters.every((c) => c.locked),
                  },
                  {
                    label: "18镜剧本",
                    value: `${project.episodes.filter((e) => e.script).length} / ${project.episodeCount}`,
                    done:
                      project.episodes.filter((e) => e.script).length ===
                      project.episodeCount,
                  },
                  {
                    label: "成片交付",
                    value: `${completed} / ${project.episodeCount}`,
                    done: completed === project.episodeCount,
                  },
                ].map((s, i) => (
                  <div
                    key={s.label}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        {s.label}
                      </p>
                      <p className="mt-1 font-mono text-sm">{s.value}</p>
                    </div>
                    {s.done ? (
                      <CheckCircle2 size={17} className="text-emerald-300" />
                    ) : (
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        0{i + 1}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <nav
                aria-label="连续剧模块"
                className="mt-7 flex gap-5 overflow-x-auto border-b border-[var(--border-color)]"
              >
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    className={`flex shrink-0 items-center gap-2 border-b-2 pb-3 text-xs transition ${tab === t.id ? "border-[#a78bfa] text-[#d2c5ff]" : "border-transparent text-[var(--text-secondary)] hover:text-white"}`}
                    onClick={() => setTab(t.id)}
                  >
                    <t.icon size={15} />
                    {t.label}
                    {t.id === "queue" &&
                      jobs.some((j) => j.status === "running") && (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#a78bfa]" />
                      )}
                  </button>
                ))}
              </nav>
              <div className="mt-6">
                {tab === "episodes" && (
                  <>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-[var(--text-secondary)]">
                        每集兑现一个回报，再留下一个值得追下去的问题。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={button}
                          disabled={busy || editingLocked}
                          onClick={() => void enqueue("develop")}
                        >
                          <Sparkles size={14} />
                          {project.episodes.some((e) => e.needsReview)
                            ? "更新分集故事"
                            : project.episodes.length
                              ? "补齐分集故事"
                              : "生成整季故事"}
                        </button>
                        <button
                          className={button}
                          disabled={busy || !ready}
                          onClick={() =>
                            void enqueue(
                              "script",
                              selection.length ? selection : undefined,
                            )
                          }
                        >
                          批量写18镜
                        </button>
                        {selection.length > 0 && (
                          <button
                            className={primary}
                            disabled={busy || !ready}
                            onClick={() => void enqueue("produce", selection)}
                          >
                            制作选中 {selection.length} 集
                          </button>
                        )}
                      </div>
                    </div>
                    {!project.episodes.length ? (
                      <div className="rounded-xl border border-dashed border-[var(--border-color)] px-6 py-16 text-center">
                        <BookOpen
                          size={32}
                          className="mx-auto text-[#a78bfa]/50"
                        />
                        <p className="mt-4 text-sm">先规划整季，再展开每一集</p>
                        <p className="mt-2 text-xs text-[var(--text-secondary)]">
                          系统会分批生成分集卡，记录悬念回收、事件状态与人物知情。
                        </p>
                        <button
                          className={`${primary} mt-5`}
                          disabled={busy || editingLocked}
                          onClick={() => void enqueue("develop")}
                        >
                          开始整季编剧
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-xl border border-[var(--border-color)]">
                        <div className="flex items-center gap-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 text-xs text-[var(--text-secondary)]">
                          <input
                            aria-label="选择全部剧集"
                            type="checkbox"
                            checked={
                              selection.length === project.episodes.length
                            }
                            onChange={(e) =>
                              setSelection(
                                e.target.checked
                                  ? project.episodes.map((ep) => ep.id)
                                  : [],
                              )
                            }
                          />
                          <span>剧集 · {project.episodes.length}</span>
                          <span className="ml-auto">
                            故事 / 钩子 / 制作状态
                          </span>
                        </div>
                        {project.episodes.map((ep) => {
                          const status = episodeStatus(ep);
                          return (
                            <article
                              key={ep.id}
                              className="flex items-start gap-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/30 p-4 last:border-0 md:gap-5 md:p-5"
                            >
                              <input
                                aria-label={`选择第${ep.number}集`}
                                className="mt-2"
                                type="checkbox"
                                checked={selection.includes(ep.id)}
                                onChange={(e) =>
                                  setSelection((s) =>
                                    e.target.checked
                                      ? [...s, ep.id]
                                      : s.filter((id) => id !== ep.id),
                                  )
                                }
                              />
                              <span className="mt-1 w-8 shrink-0 font-mono text-xl text-[var(--text-muted)]">
                                {String(ep.number).padStart(2, "0")}
                              </span>
                              <button
                                className="min-w-0 flex-1 text-left"
                                onClick={() => setEpisodeId(ep.id)}
                              >
                                <h3 className="text-sm font-medium">
                                  {ep.title}
                                  <ChevronRight
                                    size={13}
                                    className="ml-1 inline text-[var(--text-muted)]"
                                  />
                                </h3>
                                <p className="mt-2 line-clamp-2 text-xs leading-6 text-[var(--text-secondary)]">
                                  {ep.synopsis}
                                </p>
                                <p className="mt-3 text-xs leading-5">
                                  <span className="mr-2 rounded bg-[#a78bfa]/10 px-1.5 py-0.5 text-[10px] text-[#c1afff]">
                                    {ep.number === project.episodeCount
                                      ? "终局"
                                      : ep.hookType}
                                  </span>
                                  {ep.hook}
                                </p>
                                {ep.needsReview && (
                                  <p className="mt-2 text-xs text-amber-200">
                                    {ep.needsReview}
                                  </p>
                                )}
                              </button>
                              <div className="flex shrink-0 flex-col items-end gap-3">
                                <span className={`text-[11px] ${status.color}`}>
                                  {status.label}
                                </span>
                                <button
                                  className={button}
                                  disabled={busy || !ready}
                                  onClick={() =>
                                    void enqueue(
                                      ep.script ? "produce" : "script",
                                      [ep.id],
                                    )
                                  }
                                >
                                  {ep.script ? (
                                    <Play size={12} />
                                  ) : (
                                    <BookOpen size={12} />
                                  )}
                                  {ep.script ? "成片" : "写18镜"}
                                </button>
                                {ep.deliveries.length > 0 && (
                                  <a
                                    className="text-[11px] text-[#c1afff]"
                                    href={deliveryUrl(
                                      ep.deliveries.at(-1)!.id,
                                      true,
                                    )}
                                  >
                                    下载成片
                                  </a>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
                {tab === "outline" && (
                  <div className="grid gap-7 xl:grid-cols-[1fr_340px]">
                    <div>
                      <p className="mb-3 text-xs text-[var(--text-muted)]">
                        原始创意
                      </p>
                      <p className="whitespace-pre-wrap rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5 text-sm leading-7">
                        {project.brief}
                      </p>
                      {project.bible ? (
                        <form
                          key={project.revision}
                          className="mt-6 space-y-5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void action(
                              {
                                action: "edit",
                                revision: project.revision,
                                patch: {
                                  bible: {
                                    ...project.bible,
                                    ...Object.fromEntries(
                                      new FormData(e.currentTarget),
                                    ),
                                  },
                                },
                              },
                              "总纲已保存，后续分集已标记待更新。",
                            );
                          }}
                        >
                          {(
                            [
                              ["logline", "一句话故事"],
                              ["theme", "主题"],
                              ["conflictEngine", "持续冲突机制"],
                              ["ending", "终局与最终真相"],
                            ] as const
                          ).map(([key, label]) => (
                            <Labeled key={key} label={label}>
                              <textarea
                                className={field}
                                name={key}
                                defaultValue={project.bible![key]}
                                rows={key === "logline" ? 2 : 4}
                                required
                                disabled={editingLocked}
                              />
                            </Labeled>
                          ))}
                          <button
                            className={primary}
                            disabled={busy || editingLocked}
                          >
                            保存总纲新版本
                          </button>
                        </form>
                      ) : (
                        <button
                          className={`${primary} mt-6`}
                          disabled={busy || editingLocked}
                          onClick={() => void enqueue("develop")}
                        >
                          <Sparkles size={14} />
                          开发总纲与分集故事
                        </button>
                      )}
                    </div>
                    <div className="space-y-5">
                      {project.bible && (
                        <>
                          <div className="rounded-xl border border-[var(--border-color)] p-5">
                            <h3 className="mb-4 text-sm">阶段故事</h3>
                            {project.bible.arcs.map((a, i) => (
                              <div
                                key={i}
                                className="mb-5 border-l border-[#a78bfa]/40 pl-4 last:mb-0"
                              >
                                <p className="text-[10px] text-[#c1afff]">
                                  第{a.start}–{a.end}集
                                </p>
                                <p className="mt-2 text-xs leading-6">
                                  {a.goal}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                                  {a.reversal}
                                </p>
                              </div>
                            ))}
                          </div>
                          <div className="rounded-xl border border-[var(--border-color)] p-5">
                            <h3 className="mb-4 text-sm">伏笔与回收</h3>
                            {project.bible.promises.map((p) => (
                              <details
                                key={p.id}
                                className="border-b border-[var(--border-color)] py-3 last:border-0"
                              >
                                <summary className="cursor-pointer text-xs leading-6">
                                  {p.question}
                                  <span className="ml-2 text-[10px] text-[#c1afff]">
                                    {p.plantedIn} → {p.payoffIn}集
                                  </span>
                                </summary>
                                <p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">
                                  {p.answer}
                                </p>
                              </details>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {tab === "cast" && (
                  <>
                    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm">全剧公共资产</p>
                        <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                          角色按固定编号复用。未指定声音时搜索授权音色、排除重复，再生成试读。当前自动评价依据描述与合成可用性，不代表表演质量评分。
                        </p>
                      </div>
                      <button
                        className={primary}
                        disabled={Boolean(prepareBlocker)}
                        aria-describedby="prepare-status"
                        onClick={() => void enqueue("prepare")}
                      >
                        <Sparkles size={14} />
                        自动完成定稿
                      </button>
                    </div>
                    <p id="prepare-status" className="mb-4 text-xs leading-5 text-[var(--text-secondary)]">
                      {prepareBlocker || "总纲与资产清单已就绪，可以先定稿角色和场景，无需等待整季分集完成。"}
                    </p>
                    {latestDevelopment?.status === "failed" && (
                      <div role="status" className="mb-5 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-6 text-amber-200">
                        <p>分集编剧上次未完成：{latestDevelopment.error || latestDevelopment.stage}</p>
                        <p>已保存的总纲、角色和场景仍可定稿。分集需从制作队列重试，完成后才能制作每集。</p>
                        <button className={`${button} mt-2`} onClick={() => setTab("queue")}>查看失败任务</button>
                      </div>
                    )}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {project.characters.map((c) => (
                        <CharacterCard
                          key={`${c.id}-${c.version}`}
                          character={c}
                          disabled={editingLocked || busy}
                          onLibrary={() => void openCastLibrary(c.id)}
                          onSave={(patch) =>
                            void action(
                              {
                                action: "edit",
                                revision: project.revision,
                                characterId: c.id,
                                patch,
                              },
                              "角色已更新；受影响集数将使用新资产重制，旧成片保留。",
                            )
                          }
                        />
                      ))}
                    </div>
                    {!project.characters.length && (
                      <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
                        生成整季总纲后，角色清单会出现在这里。
                      </p>
                    )}
                    <h3 className="mb-4 mt-9 text-sm">常用场景</h3>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {project.locations.map((l) => (
                        <article
                          key={l.id}
                          className="overflow-hidden rounded-xl border border-[var(--border-color)]"
                        >
                          {l.imageUrl && (
                            <img
                              className="aspect-video w-full object-cover"
                              src={l.imageUrl}
                              alt={l.name}
                            />
                          )}
                          <div className="p-4">
                            <h4 className="text-sm">{l.name}</h4>
                            <p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">
                              {l.description}
                            </p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
                {tab === "queue" && (
                  <>
                    <div className="mb-5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                      <p className="text-sm">
                        {snapshot.workerMode === "companion"
                          ? "新版 Companion 正在后台托管"
                          : "当前使用页面执行器"}
                      </p>
                      <p className="mt-2 text-xs leading-6 text-[var(--text-secondary)]">
                        {snapshot.workerMode === "companion"
                          ? "可以关闭网页；请保持 Companion 运行且电脑唤醒。退出 Companion 后任务暂停，重启后从断点恢复。"
                          : "请保持此页面打开。关闭页面会停止调度；已提交任务和制作断点保留。安装含连续剧执行器的新版 Companion 后支持关闭网页继续。"}{" "}
                        队列顺序制作，每阶段最多3次尝试；按当前供应商设置计费，不会自动发布成片。
                      </p>
                    </div>
                    <div className="space-y-3">
                      {[...jobs].reverse().map((j) => (
                        <article
                          key={j.id}
                          className="flex items-start gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-4"
                        >
                          {j.status === "running" ? (
                            <Loader2
                              size={18}
                              className="mt-1 animate-spin text-[#c1afff]"
                            />
                          ) : j.status === "completed" ? (
                            <CheckCircle2
                              size={18}
                              className="mt-1 text-emerald-300"
                            />
                          ) : (
                            <Workflow
                              size={18}
                              className="mt-1 text-[var(--text-muted)]"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">
                              {jobNames[j.kind]}{" "}
                              {j.episodeId &&
                                `· 第${project.episodes.find((e) => e.id === j.episodeId)?.number}集`}
                            </p>
                            <p className="mt-2 break-words text-xs leading-5 text-[var(--text-secondary)]">
                              {j.stage}
                            </p>
                            {j.error && (
                              <p className="mt-2 break-words text-xs leading-5 text-red-300">
                                {j.error}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-xs">{statusNames[j.status]}</p>
                            <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                              启动 {j.attempts} 次
                            </p>
                            {j.status === "failed" && (
                              <button
                                className={`${button} mt-3`}
                                disabled={busy}
                                onClick={() =>
                                  void action(
                                    { action: "retry", jobId: j.id, settings },
                                    "已加入重试队列。",
                                  )
                                }
                              >
                                <RefreshCw size={12} />
                                从断点重试
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                      {!jobs.length && (
                        <p className="py-14 text-center text-sm text-[var(--text-secondary)]">
                          还没有制作任务。从故事开发开始，所有步骤都会记录在这里。
                        </p>
                      )}
                    </div>
                  </>
                )}
                {tab === "films" && (
                  <div className="space-y-4">
                    {project.episodes
                      .filter((e) => e.deliveries.length)
                      .map((e) => (
                        <article
                          key={e.id}
                          className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5"
                        >
                          <h3 className="text-sm">
                            第{e.number}集 · {e.title}
                          </h3>
                          <div className="mt-4 space-y-3">
                            {[...e.deliveries].reverse().map((d) => (
                              <div key={d.id}>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <p className="text-xs text-[var(--text-secondary)]">
                                    剧本 v{d.episodeVersion}{" "}
                                    {d.episodeVersion !== e.version &&
                                      "· 旧版本"}{" "}
                                    · {(d.bytes / 1024 / 1024).toFixed(1)} MB ·{" "}
                                    {new Date(d.createdAt).toLocaleString(
                                      "zh-CN",
                                    )}
                                  </p>
                                  <div className="flex gap-2">
                                    <button
                                      className={button}
                                      onClick={() =>
                                        setPreview(preview === d.id ? "" : d.id)
                                      }
                                    >
                                      <Play size={13} />
                                      预览
                                    </button>
                                    <a
                                      className={primary}
                                      href={deliveryUrl(d.id, true)}
                                    >
                                      <Download size={13} />
                                      下载MP4
                                    </a>
                                  </div>
                                </div>
                                {preview === d.id && (
                                  <video
                                    controls
                                    preload="metadata"
                                    className="mt-4 max-h-[580px] w-full rounded-lg bg-black"
                                    src={deliveryUrl(d.id)}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    {!project.episodes.some((e) => e.deliveries.length) && (
                      <div className="py-16 text-center">
                        <Film size={36} className="mx-auto text-[#a78bfa]/40" />
                        <p className="mt-4 text-sm">成片会按集出现在这里</p>
                        <p className="mt-2 text-xs text-[var(--text-secondary)]">
                          建议先制作第1集检验效果；一键成片按顺序处理所有未完成剧集。
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
      {trashTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="trash-title" aria-describedby="trash-description"
            className="my-8 w-full max-w-lg rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6">
            <h2 id="trash-title" className="text-lg font-semibold">删除「{trashTarget.name}」？</h2>
            <p id="trash-description" className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">
              将这部连续剧移入回收站，并暂停待执行任务。总纲、分集、角色场景和历史成片全部保留，可以恢复；不会删除原角色库或普通 Story 项目。
            </p>
            <p className="mt-3 text-xs text-[var(--text-muted)]">这是可恢复的删除，不会释放素材占用的磁盘空间。</p>
            {snapshot.jobs.some(j => j.seriesId === trashTarget.id && j.status === "running") && (
              <p role="status" className="mt-4 text-sm leading-6 text-amber-200">当前还有任务执行中。请先取消此操作、暂停队列，待任务保存断点后再删除。</p>
            )}
            {trashError && <p role="alert" className="mt-4 text-sm text-red-300">{trashError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button autoFocus className={button} disabled={busy} onClick={() => setTrashTarget(undefined)}>取消</button>
              <button className={`${button} !border-red-400/40 !bg-red-400/10 text-red-200`}
                disabled={busy || !connected || snapshot.jobs.some(j => j.seriesId === trashTarget.id && j.status === "running")}
                onClick={() => void trashAction("trash", trashTarget)}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}确认删除
              </button>
            </div>
          </section>
        </div>
      )}
      {showTrash && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4">
          <section role="dialog" aria-modal="true" aria-label="连续剧回收站"
            className="my-8 max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">连续剧回收站</h2>
              <button autoFocus aria-label="关闭回收站" className={button} disabled={busy} onClick={() => setShowTrash(false)}><X size={16} /></button>
            </div>
            <p className="mt-3 text-xs leading-6 text-[var(--text-secondary)]">剧本、素材和成片保留在本机。恢复后队列保持暂停，不会自动开始生成或计费。</p>
            {trashError && <p role="alert" className="mt-4 text-sm text-red-300">{trashError}</p>}
            <div className="mt-5 space-y-3">
              {(snapshot.trashedProjects || []).map(p => (
                <article key={p.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border-color)] p-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-sm">{p.name}</h3>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">{p.episodeCount}集 · {p.deliveryCount}个成片版本保留</p>
                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">移入时间：{new Date(p.deletedAt).toLocaleString()}</p>
                  </div>
                  <button className={button} disabled={busy || !connected} aria-label={`恢复${p.name}`} onClick={() => void trashAction("restore", p)}>
                    <Undo2 size={14} />恢复
                  </button>
                </article>
              ))}
              {!snapshot.trashedProjects?.length && <p className="py-10 text-center text-sm text-[var(--text-secondary)]">回收站为空</p>}
            </div>
          </section>
        </div>
      )}
      {creating && (
        <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/65 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="新建连续剧"
            className="my-8 w-full max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 md:p-8"
          >
            <div className="flex justify-between">
              <div>
                <p className="text-[10px] tracking-widest text-[#c1afff]">
                  NEW SERIES
                </p>
                <h2 className="mt-2 text-xl font-semibold">故事，从这里开始</h2>
              </div>
              <button
                className="self-start text-[var(--text-secondary)]"
                onClick={() => setCreating(false)}
                aria-label="关闭创建"
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="mt-6 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                void action(
                  {
                    action: "create",
                    project: {
                      ...values,
                      episodeCount: Number(values.episodeCount),
                    },
                  },
                  "连续剧已创建。现在可以开发总纲与分集故事。",
                );
              }}
            >
              <Labeled label="剧名">
                <input
                  name="name"
                  className={field}
                  placeholder="为这个故事起一个名字"
                  required
                  maxLength={100}
                  autoFocus
                />
              </Labeled>
              <Labeled label="故事创意">
                <textarea
                  name="brief"
                  className={field}
                  rows={5}
                  placeholder="主角是谁，想要什么，什么在阻止他？也可以直接粘贴已有故事。"
                  required
                  maxLength={12000}
                />
              </Labeled>
              <div className="grid grid-cols-2 gap-4">
                <Labeled label="题材">
                  <input name="genre" className={field} defaultValue="悬疑" />
                </Labeled>
                <Labeled label="计划集数 · 每集18镜 / 约2分钟">
                  <input
                    name="episodeCount"
                    type="number"
                    min={2}
                    max={100}
                    defaultValue={12}
                    className={field}
                    required
                  />
                </Labeled>
                <Labeled label="画幅">
                  <select
                    name="aspectRatio"
                    className={field}
                    defaultValue="9:16"
                  >
                    <option value="9:16">9:16 竖屏</option>
                    <option value="16:9">16:9 横屏</option>
                  </select>
                </Labeled>
                <Labeled label="对白语言">
                  <select name="language" className={field}>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </Labeled>
              </div>
              <Labeled label="全剧视觉风格">
                <select
                  name="visualStyle"
                  className={field}
                  defaultValue="cinematic-natural"
                >
                  {PRODUCTION_STYLE_PRESETS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Labeled>
              <p className="text-xs leading-6 text-[var(--text-secondary)]">
                创建项目不调用生成服务。点击编剧、定稿或成片后，按已配置的模型服务计费；所有结果保存到本地
                Companion。
              </p>
              <button className={`${primary} w-full py-3`} disabled={busy}>
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Plus size={16} />
                )}
                创建连续剧
              </button>
            </form>
          </section>
        </div>
      )}
      {project &&
        episodeId &&
        project.episodes.find((e) => e.id === episodeId) && (
          <EpisodeEditor
            key={`${episodeId}-${project.revision}`}
            project={project}
            episode={project.episodes.find((e) => e.id === episodeId)!}
            disabled={editingLocked || busy}
            onClose={() => setEpisodeId("")}
            onSave={(patch) =>
              void action(
                {
                  action: "edit",
                  revision: project.revision,
                  episodeId,
                  patch,
                },
                "本集新版本已保存。",
              )
            }
          />
        )}
      {connected && base !== undefined && (
        <iframe
          title="连续剧队列执行器"
          src={`${base}/series/worker?mode=page`}
          className="pointer-events-none fixed -left-[1600px] top-0 h-[900px] w-[1440px] border-0"
          aria-hidden="true"
        />
      )}
      {project &&
        castingId &&
        project.characters.some((c) => c.id === castingId) && (
          <SeriesCastPicker
            key={`${project.id}-${castingId}`}
            character={project.characters.find((c) => c.id === castingId)!}
            disabled={editingLocked || busy}
            onClose={() => setCastingId("")}
            onSelect={selectLibraryActor}
          />
        )}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSave={saveSettings}
      />
    </div>
  );
}
