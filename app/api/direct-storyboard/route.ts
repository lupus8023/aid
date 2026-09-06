import { NextRequest, NextResponse } from 'next/server';
import { directStoryboard } from '@/lib/pipeline/storyDirector';
import { streamingJsonResponse } from '@/lib/streamingJsonResponse';
import { adaptedStoryCharacters, storyCastKey } from '@/lib/pipeline/storyCastAdaptation';

export const maxDuration = 300;

// 导演阶段：StoryPlan → 有序分镜（Storyboard[]），无镜头数量上限。
export async function POST(request: NextRequest) {
  try {
    const {
      storyPlan, characters, objects, apiKey, aspectRatio, language, visualStyle, capturePreset, scriptProvider, scriptModel, dmxApiKey, generationRevision,
    } = await request.json();

    if (!storyPlan?.sequences) {
      return NextResponse.json({ error: 'storyPlan is required' }, { status: 400 });
    }
    if (!characters?.length) {
      return NextResponse.json({ error: 'characters are required' }, { status: 400 });
    }
    if (!apiKey && !dmxApiKey) {
      return NextResponse.json({ error: 'apiKey or dmxApiKey is required' }, { status: 400 });
    }

    const directorCharacters = storyPlan.castAdaptation?.castKey === storyCastKey(characters)
      ? adaptedStoryCharacters(characters, storyPlan.castAdaptation) : [...characters];
    for (const planned of storyPlan.characters || []) {
      if (!planned?.name || directorCharacters.some(character => character.name === planned.name)) continue;
      directorCharacters.push({
        name: planned.name,
        description: [
          'Text-defined supporting story identity. Preserve one stable role-appropriate face, body, age, silhouette, wardrobe and palette across every listed shot.',
          planned.role ? `Role: ${planned.role}.` : '',
          planned.gender && planned.gender !== 'unknown' ? `Gender: ${planned.gender}.` : '',
          planned.ageGroup && planned.ageGroup !== 'unknown' ? `Age group: ${planned.ageGroup}.` : '',
        ].filter(Boolean).join(' '),
        gender: planned.gender,
        ageGroup: planned.ageGroup,
        voiceId: planned.voiceId,
        voiceProfile: planned.voiceProfile,
        voiceSource: planned.voiceSource,
        voiceLocked: planned.voiceLocked,
      });
    }

    return streamingJsonResponse(async () => {
      const storyboards = await directStoryboard({
        storyPlan,
        characters: directorCharacters,
        objects: objects || [],
        apiKey,
        aspectRatio: aspectRatio || '16:9',
        language: language || 'zh',
        visualStyle,
        capturePreset,
        scriptProvider,
        scriptModel,
        dmxApiKey,
        generationRevision,
      });
      return { storyboards };
    });
  } catch (error: any) {
    console.error('direct-storyboard error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to direct storyboard' },
      { status: 500 }
    );
  }
}
