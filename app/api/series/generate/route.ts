import { NextRequest, NextResponse } from "next/server";
import { chatOnce } from "@/lib/pipeline/llm";
import { extractJson } from "@/lib/pipeline/json";
import { streamingJsonResponse } from "@/lib/streamingJsonResponse";
import { parseEpisodes, parseOutline, parseScript } from "@/lib/series/domain";
import { seriesPrompt } from "@/lib/series/prompts";
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
      project.episodeCount < 2 ||
      project.episodeCount > 100
    )
      return NextResponse.json({ error: "集数需为2–100" }, { status: 400 });
    const series = project as SeriesProject;
    const prompt = seriesPrompt(stage, series, episodeId);
    return streamingJsonResponse(async () => {
      let correction = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await chatOnce(`${prompt}${correction}`, {
          apiKey: settings.apiKey,
          dmxApiKey: settings.dmxApiKey,
          provider: settings.scriptProvider,
          model: settings.scriptModel,
          maxOutputTokens: stage === "outline" ? 9000 : 7000,
        });
        try {
          const raw = extractJson(response);
          if (stage === "outline") return parseOutline(raw, series);
          if (stage === "episodes")
            return {
              episodes: parseEpisodes(
                raw,
                series,
                series.episodes.length + 1,
                Math.min(4, series.episodeCount - series.episodes.length),
              ),
            };
          const episode = series.episodes.find((e) => e.id === episodeId);
          if (!episode) throw new Error("分集不存在");
          return { script: parseScript(raw, series, episode) };
        } catch (error) {
          if (attempt) throw error;
          correction = `\n上一次输出未通过检查：${error instanceof Error ? error.message : "格式错误"}。请完整重写并修复此问题。`;
        }
      }
      throw new Error("编剧生成未完成");
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "连续剧生成失败" },
      { status: 400 },
    );
  }
}
