import { NextRequest, NextResponse } from 'next/server';
import { buildVideoSegmentPrompt } from '@/lib/videoGenerator';

export async function POST(request: NextRequest) {
  try {
    const { storyboard, segmentStoryboards = [], referenceAudioNames = [], voiceProfiles = {}, language, hasFirstFrame = false } = await request.json();
    if (!storyboard) {
      return NextResponse.json({ error: 'storyboard is required' }, { status: 400 });
    }

    const storyboards = Array.isArray(segmentStoryboards) && segmentStoryboards.length
      ? segmentStoryboards.slice(0, 4)
      : [storyboard];
    const videoPrompt = buildVideoSegmentPrompt(storyboards, [], {
      duration: Number(storyboard.videoDuration) || undefined,
      referenceAudioNames: Array.isArray(referenceAudioNames) ? referenceAudioNames.filter(Boolean).slice(0, 3) : [],
      hasVoiceReferences: Array.isArray(referenceAudioNames) && referenceAudioNames.length > 0,
      voiceProfiles: voiceProfiles && typeof voiceProfiles === 'object' ? voiceProfiles : {},
      firstFrameUrl: hasFirstFrame ? 'preview-continuity-frame' : undefined,
      language: language === 'en' ? 'en' : 'zh',
    });
    return NextResponse.json({ videoPrompt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate video prompt' }, { status: 500 });
  }
}
