"use client";

import { ApiResponseError, readApiJson } from "@/lib/apiResponse";
import { buildEpisodeProject } from "./domain";
import { copiedDialogueShotNumbers } from "./scriptRepair";
import { repairEpisodeDialogue, synchronizeEpisodeDialogue } from "./productionDialogueRepair";
import { storyStorageKeys } from "./storageScope";
import { seriesStageBlocker } from "./readiness";
import { isGptImage2Model } from '@/lib/imageModels';
import { usesPhotographicReferences } from '@/lib/gptImageReferences';
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
  let currentStage = job.stage;
  const save = (stage: string) => {
    currentStage = stage;
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
        signal: submittingMedia ? AbortSignal.timeout(url === '/api/generate-voice-reference' ? 320000 : 180000) : signal,
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
        `分集编剧：第${start + 1}集，逐集校验并保存`,
      );
      const context = {
        ...project,
        episodes: project.episodes.slice(0, start),
      };
      const result = await generate<{ episodes: SeriesEpisode[] }>(
        "episodes",
        context,
      );
      if (!result.episodes.length || result.episodes[0].number !== start + 1) throw new Error('分集未返回预期进度，已停止以避免重复编剧');
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
        `第${result.episodes.at(-1)!.number}集故事与悬念承接已保存`,
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
    const missingVoices: string[] = [];
    for (const character of cast) {
      if (character.locked &&
        (character.appearance === "voice_only" || character.bibleUrl) &&
        (!character.speaking || (character.voiceId && character.voiceReferenceUrl))) continue;
      if (character.speaking && (!character.voiceId || !character.voiceReferenceUrl)) {
        try {
          const used = project.characters
            .filter((c) => c.id !== character.id && c.voiceId)
            .map((c) => c.voiceId!);
          character.voiceCandidates = character.voiceCandidates?.filter(c => !used.includes(c.voiceId));
          if (!character.voiceId && !character.voiceCandidates?.length) {
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
                  requiresLanguageCheck: character.voiceSource === 'user',
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
                languageCheck?: { passed: boolean; matchScore: number };
              }>("/api/generate-voice-reference", {
                characterName: character.name,
                voiceId: candidate.voiceId,
                fishAudioKey: settings.fishAudioKey,
                language: project.language,
                strictVoice: true,
                verifyLanguage: 'requiresLanguageCheck' in candidate && candidate.requiresLanguageCheck === true,
              });
              if (!result.url || result.voiceId !== candidate.voiceId)
                throw new Error("试读音色与候选不一致");
              if ('requiresLanguageCheck' in candidate && candidate.requiresLanguageCheck === true && !result.languageCheck?.passed)
                throw new Error('跨语言试读尚未通过校验，请更新Companion后重试；不更换音色或重复合成');
              character.voiceId = candidate.voiceId;
              character.voiceProfile = candidate.title;
              character.voiceSource ||= "auto";
              character.voiceLocked = true;
              character.voiceReferenceUrl = result.url;
              if (result.languageCheck?.passed) character.voiceSelectionReason = `${character.voiceSelectionReason || ''}；目标语言试读已通过文字匹配检查（${Math.round(result.languageCheck.matchScore * 100)}%）`;
              await save(`${character.name} 的声音已固定，试读可试听`);
              break;
            } catch (error) {
              lastError = error instanceof Error ? error.message : "试读失败";
              if (signal.aborted || !(error instanceof ApiResponseError) || error.code !== 'VOICE_UNAVAILABLE') throw error;
              if (!character.voiceId) {
                character.voiceCandidates = character.voiceCandidates?.filter(c => c.voiceId !== candidate.voiceId);
                await save(`${character.name} 的不可用候选已排除`);
              }
            }
          }
          if (!character.voiceReferenceUrl)
            throw new ApiResponseError(
              `${character.name} 的候选均无法完成试读：${lastError}`,
              'VOICE_SELECTION_REQUIRED',
            );
          character.voiceIssue = undefined;
        } catch (error) {
          if (signal.aborted || !(error instanceof ApiResponseError) || error.code !== 'VOICE_SELECTION_REQUIRED') throw error;
          character.voiceIssue = error.message;
          character.locked = false;
          missingVoices.push(character.name);
          await save(`${character.name} 待从 Fish 选声；继续准备其余素材`);
        }
      }
      if (character.appearance !== "voice_only" && !character.bibleUrl) {
        if (isGptImage2Model(settings.imageModel || '') && usesPhotographicReferences(project.visualStyle)) {
          character.photographicAnchor ||= {};
          if (!character.photographicAnchor.imageUrl) {
            character.photographicAnchor.imageUrl = await image(character.photographicAnchor, {
              type: 'costume-anchor', name: character.name, description: character.description,
              referenceImageUrl: character.imageUrl || undefined,
            }, `${character.name} 实拍定妆主图`);
            await save(`${character.name} 实拍定妆主图已保存`);
          }
          if (!character.photographicAnchor.review) {
            character.photographicAnchor.review = await call('/api/series/audit-appearance', {
              imageUrl: character.photographicAnchor.imageUrl,
              apiKey: settings.apiKey, dmxApiKey: settings.dmxApiKey,
              scriptProvider: settings.scriptProvider, scriptModel: settings.scriptModel,
            });
            await save(`${character.name} 定妆质感核验已记录`);
          }
        }
        character.bibleUrl = await image(
          character,
          {
            type: "costume",
            name: character.name,
            description: character.description,
            referenceImageUrl: character.photographicAnchor?.imageUrl || character.imageUrl || undefined,
          },
          `${character.name} 定妆角色卡`,
        );
        if (character.photographicAnchor?.imageUrl) {
          // Keep the sheet for inspection, but feed the single photographic
          // anchor to downstream models: multi-view synthesis can re-stylize it.
          character.photographicSheetUrl = character.bibleUrl;
          character.bibleUrl = character.photographicAnchor.imageUrl;
        }
        character.imageUrl = character.bibleUrl;
      }
      character.locked = !character.speaking || Boolean(character.voiceId && character.voiceReferenceUrl);
      await save(character.locked ? `${character.name} 角色定稿 v${character.version}` : `${character.name} 形象已保存，声音待选择`);
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
    if (missingVoices.length) throw new ApiResponseError(`可继续准备的角色和场景素材已保存；${missingVoices.length} 个角色仍待选择 Fish 音色：${missingVoices.join('、')}。请到“角色与场景 → 从 Fish 音色库选声”指定后从断点重试，已有素材不会重做。`, 'VOICE_SELECTION_REQUIRED');
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
  if (!episode.deliveries.some(d => d.episodeVersion === episode.version) && copiedDialogueShotNumbers(episode.script).length) {
    await save(`第${episode.number}集自动纠正台词串镜，保留其余素材`);
    const result = await generate<{ script: NonNullable<SeriesEpisode["script"]> }>("script", project, episode.id);
    Object.assign(episode, repairEpisodeDialogue(project, episode, result.script));
    await save(`第${episode.number}集台词归属已修正，仅重制受影响片段`);
  }
  const synchronizedDialogue = synchronizeEpisodeDialogue(project, episode);
  if (synchronizedDialogue) {
    Object.assign(episode, synchronizedDialogue);
    await save(`第${episode.number}集已同步视频分段台词，仅重制过期片段`);
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
      story: { title: `${project.name} · 第${episode.number}集 · ${episode.title}`, theme: project.bible?.theme || '', logline: episode.synopsis, opening: episode.opening, goal: episode.goal, conflict: episode.conflict, choice: episode.choice, resolution: episode.resolution, hook: episode.hook },
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
      shots: episode.script.map(s => ({
        number: s.number, seconds: s.seconds, action: s.action, visual: s.visual, purpose: s.purpose, sound: s.sound,
        locationId: s.locationId,
        sceneStyle: project.locations.find(l => l.id === s.locationId)?.description,
        sceneImageUrl: project.locations.find(l => l.id === s.locationId)?.imageUrl,
        characters: s.characterIds.map(id => project.characters.find(c => c.id === id)!.name),
        dialogue: s.dialogue.map(d => ({ character: project.characters.find(c => c.id === d.characterId)!.name, text: d.text, emotion: d.emotion })),
      })),
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
            data.stage || currentStage || `第${episode.number}集制作中，断点已同步`,
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
