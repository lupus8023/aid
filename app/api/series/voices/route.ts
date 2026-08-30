import { NextRequest, NextResponse } from "next/server";
import {
  rankFishVoiceModels,
  type FishVoiceModel,
} from "@/lib/fishVoiceDiscovery";
import { inferVoiceGender } from "@/lib/voiceCasting";

export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    const {
      character,
      language = "zh",
      fishAudioKey,
      excludedIds = [],
    } = await request.json();
    if (!fishAudioKey || !character?.name)
      return NextResponse.json(
        { error: "缺少音色搜索参数或Fish API Key" },
        { status: 400 },
      );
    const keywords: string[] =
      String(character.voiceBrief || "").match(
        /沙哑|温柔|沉稳|低沉|清亮|活泼|磁性|温暖|成熟|叙述|warm|deep|calm|raspy|bright|narrat\w*/gi,
      ) || [];
    const queries = [
      "",
      keywords[0] ||
        (language === "zh"
          ? character.gender === "female"
            ? "女声"
            : character.gender === "male"
              ? "男声"
              : ""
          : ""),
    ];
    const pages = await Promise.all(
      [...new Set(queries)].map(async (title) => {
        const params = new URLSearchParams({
          page_size: "100",
          page_number: "1",
          language,
          licensed: "true",
          sort_by: "score",
          ...(title ? { title } : {}),
        });
        const response = await fetch(`https://api.fish.audio/model?${params}`, {
          headers: { Authorization: `Bearer ${fishAudioKey}` },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok)
          throw new Error(
            `Fish 音色搜索失败（${response.status}），请检查授权和服务状态`,
          );
        const data = await response.json();
        return (
          Array.isArray(data.items) ? data.items : []
        ) as FishVoiceModel[];
      }),
    );
    const desiredGender = character.gender;
    const models = [
      ...new Map(pages.flat().map((m) => [m._id, m])).values(),
    ].filter((m) => {
      const foundGender = inferVoiceGender({
        name: m.title || "",
        description: [m.description, ...(m.tags || [])].join(" "),
      });
      return (
        m.licensed === true &&
        !excludedIds.includes(m._id) &&
        !(
          desiredGender &&
          ["male", "female"].includes(desiredGender) &&
          foundGender !== "unknown" &&
          desiredGender !== foundGender
        )
      );
    });
    const ranked = rankFishVoiceModels(models, {
      ...character,
      language: language === "en" ? "en" : "zh",
    });
    const candidates = ranked
      .map((model, index) => {
        const description = [
          model.title,
          model.description,
          ...(model.tags || []),
        ]
          .join(" ")
          .toLowerCase();
        const matches = keywords.filter((k) =>
          description.includes(k.toLowerCase()),
        );
        return {
          voiceId: model._id,
          title: model.title || model._id,
          licensed: true,
          score: ranked.length - index + matches.length * 15,
          reason: `语言与角色资料匹配${matches.length ? `；特征：${matches.join("、")}` : ""}；已排除本剧占用音色；通过平台授权筛选`,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (!candidates.length)
      throw new Error(
        "未找到满足授权与角色区分要求的可用音色；请调整声音简报或指定已获授权的音色，不会静默使用随机声音",
      );
    return NextResponse.json({
      candidates,
      evaluation:
        "metadata-ranking; synthesis availability is checked separately, not an acting-quality rating",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动选声失败" },
      { status: 502 },
    );
  }
}
