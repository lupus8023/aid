import { NextRequest, NextResponse } from 'next/server';
import { createProviderImageTask } from '@/lib/imageTaskProvider';
import { imageModelRequiresApiKey, isMidjourneyImageModel, isGptImage2Model } from '@/lib/imageModels';
import { buildGptCharacterBiblePrompt, buildGptSceneReferencePrompt, buildGptCharacterAnchorPrompt, usesPhotographicReferences } from '@/lib/gptImageReferences';
import { buildCharacterBiblePrompt, buildSceneReferencePrompt, buildStoryWorldAnchorPrompt } from '@/lib/promptArchitecture';
import { submitImageOnce } from '@/lib/series/imageSubmission';
import { assertSeriesRequest, assertSeriesService, seriesRoot } from '@/lib/series/store';
import path from 'node:path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, name, description, costumeDesc, sceneStyle, representativeShot, storyCharacterNames, referenceImageUrl, appearanceCorrection, aspectRatio, imageModel, apiKey, visualStyle, styleReference, capturePreset, comfyui = {}, midjourneyProfile = '', midjourneyStyle = {}, imageSubmissionKey } = body;
    const selectedModel = imageModel || 'seedream-5-0-pro';
    if (imageModelRequiresApiKey(selectedModel) && !apiKey) return NextResponse.json({ error: 'API Key is required' }, { status: 400 });

    let prompt = '';
    if (type === 'costume-anchor' && isGptImage2Model(selectedModel) && usesPhotographicReferences(visualStyle)) {
      prompt = buildGptCharacterAnchorPrompt({ name, description, costumeDesc, hasIdentityReference: Boolean(referenceImageUrl), visualStyle });
      if (typeof appearanceCorrection === 'string' && appearanceCorrection.trim()) prompt += `\nCorrect these observed rendering defects only; preserve identity, species and costume: ${appearanceCorrection.slice(0, 1400)}`;
    } else if (type === 'costume') {
      prompt = (isGptImage2Model(selectedModel) ? buildGptCharacterBiblePrompt : buildCharacterBiblePrompt)({
        name,
        description,
        costumeDesc,
        hasIdentityReference: Boolean(referenceImageUrl),
        visualStyle,
      });
    } else if (type === 'scene') {
      prompt = isMidjourneyImageModel(selectedModel)
        ? buildStoryWorldAnchorPrompt({
            sceneStyle,
            representativeShot,
            characterNames: Array.isArray(storyCharacterNames) ? storyCharacterNames : [],
            visualStyle,
            capturePreset,
            aspectRatio: aspectRatio || '16:9',
          })
        : isGptImage2Model(selectedModel)
          ? buildGptSceneReferencePrompt(sceneStyle, visualStyle, aspectRatio || '16:9')
          : buildSceneReferencePrompt(sceneStyle, visualStyle, aspectRatio || '16:9', capturePreset);
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const submit = () => createProviderImageTask(
      prompt,
      referenceImageUrl ? [referenceImageUrl] : [],
      apiKey,
      selectedModel,
      type === 'costume' ? '4:3' : type === 'costume-anchor' ? '9:16' : (aspectRatio || '16:9'),
      undefined,
      comfyui,
      {
        styleReference,
        midjourneyReferenceMode: type === 'costume' ? 'character' : isMidjourneyImageModel(selectedModel) ? 'image' : 'style',
        midjourneyTaskMode: type === 'costume' ? 'character-sheet' : isMidjourneyImageModel(selectedModel) ? 'story-shot' : 'single',
        midjourneyVisualStyle: visualStyle,
        midjourneyCapturePreset: type === 'scene' ? capturePreset : undefined,
        midjourneyHasPeople: type === 'costume' || (isMidjourneyImageModel(selectedModel) && Array.isArray(storyCharacterNames) && storyCharacterNames.length > 0),
        midjourneyProfile,
        midjourneyReferences: { styleReferenceUrl: midjourneyStyle.styleReferenceUrl, styleWeight: midjourneyStyle.styleWeight },
      },
    );
    if (imageSubmissionKey) {
      assertSeriesService();
      assertSeriesRequest(request);
    }
    const taskId = imageSubmissionKey
      ? await submitImageOnce({ directory: path.join(seriesRoot(), 'image-submissions'), key: imageSubmissionKey, input: body, submit })
      : await submit();

    return NextResponse.json({ taskId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to generate costume image' }, { status: 500 });
  }
}
