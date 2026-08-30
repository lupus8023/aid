"use client";

import { readApiJson } from "@/lib/apiResponse";
import { buildEpisodeProject } from "./domain";
import { storyStorageKeys } from "./storageScope";
import { seriesStageBlocker } from "./readiness";
import type {
  SeriesClaim,
  SeriesEpisode,
  SeriesProject,
  StoryBridgeEvent,
} from "./types";
import type { ProjectData } from "@/hooks/useProject";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("已暂停"));
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      reject(new Error("已暂停"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });

export async function seriesRequest<T>(
  body: unknown,
  base = "",
  signal?: AbortSignal,
): Promise<T> {
  return readApiJson<T>(
    await fetch(`${base}/api/companion/series`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
    "连续剧服务请求失败",
  );
}

export async function executeSeriesClaim(
  claim: SeriesClaim,
  signal: AbortSignal,
  report: (stage: string) => void,
): Promise<void> {
  const { job, settings } = claim;
  let project = claim.project;
  const companionStatus = await readApiJson<{ ok: boolean }>(
    await fetch("/api/companion/status"),
    "执行环境不可用",
  );
  // The worker lives on Companion's origin. Keep script/media calls here and
  // do not copy its credentials into the user's ordinary Story settings slot.
  const productionSettings = {
    ...settings,
    comfyui: settings.comfyui
      ? {
          ...settings.comfyui,
          useLocalCompanion: companionStatus.ok,
          localCompanionUrl: window.location.origin,
        }
      : settings.comfyui,
  };
  let saves: Promise<void> = Promise.resolve();
  const save = (stage: string) => {
    report(stage);
    saves = saves.then(async () => {
      const result = await seriesRequest<{ revision: number }>({
        action: "checkpoint",
        jobId: job.id,
        lease: job.lease,
        project,
        stage,
      });
      project.revision = result.revision;
    });
    return saves;
  };
  const call = async <T>(url: string, body: unknown): Promise<T> => {
    if (signal.aborted) throw new Error("已暂停");
    // Once a paid media request is sent, wait for its task ID/result and save
    // it before pausing. Aborting that response could cause a duplicate purchase.
    const submittingMedia = [
      "/api/generate-costume",
      "/api/generate-voice-reference",
      "/api/upload-image",
    ].includes(url);
    return readApiJson<T>(
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: submittingMedia ? AbortSignal.timeout(180000) : signal,
      }),
      "生产请求失败",
    );
  };
  const generate = <T>(stage: string, context = project, episodeId?: string) =>
    call<T>("/api/series/generate", {
      stage,
      project: context,
      episodeId,
      settings: productionSettings,
    });
  const image = async (
    asset: { imageTaskId?: string },
    payload: Record<string, unknown>,
    label: string,
  ) => {
    if (!asset.imageTaskId) {
      await save(`提交${label}`);
      const result = await call<{ taskId: string }>("/api/generate-costume", {
        ...payload,
        imageModel: settings.imageModel,
        apiKey: settings.apiKey,
        comfyui: productionSettings.comfyui,
        visualStyle: project.visualStyle,
        aspectRatio: project.aspectRatio,
      });
      if (!result.taskId) throw new Error(`${label}未返回任务编号`);
      asset.imageTaskId = result.taskId;
      await save(`${label}已提交，保存任务编号`);
    }
    for (let i = 0; i < 240; i++) {
      await wait(3000, signal);
      const result = await call<{
        status: string;
        imageUrl?: string;
        error?: string;
      }>("/api/check-image-status", {
        taskId: asset.imageTaskId,
        apiKey: settings.apiKey,
        comfyui: productionSettings.comfyui,
      });
      if (result.status === "failed") {
        asset.imageTaskId = undefined;
        await save(`${label}失败`);
        throw new Error(result.error || `${label}生成失败`);
      }
      if (result.status === "completed" && result.imageUrl) {
        const uploaded = await call<{ url: string }>("/api/upload-image", {
          imageData: result.imageUrl,
        });
        if (!uploaded.url) throw new Error("资产持久化没有返回地址");
        return uploaded.url;
      }
    }
    throw new Error(`${label}等待超时；保留任务编号，重试会继续查询`);
  };

  if (job.kind === "develop") {
    if (!project.bible) {
      await save("总编剧：开发整季总纲、角色与场景");
      const outline =
        await generate<
          Pick<SeriesProject, "bible" | "characters" | "locations">
        >("outline");
      Object.assign(project, outline);
      await save("故事总纲已保存");
    }
    for (;;) {
      const invalid = project.episodes.findIndex((e) => e.needsReview);
      const start = invalid >= 0 ? invalid : project.episodes.length;
      if (start >= project.episodeCount) break;
      await save(
        `分集编剧：第${start + 1}–${Math.min(start + 4, project.episodeCount)}集`,
      );
      const context = {
        ...project,
        episodes: project.episodes.slice(0, start),
      };
      const result = await generate<{ episodes: SeriesEpisode[] }>(
        "episodes",
        context,
      );
      for (const episode of result.episodes) {
        const old = project.episodes.find((e) => e.id === episode.id);
        const replacement = {
          ...episode,
          version: old?.version || 1,
          deliveries: old?.deliveries || [],
        };
        if (old) project.episodes[project.episodes.indexOf(old)] = replacement;
        else project.episodes.push(replacement);
      }
      await save(
        `已保存${Math.min(start + 4, project.episodeCount)}集故事与悬念承接`,
      );
    }
    return;
  }

  const episode = project.episodes.find((e) => e.id === job.episodeId);
  const blocker = seriesStageBlocker(project, job.kind);
  if (blocker) throw new Error(blocker);
  if (job.kind === "prepare" || job.kind === "produce") {
    const cast = project.characters.filter(
      (c) => !episode || episode.characterIds.includes(c.id),
    );
    for (const character of cast) {
      if (character.locked &&
        (character.appearance === "voice_only" || character.bibleUrl) &&
        (!character.speaking || (character.voiceId && character.voiceReferenceUrl))) continue;
      if (character.speaking && (!character.voiceId || !character.voiceReferenceUrl)) {
        const used = project.characters
          .filter((c) => c.id !== character.id && c.voiceId)
          .map((c) => c.voiceId!);
        if (!character.voiceId) {
          await save(`声音选角：搜索 ${character.name} 的授权候选`);
          const result = await call<{
            candidates: Array<{
              voiceId: string;
              title: string;
              licensed: boolean;
              score: number;
              reason: string;
            }>;
          }>("/api/series/voices", {
            character,
            language: project.language,
            fishAudioKey: settings.fishAudioKey,
            excludedIds: used,
          });
          character.voiceCandidates = result.candidates;
          character.voiceSelectionReason = result.candidates[0]?.reason;
          await save(`${character.name} 的声音候选已保存`);
        }
        const candidates = character.voiceId
          ? [
              {
                voiceId: character.voiceId,
                title: character.voiceProfile || "已指定音色",
              },
            ]
          : character.voiceCandidates || [];
        let lastError = "";
        for (const candidate of candidates) {
          try {
            await save(`声音试读：${character.name} · ${candidate.title}`);
            const result = await call<{
              url: string;
              voiceId: string;
              duration: number;
            }>("/api/generate-voice-reference", {
              characterName: character.name,
              voiceId: candidate.voiceId,
              fishAudioKey: settings.fishAudioKey,
              language: project.language,
              strictVoice: true,
            });
            if (!result.url || result.voiceId !== candidate.voiceId)
              throw new Error("试读音色与候选不一致");
            character.voiceId = candidate.voiceId;
            character.voiceProfile = candidate.title;
            character.voiceSource ||= "auto";
            character.voiceLocked = true;
            character.voiceReferenceUrl = result.url;
            await save(`${character.name} 的声音已固定，试读可试听`);
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : "试读失败";
            if (signal.aborted) throw error;
          }
        }
        if (!character.voiceReferenceUrl)
          throw new Error(
            `${character.name} 的候选均无法完成试读：${lastError}`,
          );
      }
      if (character.appearance !== "voice_only" && !character.bibleUrl) {
        character.bibleUrl = await image(
          character,
          {
            type: "costume",
            name: character.name,
            description: character.description,
            referenceImageUrl: character.imageUrl || undefined,
          },
          `${character.name} 定妆角色卡`,
        );
        character.imageUrl = character.bibleUrl;
      }
      character.locked = true;
      await save(`${character.name} 角色定稿 v${character.version}`);
    }
    for (const location of project.locations.filter(
      (l) => !episode || episode.locationIds.includes(l.id),
    )) {
      if (location.imageUrl) continue;
      location.imageUrl = await image(
        location,
        {
          type: "scene",
          sceneStyle: `${location.name}：${location.description}`,
        },
        `${location.name} 场景参考`,
      );
      await save(`${location.name} 场景参考已保存`);
    }
    if (job.kind === "prepare") return;
  }
  if (!episode) throw new Error("本集不存在");
  if (!episode.script) {
    await save(`执行编剧：第${episode.number}集18镜与台词`);
    const result = await generate<{
      script: NonNullable<SeriesEpisode["script"]>;
    }>("script", project, episode.id);
    episode.script = result.script;
    await save(`第${episode.number}集18镜已定稿`);
  }
  if (job.kind === "script") return;
  if (episode.deliveries.some((d) => d.episodeVersion === episode.version))
    return;
  episode.production ||= buildEpisodeProject(project, episode);
  await save(`第${episode.number}集进入Story制作`);
  const productionId = episode.production.id!;
  const keys = storyStorageKeys(productionId);
  localStorage.setItem(keys.current, JSON.stringify(episode.production));
  localStorage.setItem(keys.settings, JSON.stringify(productionSettings));
  localStorage.setItem(
    keys.contract,
    JSON.stringify({
      shotCount: 18,
      voices: Object.fromEntries(
        project.characters
          .filter((c) => episode.characterIds.includes(c.id))
          .map((c) => [c.name, c.voiceId]),
      ),
      dialogue: episode.script.flatMap((s) =>
        s.dialogue.map((d) => ({
          character: project.characters.find((c) => c.id === d.characterId)!
            .name,
          text: d.text,
        })),
      ),
    }),
  );
  localStorage.setItem(
    keys.auto,
    JSON.stringify({
      projectId: productionId,
      status: "running",
      updatedAt: Date.now(),
    }),
  );
  const frame = document.createElement("iframe");
  frame.title = `第${episode.number}集生产执行器`;
  frame.style.cssText =
    "position:fixed;left:-1600px;top:0;width:1440px;height:900px;border:0;pointer-events:none;";
  const runId = `${job.id}-${job.attempts}`;
  frame.src = `/story?seriesProject=${encodeURIComponent(productionId)}&batchRunId=${encodeURIComponent(runId)}&stageRetries=3`;
  try {
    const result = await new Promise<StoryBridgeEvent>((resolve, reject) => {
      let settling = false;
      const timer = setTimeout(
        () => fail(new Error("单集制作超过12小时，已保留断点")),
        12 * 60 * 60 * 1000,
      );
      const clean = () => {
        clearTimeout(timer);
        window.removeEventListener("message", receive);
        signal.removeEventListener("abort", abort);
      };
      const fail = (error: Error) => {
        if (settling) return;
        settling = true;
        clean();
        reject(error);
      };
      const abort = () => {
        try {
          const latest = JSON.parse(
            localStorage.getItem(keys.current) || "null",
          ) as ProjectData | null;
          if (latest?.id === productionId) {
            episode.production = latest;
            void save("暂停前保存Story断点").catch(() => undefined);
          }
        } catch {}
        fail(new Error("已暂停"));
      };
      const receive = (event: MessageEvent<StoryBridgeEvent>) => {
        if (
          event.origin !== window.location.origin ||
          event.source !== frame.contentWindow ||
          event.data?.type !== "aid-story-batch" ||
          event.data.runId !== runId ||
          settling
        )
          return;
        const data = event.data;
        if (data.project?.id === productionId)
          episode.production = data.project;
        if (data.event === "checkpoint" || data.event === "progress") {
          void save(
            data.stage || `第${episode.number}集制作中，断点已同步`,
          ).catch((error) => fail(error));
          return;
        }
        if (data.event === "failed") {
          fail(new Error(data.error || "Story制作失败"));
          return;
        }
        if (data.event === "completed") {
          settling = true;
          clean();
          void save("单集已合成，正在保存成片").then(
            () => resolve(data),
            reject,
          );
        }
      };
      window.addEventListener("message", receive);
      signal.addEventListener("abort", abort, { once: true });
      document.body.appendChild(frame);
      if (signal.aborted) abort();
    });
    if (!(result.blob instanceof Blob) || !result.blob.size)
      throw new Error("没有收到有效成片文件");
    await readApiJson(
      await fetch(
        `/api/companion/series/delivery?jobId=${encodeURIComponent(job.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "video/mp4", "X-AID-Lease": job.lease! },
          body: result.blob,
        },
      ),
      "成片保存失败",
    );
  } finally {
    frame.remove();
    localStorage.removeItem(keys.auto);
    localStorage.removeItem(keys.settings);
    localStorage.removeItem(keys.contract);
    // Checkpoints live in the private disk database; release localStorage space.
    await saves.catch(() => undefined);
    localStorage.removeItem(keys.current);
    localStorage.removeItem(keys.legacy);
  }
}
