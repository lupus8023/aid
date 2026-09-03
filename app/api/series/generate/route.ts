import { NextRequest, NextResponse } from "next/server";
import { chatOnce } from "@/lib/pipeline/llm";
import { streamingJsonResponse } from "@/lib/streamingJsonResponse";
import { seriesPrompt } from "@/lib/series/prompts";
import { generateSeriesStage } from '@/lib/series/generation';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { SeriesProject } from "@/lib/series/types";

export const maxDuration = 300;
export async function POST(request: NextRequest) {
  try {
    const { stage, project, episodeId, settings } = await request.json();
    if (
      !["outline", "episodes", "script"].includes(stage) ||
      !project?.brief ||
      !settings
    )
      return NextResponse.json(
        { error: "缺少连续剧生成参数" },
        { status: 400 },
      );
    if (
      !Number.isInteger(project.episodeCount) ||
      project.episodeCount < 1 ||
      project.episodeCount > 100
    )
      return NextResponse.json({ error: "集数需为1–100" }, { status: 400 });
    const series = project as SeriesProject;
    const prompt = seriesPrompt(stage, series, episodeId);
    return streamingJsonResponse(async () => {
      const root = process.env.AID_COMPANION_DATA_DIR;
      const identity: unknown[] = [series.id, prompt, settings.scriptProvider, settings.scriptModel, settings.apiKey, settings.dmxApiKey];
      const savedScript = stage === 'script' ? series.episodes.find(e => e.id === episodeId)?.script : undefined;
      if (savedScript) identity.push('dialogue-source-v2', savedScript);
      const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
      const filename = root ? path.join(root, 'series-drafts', `${key}.txt`) : undefined;
      return generateSeriesStage(stage, series, episodeId, {
        read: filename ? async () => {
          try { return await readFile(filename, 'utf8'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
        } : undefined,
        save: filename ? async raw => {
          await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
          const temporary = `${filename}.${randomUUID()}.tmp`;
          await writeFile(temporary, raw, { mode: 0o600 });
          await rename(temporary, filename);
        } : undefined,
        chat: input => chatOnce(input, {
          apiKey: settings.apiKey,
          dmxApiKey: settings.dmxApiKey,
          provider: settings.scriptProvider,
          model: settings.scriptModel,
          maxOutputTokens: stage === "outline" ? 9000 : stage === 'episodes' ? 3500 : 7000,
        }),
      });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "连续剧生成失败" },
      { status: 400 },
    );
  }
}
