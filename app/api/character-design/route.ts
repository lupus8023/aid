import { NextRequest, NextResponse } from 'next/server';
import { createProviderImageTask } from '@/lib/imageTaskProvider';
import { getImageModelCapabilities, imageModelRequiresApiKey, isMidjourneyImageModel, isGptImage2Model } from '@/lib/imageModels';
import { buildGptCharacterBiblePrompt, buildGptCharacterConceptPrompt } from '@/lib/gptImageReferences';
import { buildCharacterBiblePrompt, buildCharacterConceptGridPrompt } from '@/lib/promptArchitecture';
import type { VisualStyle } from '@/types';
import { buildMidjourneyPrompt } from '@/lib/midjourney';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      stage,
      name,
      role,
      age,
      personality,
      coreTheme,
      description,
      costumeDesc,
      referenceImages,
      selectedConceptUrl,
      candidateCount,
      visualStyle,
      imageModel,
      apiKey,
      comfyui,
      midjourneyProfile,
    } = body as {
      stage?: 'concepts' | 'bible';
      name?: string;
      role?: string;
      age?: string;
      personality?: string;
      coreTheme?: string;
      description?: string;
      costumeDesc?: string;
      referenceImages?: string[];
      selectedConceptUrl?: string;
      candidateCount?: 4 | 9;
      visualStyle?: VisualStyle;
      imageModel?: string;
      apiKey?: string;
      comfyui?: Record<string, unknown>;
      midjourneyProfile?: string;
    };

    const selectedModel = imageModel || 'seedream-5-0-pro';
    if (imageModelRequiresApiKey(selectedModel) && !apiKey) return NextResponse.json({ error: 'API Key is required' }, { status: 400 });
    if (!name?.trim() || !description?.trim()) {
      return NextResponse.json({ error: '角色名称和外观描述不能为空' }, { status: 400 });
    }

    const referenceLimit = getImageModelCapabilities(selectedModel).maxReferenceImages;
    const references = Array.isArray(referenceImages)
      ? referenceImages.filter(value => typeof value === 'string' && /^https?:\/\//i.test(value)).slice(0, referenceLimit)
      : [];

    if (stage === 'concepts') {
      const count: 4 | 9 = Number(candidateCount) === 4 ? 4 : 9;
      const prompt = (isGptImage2Model(selectedModel) ? buildGptCharacterConceptPrompt : buildCharacterConceptGridPrompt)({
        name,
        role,
        age,
        personality,
        coreTheme,
        description,
        costumeDesc,
        candidateCount: count,
        hasReferences: references.length > 0 && getImageModelCapabilities(selectedModel).maxReferenceImages > 0,
        visualStyle,
      });
      const taskId = await createProviderImageTask(prompt, references, apiKey || '', selectedModel, '1:1', undefined, comfyui, {
        midjourneyReferenceMode: 'image',
        midjourneyTaskMode: 'character-sheet',
        midjourneyVisualStyle: visualStyle,
        midjourneyHasPeople: true,
        midjourneyProfile,
      });
      return NextResponse.json({
        taskId,
        prompt: isMidjourneyImageModel(selectedModel) ? buildMidjourneyPrompt(prompt, { visualStyle, taskMode: 'character-sheet', hasPeople: true }) : prompt,
        candidateCount: count,
      });
    }

    if (stage === 'bible') {
      if (!selectedConceptUrl || !/^https?:\/\//i.test(selectedConceptUrl)) {
        return NextResponse.json({ error: '请先选择一个角色草稿' }, { status: 400 });
      }
      const prompt = (isGptImage2Model(selectedModel) ? buildGptCharacterBiblePrompt : buildCharacterBiblePrompt)({
        name,
        role,
        age,
        personality,
        coreTheme,
        description,
        costumeDesc,
        hasIdentityReference: true,
        visualStyle,
      });
      const taskId = await createProviderImageTask(prompt, [selectedConceptUrl], apiKey || '', selectedModel, '4:3', undefined, comfyui, {
        midjourneyReferenceMode: 'character',
        midjourneyTaskMode: 'character-sheet',
        midjourneyVisualStyle: visualStyle,
        midjourneyHasPeople: true,
        midjourneyProfile,
      });
      return NextResponse.json({
        taskId,
        prompt: isMidjourneyImageModel(selectedModel) ? buildMidjourneyPrompt(prompt, { visualStyle, taskMode: 'character-sheet', hasPeople: true }) : prompt,
      });
    }

    return NextResponse.json({ error: 'Invalid character design stage' }, { status: 400 });
  } catch (error) {
    console.error('Character design API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate character design' },
      { status: 500 },
    );
  }
}
