import { NextRequest, NextResponse } from "next/server";
import { findSeriesVoices, SeriesVoiceSelectionRequired } from "@/lib/series/voices";

export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    const { character, language = "zh", fishAudioKey, excludedIds = [] } = await request.json();
    if (!fishAudioKey || !character?.name || !Array.isArray(excludedIds))
      return NextResponse.json({ error: "缺少音色搜索参数或Fish API Key" }, { status: 400 });
    return NextResponse.json(await findSeriesVoices(character, language === 'en' ? 'en' : 'zh', fishAudioKey, excludedIds));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "自动选声失败", code: error instanceof SeriesVoiceSelectionRequired ? error.code : undefined }, { status: error instanceof SeriesVoiceSelectionRequired ? 409 : 502 });
  }
}
