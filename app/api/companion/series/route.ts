import { NextRequest, NextResponse } from "next/server";
import { recordSeriesInterruption, seriesCheckpointAdvanced } from '@/lib/series/interruption';
import { seriesRetryBlocker } from '@/lib/series/jobHistory';
import { setSeriesStyleReference } from '@/lib/series/styleReference';
import { imageModelRequiresApiKey } from '@/lib/imageModels';
import { mergeResumedSeriesSettings, resetEpisodeVideosForProviderChange } from '@/lib/series/videoProviderChange';
import { castSeriesRole } from "@/lib/series/casting";
import { seriesAssetsReady, seriesStageBlocker } from "@/lib/series/readiness";
import { moveSeriesToTrash, restoreSeriesFromTrash } from "@/lib/series/trash";
import {
  createSeries,
  invalidateFrom,
  parseScript,
  seriesId,
  text,
} from "@/lib/series/domain";
import {
  openSettings,
  publicSnapshot,
  requireLease,
  sealSettings,
  touchProject,
  withSeriesDb,
  assertSeriesRequest,
} from "@/lib/series/store";
import type {
  SeriesJob,
  SeriesJobKind,
  SeriesProject,
} from "@/lib/series/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    assertSeriesRequest(request);
    return NextResponse.json(await withSeriesDb((db) => publicSnapshot(db)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取失败" },
      { status: 503 },
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    assertSeriesRequest(request);
    const body = await request.json();
    const result = await withSeriesDb(async (db) => {
      const now = new Date().toISOString();
      const project = db.projects.find((p) => p.id === body.seriesId);
      if (project?.deletedAt && !["trash", "restore"].includes(body.action))
        throw new Error("连续剧已在回收站，请先恢复后再操作");
      const busy = (id: string) =>
        db.jobs.some(
          (j) => j.seriesId === id && ["queued", "running"].includes(j.status),
        );
      switch (body.action) {
        case "trash":
        case "restore": {
          if (!project) throw new Error("连续剧不存在");
          if (body.revision !== project.revision)
            throw new Error("内容已有更新，请刷新后重新确认，未更改项目");
          if (body.action === "trash") {
            if (body.confirmName !== project.name)
              throw new Error("请先确认要删除的连续剧名称");
            if (project.deletedAt) return { ok: true };
            moveSeriesToTrash(project, db.jobs, now);
          } else {
            if (!project.deletedAt) throw new Error("连续剧不在回收站");
            restoreSeriesFromTrash(project);
          }
          touchProject(project);
          return { ok: true };
        }
        case "create": {
          const created = createSeries(body.project || {});
          db.projects.unshift(created);
          return { project: created };
        }
        case "cast-character": {
          if (!project) throw new Error("连续剧不存在");
          if (busy(project.id))
            throw new Error("请先暂停制作队列，待当前任务保存断点后再选角");
          if (body.revision !== project.revision)
            throw new Error("内容已有更新，请刷新后再选角，未覆盖新版本");
          if (castSeriesRole(project, body.characterId, body.actor))
            touchProject(project);
          return { project };
        }
        case "edit": {
          if (!project) throw new Error("连续剧不存在");
          if (busy(project.id))
            throw new Error("请先暂停制作队列，待当前任务保存断点后再修改");
          if (body.revision !== project.revision)
            throw new Error("内容已有更新，请刷新后再保存，未覆盖新版本");
          if (body.episodeId) {
            const episode = project.episodes.find(
              (e) => e.id === body.episodeId,
            );
            if (!episode) throw new Error("分集不存在");
            const fields = [
              "title",
              "synopsis",
              "opening",
              "goal",
              "conflict",
              "choice",
              "resolution",
              "hook",
              "hookType",
              "nextOpening",
            ] as const;
            let changed = false;
            for (const key of fields)
              if (
                typeof body.patch?.[key] === "string" &&
                text(body.patch[key]) !== episode[key]
              ) {
                episode[key] = text(body.patch[key]);
                project.episodeNotes ||= {};
                project.episodeNotes[episode.id] = {
                  ...project.episodeNotes[episode.id],
                  [key]: episode[key],
                };
                changed = true;
              }
            if (body.patch?.script) {
              episode.script = parseScript(
                { shots: body.patch.script },
                project,
                episode,
              );
              episode.production = undefined;
              episode.version++;
            }
            if (changed) {
              const invalidated = invalidateFrom(
                project,
                episode.number,
                `第${episode.number}集故事已修改，请更新后续分集`,
              );
              project.episodes = invalidated.episodes;
              project.episodes.find((e) => e.id === episode.id)!.needsReview =
                "用户修改已保存；更新分集故事以重新核对知情、事实与悬念承接";
            }
          } else if (body.characterId) {
            const character = project.characters.find(
              (c) => c.id === body.characterId,
            );
            if (!character) throw new Error("角色不存在");
            let characterChanged = false;
            if (body.patch?.appearance !== undefined) {
              if (!['on_screen', 'voice_only'].includes(body.patch.appearance))
                throw new Error('无效的角色出镜类型');
              if (character.appearance !== body.patch.appearance) {
                character.appearance = body.patch.appearance;
                characterChanged = true;
              }
            }
            const voiceBriefChanged =
              typeof body.patch?.voiceBrief === "string" &&
              text(body.patch.voiceBrief) !== character.voiceBrief;
            for (const key of [
              "description",
              "voiceBrief",
              "voiceId",
              "imageUrl",
            ] as const)
              if (typeof body.patch?.[key] === "string") {
                const value = text(body.patch[key]);
                if (key === "imageUrl" && value && !/^https:\/\//i.test(value))
                  throw new Error("角色参考图需要HTTPS地址");
                if (value !== text(character[key])) {
                  characterChanged = true;
                  character[key] = value;
                  if (key === "description" || key === "imageUrl") {
                    character.casting = undefined;
                    character.bibleUrl = undefined;
                    character.imageTaskId = undefined;
                    character.imageSubmissionKey = undefined;
                    character.imageIssue = undefined;
                    character.imageFailures = undefined;
                    character.photographicAnchor = undefined;
                    character.photographicSheetUrl = undefined;
                    character.photographicCardReview = undefined;
                  }
                  if (key === "voiceId" || key === "voiceBrief") {
                    character.voiceReferenceUrl = undefined;
                    character.voiceIssue = undefined;
                    if (key === "voiceId") {
                      character.voiceSource = value ? "user" : "auto";
                      character.voiceProfile = value ? text(body.patch?.voiceProfile).slice(0, 200) || '已指定 Fish 音色' : undefined;
                      character.voiceSelectionReason = value ? '用户指定 Fish 音色；使用目标语言试读验证' : undefined;
                      character.voiceCandidates = undefined;
                      character.voiceLocked = false;
                    }
                  }
                }
              }
            if (!characterChanged) return { project };
            if (voiceBriefChanged && character.voiceSource !== "user") {
              character.voiceId = undefined;
              character.voiceCandidates = undefined;
              character.voiceLocked = false;
            }
            character.locked = false;
            character.version++;
            project.episodes = project.episodes.map((e) =>
              e.characterIds.includes(character.id)
                ? { ...e, version: e.version + 1, production: undefined }
                : e,
            );
          } else {
            if (Object.prototype.hasOwnProperty.call(body.patch || {}, 'styleReference')) setSeriesStyleReference(project, body.patch.styleReference);
            if (typeof body.patch?.name === "string" && text(body.patch.name))
              project.name = text(body.patch.name);
            if (
              typeof body.patch?.brief === "string" &&
              text(body.patch.brief) !== project.brief
            ) {
              if (project.bible)
                throw new Error(
                  "总纲建立后请编辑总纲；如需替换原始故事，请新建连续剧以保留旧版",
                );
              project.brief = text(body.patch.brief);
            }
            if (body.patch?.bible && project.bible) {
              for (const key of [
                "logline",
                "theme",
                "conflictEngine",
                "ending",
              ] as const)
                if (!text(body.patch.bible[key]))
                  throw new Error(`总纲 ${key} 不能为空`);
              // Structural IDs/schedules stay authoritative; editable prose may invalidate downstream episodes.
              for (const key of [
                "logline",
                "theme",
                "conflictEngine",
                "ending",
              ] as const)
                project.bible[key] = text(body.patch.bible[key]);
              project.episodes = invalidateFrom(
                project,
                1,
                "总纲已修改，需重新规划分集",
              ).episodes;
            }
          }
          touchProject(project);
          return { project };
        }
        case "enqueue": {
          if (!project) throw new Error("连续剧不存在");
          const kind = body.kind as SeriesJobKind;
          if (!["develop", "prepare", "script", "produce"].includes(kind))
            throw new Error("无效任务类型");
          const effectiveSettings = {
            ...(body.settings || {}),
            apiKey: body.settings?.apiKey || process.env.APIMART_API_KEY || '',
          };
          if (kind !== "prepare" && !effectiveSettings.apiKey && !effectiveSettings.dmxApiKey)
            throw new Error("请先在设置中配置剧本API");
          if (["prepare", "produce"].includes(kind)
            && imageModelRequiresApiKey(effectiveSettings.imageModel || 'seedream-5-0-pro')
            && !effectiveSettings.apiKey)
            throw new Error("当前图片模型需要 APIMart API Key；请先在设置中配置后再开始制作");
          const blocker = seriesStageBlocker(project, kind);
          if (blocker) throw new Error(blocker);
          if (
            ["prepare", "produce"].includes(kind) &&
            project.characters.some(
              (c) => c.speaking && (!c.voiceId || !c.voiceReferenceUrl),
            ) &&
            !effectiveSettings.fishAudioKey
          )
            throw new Error("请先配置 Fish Audio API Key");
          const selectedIds = Array.isArray(body.episodeIds)
            ? new Set(body.episodeIds)
            : undefined;
          if (
            selectedIds &&
            [...selectedIds].some(
              (id) => !project.episodes.some((e) => e.id === id),
            )
          )
            throw new Error("选中了不存在的分集");
          const episodeIds = ["script", "produce"].includes(kind)
            ? project.episodes
                .filter(
                  (e) =>
                    (!selectedIds || selectedIds.has(e.id)) &&
                    (kind === "script"
                      ? !e.script
                      : !e.deliveries.some(
                          (d) => d.episodeVersion === e.version,
                        )),
                )
                .map((e) => e.id)
            : [undefined];
          const sealedSettings = await sealSettings(effectiveSettings);
          let added = 0;
          for (const episodeId of episodeIds) {
            if (
              db.jobs.some(
                (j) =>
                  j.seriesId === project.id &&
                  j.episodeId === episodeId &&
                  j.kind === kind &&
                  ["queued", "running", "paused"].includes(j.status),
              )
            )
              continue;
            db.jobs.push({
              id: seriesId("job"),
              seriesId: project.id,
              episodeId,
              kind,
              status: "queued",
              stage: "等待执行",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
              sealedSettings,
            });
            added++;
          }
          project.paused = false;
          return { added };
        }
        case "pause":
        case "resume": {
          if (!project) throw new Error("连续剧不存在");
          project.paused = body.action === "pause";
          if (!project.paused && body.settings) {
            for (const job of db.jobs.filter((item) =>
              item.seriesId === project.id &&
              item.sealedSettings &&
              ['paused', 'queued'].includes(item.status),
            )) {
              const previousSettings = await openSettings(job.sealedSettings!);
              const resumedSettings = mergeResumedSeriesSettings(
                previousSettings,
                body.settings,
                process.env.APIMART_API_KEY || '',
              );
              if (
                job.kind === 'produce' &&
                previousSettings.videoProvider !== resumedSettings.videoProvider
              ) {
                resetEpisodeVideosForProviderChange(
                  project.episodes.find((episode) => episode.id === job.episodeId),
                );
              }
              job.sealedSettings = await sealSettings(resumedSettings);
            }
          }
          for (const job of db.jobs.filter((j) => j.seriesId === project.id)) {
            if (project.paused && job.status === "running")
              job.cancelRequested = true;
            if (project.paused && job.status === "queued") {
              job.status = "paused";
              job.stage = "已暂停";
            }
            if (!project.paused && job.status === "paused") {
              job.status = "queued";
              job.cancelRequested = false;
              job.stage = "等待恢复";
              job.error = undefined;
            }
          }
          return { ok: true };
        }
        case "delete-job": {
          if (!project) throw new Error("连续剧不存在");
          const index = db.jobs.findIndex(
            (j) => j.id === body.jobId && j.seriesId === project.id,
          );
          if (index < 0) throw new Error("任务不存在或已删除，请刷新列表");
          if (db.jobs[index].status !== "failed")
            throw new Error("只能删除失败任务；任务状态已更新，请刷新列表");
          // Remove only the queue record, including its saved credentials.
          // Project checkpoints and delivered media remain available for reuse.
          db.jobs.splice(index, 1);
          return { ok: true };
        }
        case "retry": {
          const job = db.jobs.find((j) => j.id === body.jobId);
          if (!job || job.status !== "failed")
            throw new Error("任务不处于失败状态");
          const owner = db.projects.find((p) => p.id === job.seriesId);
          if (!owner || owner.deletedAt)
            throw new Error("连续剧已在回收站或不存在，不能重试任务");
          const retryBlocker = seriesRetryBlocker(job, db.jobs);
          if (retryBlocker) throw new Error(retryBlocker);
          if (body.settings)
            job.sealedSettings = await sealSettings(body.settings);
          job.status = "queued";
          job.attempts = 0;
          job.consecutiveInterruptions = 0;
          job.error = undefined;
          job.cancelRequested = false;
          job.finishedAt = undefined;
          job.stage = "等待从断点重试";
          job.updatedAt = now;
          owner.paused = false;
          return { ok: true };
        }
        case "claim": {
          const workerId = text(body.workerId, 120);
          if (!workerId) throw new Error("缺少执行器编号");
          db.workers[workerId] = {
            seen: Date.now(),
            mode: body.mode === "companion" ? "companion" : "page",
          };
          for (const [id, worker] of Object.entries(db.workers))
            if (Date.now() - worker.seen > 120000) delete db.workers[id];
          for (const job of db.jobs.filter(
            (j) =>
              j.status === "running" &&
              Date.now() - (j.heartbeatAt || 0) > 45000,
          )) {
            recordSeriesInterruption(job, Boolean(job.cancelRequested || db.projects.find(p => p.id === job.seriesId)?.paused));
          }
          if (db.jobs.some((j) => j.status === "running"))
            return { claim: null };
          if (
            body.mode !== "companion" &&
            Object.values(db.workers).some(
              (w) => w.mode === "companion" && Date.now() - w.seen < 20000,
            )
          )
            return { claim: null };
          const job = db.jobs.find((j) => {
            const owner = db.projects.find((p) => p.id === j.seriesId);
            return j.status === "queued" && owner && !owner.paused && !owner.deletedAt;
          });
          if (!job) return { claim: null };
          const owner = db.projects.find((p) => p.id === job.seriesId)!;
          const settings = await openSettings(job.sealedSettings!);
          settings.apiKey ||= process.env.APIMART_API_KEY || '';
          if (imageModelRequiresApiKey(settings.imageModel || 'seedream-5-0-pro') && !settings.apiKey) {
            job.status = 'failed';
            job.stage = '制作配置缺失';
            job.error = '当前图片模型需要 APIMart API Key；请补充设置后从断点重试';
            job.finishedAt = now;
            job.updatedAt = now;
            return { claim: null };
          }
          job.status = "running";
          job.error = undefined;
          job.attempts++;
          job.workerId = workerId;
          job.lease = seriesId("lease");
          job.heartbeatAt = Date.now();
          job.updatedAt = now;
          job.stage = "正在准备";
          const { sealedSettings: _sealed, ...publicJob } = job;
          return { claim: { job: publicJob, project: owner, settings } };
        }
        case "release": {
          const job = requireLease(db, body.jobId, body.lease);
          job.status = "queued";
          job.attempts = Math.max(0, job.attempts - 1);
          job.lease = undefined;
          job.workerId = undefined;
          return { ok: true };
        }
        case "heartbeat": {
          const job = requireLease(db, body.jobId, body.lease);
          job.heartbeatAt = Date.now();
          if (job.workerId)
            db.workers[job.workerId] = {
              seen: Date.now(),
              mode: body.mode === "companion" ? "companion" : "page",
            };
          return {
            continue:
              !job.cancelRequested &&
              !db.projects.find((p) => p.id === job.seriesId)?.paused,
          };
        }
        case "checkpoint": {
          const job = requireLease(db, body.jobId, body.lease);
          const owner = db.projects.find((p) => p.id === job.seriesId)!;
          if (body.project) {
            const incoming = body.project as SeriesProject;
            if (
              incoming.id !== owner.id ||
              incoming.revision !== owner.revision
            )
              throw new Error("生产快照版本冲突，拒绝覆盖");
            const replacement = { ...incoming, paused: owner.paused, deletedAt: owner.deletedAt };
            if (seriesCheckpointAdvanced(owner, replacement)) job.consecutiveInterruptions = 0;
            touchProject(replacement);
            db.projects[db.projects.indexOf(owner)] = replacement;
          }
          job.stage = text(body.stage, 500) || job.stage;
          job.updatedAt = now;
          job.heartbeatAt = Date.now();
          return {
            revision: db.projects.find((p) => p.id === job.seriesId)!.revision,
          };
        }
        case "finish": {
          const job = requireLease(db, body.jobId, body.lease);
          if (body.interrupted) {
            const owner = db.projects.find((p) => p.id === job.seriesId)!;
            recordSeriesInterruption(job, owner.paused);
            job.updatedAt = now;
            return { ok: true };
          }
          if (!body.paused && !body.error) {
            const owner = db.projects.find((p) => p.id === job.seriesId)!;
            const episode = owner.episodes.find((e) => e.id === job.episodeId);
            if (
              job.kind === "develop" &&
              (!owner.bible ||
                owner.episodes.length !== owner.episodeCount ||
                owner.episodes.some((e) => e.needsReview))
            )
              throw new Error("整季编剧尚未完成，不能标记成功");
            if (job.kind === "script" && !episode?.script)
              throw new Error("镜头剧本尚未保存，不能标记成功");
            if (job.kind === "prepare" && !seriesAssetsReady(owner))
              throw new Error("角色形象、声音或场景尚未定稿，不能标记成功");
            if (
              job.kind === "produce" &&
              !episode?.deliveries.some(
                (d) => d.episodeVersion === episode.version,
              )
            )
              throw new Error("成片尚未落盘，不能标记成功");
          }
          job.status = body.paused
            ? "paused"
            : body.error
              ? "failed"
              : "completed";
          job.error = text(body.error, 1200) || undefined;
          job.stage = body.paused
            ? "已保存断点并暂停"
            : body.error
              ? "执行失败，可从断点重试"
              : "已完成";
          job.updatedAt = now;
          job.finishedAt = now;
          job.lease = undefined;
          if (job.status === "completed") job.sealedSettings = undefined;
          return { ok: true };
        }
        default:
          throw new Error("无效操作");
      }
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "连续剧操作失败" },
      { status: 400 },
    );
  }
}
