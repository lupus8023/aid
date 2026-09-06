import { NextRequest, NextResponse } from 'next/server';
import { buildVideoSegmentPrompt } from '@/lib/videoGenerator';
import { refineVideoDirections } from '@/lib/pipeline/videoDirection';
import { chatOnce } from '@/lib/pipeline/llm';
import { streamingJsonResponse } from '@/lib/streamingJsonResponse';
import { filmEndingDuration } from '@/lib/filmEnding';
import { estimateVideoSegmentSeconds } from '@/lib/videoSegments';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { storyboard, segmentStoryboards = [], referenceAudioNames = [], voiceProfiles = {}, language, hasFirstFrame = false, rewriteDirection = false, isFilmEnding = false, apiKey, dmxApiKey, scriptProvider, scriptModel, styleReference } = await request.json();
    if (!storyboard) {
      return NextResponse.json({ error: 'storyboard is required' }, { status: 400 });
    }

    const storyboards = Array.isArray(segmentStoryboards) && segmentStoryboards.length
      ? segmentStoryboards.slice(0, 4)
      : [storyboard];
    return streamingJsonResponse(async () => {
      const refined = await refineVideoDirections(storyboards, (prompt, imageUrls) => {
        if (!apiKey && !dmxApiKey) throw new Error('请先配置剧本模型密钥，以细化旧分镜的动作与摄影；已有分镜内容不会改变');
        return chatOnce(prompt, { apiKey, dmxApiKey, provider: scriptProvider, model: scriptModel || 'gpt-4o', imageUrls, maxOutputTokens: 2500, timeoutMs: process.env.AID_LOCAL_COMPANION === '1' ? 120_000 : 48_000 });
      }, { rewrite: rewriteDirection === true, hasFirstFrame: hasFirstFrame === true, useReferenceImages: true, isFilmEnding: isFilmEnding === true, language: language === 'en' ? 'en' : 'zh' });
      const videoPrompt = buildVideoSegmentPrompt(refined, [], {
        styleReference,
        isFilmEnding: isFilmEnding === true,
        duration: filmEndingDuration(estimateVideoSegmentSeconds(refined), isFilmEnding === true, undefined, Number(storyboard.videoEndingMinimumDuration) || 0),
        referenceAudioNames: Array.isArray(referenceAudioNames) ? referenceAudioNames.filter(Boolean).slice(0, 3) : [],
        hasVoiceReferences: Array.isArray(referenceAudioNames) && referenceAudioNames.length > 0,
        voiceProfiles: voiceProfiles && typeof voiceProfiles === 'object' ? voiceProfiles : {},
        firstFrameUrl: hasFirstFrame ? 'preview-continuity-frame' : undefined,
        language: language === 'en' ? 'en' : 'zh',
      });
      return { videoPrompt, directions: refined.map(shot => ({ id: shot.id, videoDirection: shot.videoDirection, videoDirectionSource: shot.videoDirectionSource })) };
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate video prompt' }, { status: 500 });
  }
}
