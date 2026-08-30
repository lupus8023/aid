import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppSettings } from "@/types";
import type { SeriesJob, SeriesProject, SeriesSnapshot } from "./types";

interface Database {
  version: 1;
  projects: SeriesProject[];
  jobs: SeriesJob[];
  workers: Record<string, { seen: number; mode: "companion" | "page" }>;
}

export function seriesRoot(): string {
  return path.join(
    process.env.AID_COMPANION_DATA_DIR ||
      path.join(os.homedir(), ".aid-companion"),
    "series",
  );
}
export function assertSeriesService(): void {
  if (
    process.env.AID_LOCAL_COMPANION !== "1" &&
    process.env.NODE_ENV === "production"
  )
    throw new Error(
      "连续剧持久队列需要新版本地 Companion，请启动或更新 Companion",
    );
}
export function assertSeriesRequest(request: Request): void {
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("连续剧数据库只在本机提供服务");
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin === url.origin ||
    [
      "https://pandais.beauty",
      "https://www.pandais.beauty",
      "http://localhost:3018",
      "http://127.0.0.1:3018",
    ].includes(origin)
  )
    return;
  if (
    process.env.NODE_ENV !== "production" &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  )
    return;
  throw new Error("此来源不能访问连续剧数据库");
}
export function safeSeriesId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(value))
    throw new Error("无效的项目或任务编号");
  return value;
}
export function deliveryPath(seriesId: string, deliveryId: string): string {
  return path.join(
    seriesRoot(),
    safeSeriesId(seriesId),
    `${safeSeriesId(deliveryId)}.mp4`,
  );
}

// A filesystem lease also serializes route bundles/processes. Writes are short
// and atomic; never keep this lock while contacting a model or transferring media.
export async function withSeriesDb<T>(
  operation: (db: Database) => Promise<T> | T,
): Promise<T> {
  assertSeriesService();
  const root = seriesRoot(),
    lock = path.join(root, ".lock");
  await mkdir(root, { recursive: true, mode: 0o700 });
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      const info = await stat(lock).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > 60000)
        await rm(lock, { recursive: true, force: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!acquired) throw new Error("连续剧数据库正忙，请重试");
  try {
    let db: Database;
    try {
      db = JSON.parse(await readFile(path.join(root, "index.json"), "utf8"));
    } catch (error: any) {
      if (error.code !== "ENOENT")
        throw new Error("连续剧数据库无法读取；已保留原文件，请勿覆盖");
      db = { version: 1, projects: [], jobs: [], workers: {} };
    }
    const result = await operation(db);
    const temp = path.join(root, `index-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(db), { mode: 0o600 });
    await rename(temp, path.join(root, "index.json"));
    return result;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function credentialKey(): Promise<Buffer> {
  const file = path.join(seriesRoot(), "credentials.key");
  try {
    return await readFile(file);
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const key = randomBytes(32);
  try {
    await writeFile(file, key, { flag: "wx", mode: 0o600 });
    return key;
  } catch (error: any) {
    if (error.code === "EEXIST") return readFile(file);
    throw error;
  }
}
export async function sealSettings(settings: AppSettings): Promise<string> {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", await credentialKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(settings), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export async function openSettings(value: string): Promise<AppSettings> {
  const buffer = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await credentialKey(),
    buffer.subarray(0, 12),
  );
  decipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(buffer.subarray(28)),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export function publicSnapshot(db: Database): SeriesSnapshot {
  const live = Object.values(db.workers).filter(
    (w) => Date.now() - w.seen < 20000,
  );
  const active = db.jobs.find((j) => j.status === "running");
  const activeWorker = active?.workerId
    ? db.workers[active.workerId]
    : undefined;
  return {
    projects: db.projects,
    jobs: db.jobs.map(
      ({
        lease: _lease,
        sealedSettings: _settings,
        workerId: _worker,
        heartbeatAt: _heartbeat,
        ...job
      }) => job,
    ),
    workerOnline: live.length > 0,
    workerMode:
      activeWorker && Date.now() - activeWorker.seen < 20000
        ? activeWorker.mode
        : live.some((w) => w.mode === "companion")
          ? "companion"
          : live.length
            ? "page"
            : undefined,
  };
}
export function requireLease(
  db: Database,
  id: string,
  lease: string,
): SeriesJob {
  const job = db.jobs.find((j) => j.id === id);
  if (!job || job.status !== "running" || !lease || job.lease !== lease)
    throw new Error("执行租约已失效，已阻止过期执行器写入");
  return job;
}
export function touchProject(project: SeriesProject): void {
  project.revision++;
  project.updatedAt = new Date().toISOString();
}
