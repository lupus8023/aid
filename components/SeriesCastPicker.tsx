"use client";

import { useEffect, useMemo, useState } from "react";
import { Library, Loader2, RefreshCw, Search, X } from "lucide-react";
import {
  CHARACTER_DESIGNS_STORAGE_KEY,
  CHARACTER_HISTORY_STORAGE_KEY,
  parseStoredArray,
} from "@/lib/characterLibrary";
import { seriesCastLibrary } from "@/lib/series/casting";
import { readApiJson } from "@/lib/apiResponse";
import type { SeriesCharacter, SeriesLibraryActor } from "@/lib/series/types";

const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs hover:border-[#a78bfa] disabled:opacity-40 disabled:pointer-events-none";

async function persistentImage(value: string): Promise<string> {
  if (/^https:\/\//i.test(value)) return value;
  if (
    !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value) ||
    value.length > 12 * 1024 * 1024
  )
    throw new Error(
      "此角色图片不是可用的HTTPS图片或本地图片，请在角色库重新保存图片。",
    );
  // Legacy history contains data URLs. Persist only the selected image through
  // the existing image host; do not request a new AI image or upload the library.
  const response = await fetch("/api/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageData: value }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await readApiJson<{ url: string }>(
    response,
    "保存历史角色图片失败",
  );
  if (!/^https:\/\//i.test(data.url || ""))
    throw new Error("角色图片没有返回持久HTTPS地址");
  return data.url;
}

export default function SeriesCastPicker({
  character,
  disabled,
  onClose,
  onSelect,
}: {
  character: SeriesCharacter;
  disabled: boolean;
  onClose: () => void;
  onSelect: (actor: SeriesLibraryActor) => Promise<void>;
}) {
  const [actors, setActors] = useState<SeriesLibraryActor[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [loading, onClose]);
  const readLibrary = () => {
    try {
      setActors(
        seriesCastLibrary(
          parseStoredArray(localStorage.getItem(CHARACTER_HISTORY_STORAGE_KEY)),
          parseStoredArray(localStorage.getItem(CHARACTER_DESIGNS_STORAGE_KEY)),
        ),
      );
      setError("");
    } catch {
      setError("浏览器角色库无法读取，请检查本地存储权限。");
    }
  };
  useEffect(() => {
    readLibrary();
    const changed = (event: StorageEvent) => {
      if (
        !event.key ||
        [CHARACTER_HISTORY_STORAGE_KEY, CHARACTER_DESIGNS_STORAGE_KEY].includes(
          event.key,
        )
      )
        readLibrary();
    };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", readLibrary);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", readLibrary);
    };
  }, []);
  const visible = useMemo(
    () =>
      actors.filter((actor) =>
        `${actor.name} ${actor.description}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
      ),
    [actors, search],
  );
  const actor = actors.find((item) => item.id === selected);
  const choose = async () => {
    if (!actor || disabled || loading) return;
    setLoading(true);
    setError("");
    try {
      const imageUrl = await persistentImage(actor.imageUrl);
      const bibleUrl = actor.bibleUrl
        ? actor.bibleUrl === actor.imageUrl
          ? imageUrl
          : await persistentImage(actor.bibleUrl)
        : undefined;
      await onSelect({ ...actor, imageUrl, bibleUrl });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "选角失败");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`为${character.name}从角色库选角`}
        className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-color)] p-5">
          <div>
            <p className="mb-2 text-xs text-[#c1afff]">角色库选角</p>
            <h2 className="text-lg font-medium">
              谁来出演「{character.name}」？
            </h2>
            <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
              保留剧中名字、身份和关系；复用选中的形象，不重新生图。已有成片保留，受影响集数需使用新资产重制。
            </p>
          </div>
          <button
            type="button"
            className={button}
            aria-label="关闭角色库"
            onClick={onClose}
            disabled={loading}
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex gap-2 p-5 pb-3">
          <label className="flex flex-1 items-center gap-2 rounded-lg border border-[var(--border-color)] px-3">
            <Search size={16} />
            <input
              autoFocus
              aria-label="搜索角色库"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名字或外形"
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
          </label>
          <button className={button} onClick={readLibrary} disabled={loading}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="mx-5 mb-3 rounded-lg bg-red-400/10 p-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {visible.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected === item.id}
                  aria-label={`选择${item.name}`}
                  onClick={() => setSelected(item.id)}
                  disabled={loading || disabled}
                  className={`overflow-hidden rounded-xl border text-left transition disabled:opacity-40 ${selected === item.id ? "border-[#a78bfa] bg-[#a78bfa]/10" : "border-[var(--border-color)] hover:border-[#a78bfa]/60"}`}
                >
                  <img
                    src={item.bibleUrl || item.imageUrl}
                    alt={item.name}
                    className="aspect-[4/3] w-full bg-black/20 object-contain"
                  />
                  <div className="p-3">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">
                      {item.description || "已有角色形象"}
                    </p>
                    <p className="mt-2 text-[10px] text-[#c1afff]">
                      {item.bibleUrl ? "完整角色卡" : "已有参考形象"} ·{" "}
                      {item.voiceId ? "含已存音色" : "未存音色"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Library className="mx-auto mb-3 text-[#a78bfa]/60" size={34} />
              <p className="text-sm">
                {actors.length ? "没有匹配的角色" : "此浏览器还没有保存角色"}
              </p>
              <p className="mx-auto mt-3 max-w-md text-xs leading-6 text-[var(--text-secondary)]">
                角色库保存在当前浏览器和网站中，localhost、正式站点及其他浏览器的库不互通。可在角色设计中保存角色，或在普通
                Story 中添加历史角色。
              </p>
              <a
                href="/character-design"
                target="_blank"
                rel="noreferrer"
                className={`${button} mt-4`}
              >
                打开角色设计
              </a>
            </div>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-color)] p-5">
          <p className="max-w-lg text-xs leading-5 text-[var(--text-secondary)]">
            {actor
              ? `由「${actor.name}」出演「${character.name}」。`
              : "请选择一个已有角色。"}
            {actor?.voiceId
              ? "将继承库内音色；缺少试音时仅补齐试音。"
              : "未存音色时，保留剧中已单独指定的音色，否则自动匹配。"}
            本地历史图片会保存到现有图床。
          </p>
          <button
            className={`${button} !border-[#a78bfa] !bg-[#a78bfa] !text-[#1d1534]`}
            disabled={!actor || loading || disabled}
            onClick={() => void choose()}
          >
            {loading ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Library size={15} />
            )}
            使用这个角色
          </button>
        </footer>
      </section>
    </div>
  );
}
