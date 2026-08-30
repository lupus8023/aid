import { NextRequest, NextResponse } from "next/server";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { probeMedia } from "@/lib/companionVideoExportServer";
import {
  deliveryPath,
  requireLease,
  touchProject,
  withSeriesDb,
  assertSeriesRequest,
} from "@/lib/series/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  let temporary = "";
  try {
    assertSeriesRequest(request);
    const jobId = request.nextUrl.searchParams.get("jobId") || "",
      lease = request.headers.get("x-aid-lease") || "";
    const meta = await withSeriesDb((db) => {
      const job = requireLease(db, jobId, lease),
        project = db.projects.find((p) => p.id === job.seriesId)!;
      const episode = project.episodes.find((e) => e.id === job.episodeId);
      if (!episode || job.kind !== "produce")
        throw new Error("任务没有可交付的分集");
      return {
        seriesId: project.id,
        episodeId: episode.id,
        version: episode.version,
        aspectRatio: project.aspectRatio,
        fileName: `${project.name}-第${String(episode.number).padStart(2, "0")}集.mp4`,
      };
    });
    if (!request.body) throw new Error("成片内容为空");
    const output = deliveryPath(meta.seriesId, jobId);
    temporary = `${output}.${randomUUID()}.upload`;
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, _encoding, cb) {
        bytes += chunk.length;
        cb(
          bytes > 1024 * 1024 * 1024 ? new Error("单集成片超过1GB") : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(request.body as any),
      limit,
      createWriteStream(temporary, { mode: 0o600 }),
    );
    if (!bytes) throw new Error("成片内容为空");
    const media = await probeMedia(temporary);
    if (media.duration < 90 || media.duration > 150)
      throw new Error(
        `成片时长${Math.round(media.duration)}秒不符合约2分钟规格（90–150秒），请调整镜头时长后重制`,
      );
    if (!media.hasAudio) throw new Error("成片缺少声音轨道");
    const expectedRatio = meta.aspectRatio === "9:16" ? 9 / 16 : 16 / 9;
    if (Math.abs(media.width / media.height - expectedRatio) > 0.05)
      throw new Error("成片画幅与全剧规格不一致");
    await withSeriesDb(async (db) => {
      requireLease(db, jobId, lease);
      const project = db.projects.find((p) => p.id === meta.seriesId)!,
        episode = project.episodes.find((e) => e.id === meta.episodeId)!;
      if (episode.version !== meta.version)
        throw new Error("上传期间剧本版本改变，拒绝覆盖");
      await rename(temporary, output);
      episode.deliveries = [
        ...episode.deliveries.filter((d) => d.id !== jobId),
        {
          id: jobId,
          fileName: meta.fileName,
          createdAt: new Date().toISOString(),
          episodeVersion: meta.version,
          bytes,
        },
      ];
      touchProject(project);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存成片失败" },
      { status: 400 },
    );
  }
}
export async function GET(request: NextRequest) {
  try {
    assertSeriesRequest(request);
    const seriesId = request.nextUrl.searchParams.get("seriesId") || "",
      id = request.nextUrl.searchParams.get("id") || "";
    const delivery = await withSeriesDb((db) =>
      db.projects
        .find((p) => p.id === seriesId)
        ?.episodes.flatMap((e) => e.deliveries)
        .find((d) => d.id === id),
    );
    if (!delivery)
      return NextResponse.json({ error: "成片不存在" }, { status: 404 });
    const file = deliveryPath(seriesId, id),
      { size } = await stat(file);
    const range = request.headers.get("range");
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = match ? Number(match[1]) : 0,
      end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if ((range && !match) || start >= size || end < start)
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    const headers: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${request.nextUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="episode.mp4"; filename*=UTF-8''${encodeURIComponent(delivery.fileName)}`,
    };
    if (match) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new NextResponse(
      Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream,
      { status: match ? 206 : 200, headers },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取成片失败" },
      { status: 404 },
    );
  }
}
