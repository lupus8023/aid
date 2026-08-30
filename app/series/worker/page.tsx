"use client";

import { useEffect, useState } from "react";
import { executeSeriesClaim, seriesRequest } from "@/lib/series/runner";
import type { SeriesClaim } from "@/lib/series/types";

export default function SeriesWorkerPage() {
  const [stage, setStage] = useState("正在连接连续剧队列");
  useEffect(() => {
    let stopped = false;
    let active: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const workerId = `worker-${crypto.randomUUID()}`;
    const mode =
      new URLSearchParams(window.location.search).get("mode") === "companion"
        ? "companion"
        : "page";
    const tick = async () => {
      try {
        const { claim } = await seriesRequest<{ claim: SeriesClaim | null }>({
          action: "claim",
          workerId,
          mode,
        });
        if (stopped) {
          if (claim)
            await seriesRequest({
              action: "release",
              jobId: claim.job.id,
              lease: claim.job.lease,
            }).catch(() => undefined);
          return;
        }
        if (claim) {
          active = new AbortController();
          let missed = 0,
            heartbeatBusy = false;
          const heartbeat = setInterval(async () => {
            if (heartbeatBusy) return;
            heartbeatBusy = true;
            try {
              const result = await seriesRequest<{ continue: boolean }>(
                {
                  action: "heartbeat",
                  jobId: claim.job.id,
                  lease: claim.job.lease,
                  mode,
                },
                "",
                AbortSignal.timeout(8000),
              );
              missed = 0;
              if (!result.continue) active?.abort("requested-pause");
            } catch {
              if (++missed >= 3) active?.abort("connection-lost");
            } finally {
              heartbeatBusy = false;
            }
          }, 5000);
          try {
            await executeSeriesClaim(claim, active.signal, setStage);
            await seriesRequest({
              action: "finish",
              jobId: claim.job.id,
              lease: claim.job.lease,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "生产失败";
            setStage(message);
            await seriesRequest({
              action: "finish",
              jobId: claim.job.id,
              lease: claim.job.lease,
              paused:
                active.signal.aborted &&
                active.signal.reason === "requested-pause",
              interrupted:
                active.signal.aborted &&
                active.signal.reason !== "requested-pause",
              error: message,
            }).catch(() => undefined);
          } finally {
            clearInterval(heartbeat);
            active = undefined;
          }
        } else setStage("执行器在线，等待任务");
      } catch (error) {
        setStage(
          error instanceof Error ? error.message : "连接中断，将自动重连",
        );
      }
      if (!stopped) timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      active?.abort("worker-unmounted");
    };
  }, []);
  return (
    <main className="min-h-screen bg-[#17181a] p-8 text-[#a4a8af]">
      <p className="text-sm">AID 连续剧执行器</p>
      <p className="mt-4 text-xs" role="status">
        {stage}
      </p>
    </main>
  );
}
