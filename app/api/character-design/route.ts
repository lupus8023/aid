import { NextRequest, NextResponse } from 'next/server';
import { createProviderImageTask } from '@/lib/imageTaskProvider';
import { getImageModelCapabilities, imageModelRequiresApiKey, isMidjourneyImageModel, isGptImage2Model } from '@/lib/imageModels';
import { buildGptCharacterBiblePrompt, buildGptCharacterConceptPrompt } from '@/lib/gptImageReferences';
import { buildCharacterBiblePrompt, buildCharacterConceptGridPrompt } from '@/lib/promptArchitecture';
import type { VisualStyle, CapturePreset } from '@/types';
import { normalizeImageStyleReference, withImageStyleReference, type ImageStyleReference } from '@/lib/imageStyleReference';
import { buildMidjourneyPrompt } from '@/lib/midjourney';
import { buildCharacterMasterPrompt, buildGptCharacterMasterPrompt, buildCharacterExtensionPrompt } from '@/lib/characterVisualMaster';

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
      midjourneyStyle = {},
      aestheticDirection,
      capturePreset,
      styleReference: requestedStyleReference,
    } = body as {
      stage?: 'concepts' | 'bible' | 'extension';
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
      midjourneyStyle?: { styleReferenceUrl?: string; styleWeight?: number };
      aestheticDirection?: string;
      capturePreset?: CapturePreset;
      styleReference?: ImageStyleReference;
    };

    const selectedModel = stage === 'extension'
      ? (imageModel === 'gpt-image-2-official' ? imageModel : 'gpt-image-2')
      : imageModel || 'midjourney';
    if (imageModelRequiresApiKey(selectedModel) && !apiKey) return NextResponse.json({ error: 'API Key is required' }, { status: 400 });
    if (!name?.trim() || (stage !== 'extension' && !description?.trim())) {
      return NextResponse.json({ error: '角色名称和外观描述不能为空' }, { status: 400 });
    }

    const referenceLimit = getImageModelCapabilities(selectedModel).maxReferenceImages;
    const styleReference = stage === 'extension' ? undefined : normalizeImageStyleReference(requestedStyleReference || (midjourneyStyle.styleReferenceUrl ? { imageUrl: midjourneyStyle.styleReferenceUrl } : undefined));
    const references = Array.isArray(referenceImages)
      ? referenceImages.filter(value => typeof value === 'string' && /^https?:\/\//i.test(value))
      : [];
    if (references.length + (styleReference && !isMidjourneyImageModel(selectedModel) ? 1 : 0) > referenceLimit || (Array.isArray(referenceImages) && references.length !== referenceImages.length)) {
      return NextResponse.json({ error: `参考图须为可访问的 HTTP(S) 图片地址，当前模型最多 ${referenceLimit} 张；未提交生成` }, { status: 400 });
    }

    if (stage === 'extension') {
      if (!selectedConceptUrl || !/^https?:\/\//i.test(selectedConceptUrl)) {
        return NextResponse.json({ error: '请先选定角色原图' }, { status: 400 });
      }
      const prompt = buildCharacterExtensionPrompt(name);
      const taskId = await createProviderImageTask(prompt, [selectedConceptUrl], apiKey || '', selectedModel, '9:16', undefined, comfyui);
      return NextResponse.json({ taskId, prompt, model: selectedModel });
    }

    if (stage === 'concepts') {
      if (isGptImage2Model(selectedModel)) {
        const prompt = buildGptCharacterMasterPrompt({ name, role, age, personality, description: description || '', costumeDesc, aestheticDirection, visualStyle, capturePreset, hasStyleReference: Boolean(styleReference) }, references.length > 0);
        const taskId = await createProviderImageTask(prompt, references, apiKey || '', selectedModel, '9:16', undefined, comfyui, { styleReference });
        return NextResponse.json({ taskId, prompt: withImageStyleReference(prompt, references, styleReference, referenceLimit, true).prompt, candidateCount: 1, layout: 'single', appliedStyle: { visualStyle, capturePreset, styleReference } });
      }
      if (isMidjourneyImageModel(selectedModel)) {
        const prompt = buildCharacterMasterPrompt({ name, role, age, personality, description: description || '', costumeDesc, aestheticDirection, visualStyle, capturePreset, hasStyleReference: Boolean(styleReference) });
        const taskId = await createProviderImageTask(prompt, references, apiKey || '', selectedModel, '9:16', undefined, comfyui, {
          midjourneyTaskMode: 'character-master', midjourneyReferenceMode: 'image',
          midjourneyProfile, midjourneyReferences: midjourneyStyle,
          styleReference,
        });
        return NextResponse.json({ taskId, prompt: buildMidjourneyPrompt(prompt, { taskMode: 'character-master' }) + (styleReference?.description ? `\n${styleReference.description}` : ''), candidateCount: 4, layout: 'native-candidates', appliedStyle: { visualStyle, capturePreset, styleReference, styleWeight: midjourneyStyle.styleWeight ?? 100 } });
      }
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
        styleReference,
        midjourneyTaskMode: 'character-sheet',
        midjourneyVisualStyle: visualStyle,
        midjourneyHasPeople: true,
        midjourneyProfile,
        midjourneyReferences: { styleReferenceUrl: midjourneyStyle.styleReferenceUrl, styleWeight: midjourneyStyle.styleWeight },
      });
      return NextResponse.json({
        taskId,
        prompt: isMidjourneyImageModel(selectedModel) ? buildMidjourneyPrompt(prompt, { visualStyle, taskMode: 'character-sheet', hasPeople: true, hasStyleReference: Boolean(midjourneyStyle.styleReferenceUrl) }) : prompt,
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
        styleReference,
        midjourneyTaskMode: 'character-sheet',
        midjourneyVisualStyle: visualStyle,
        midjourneyHasPeople: true,
        midjourneyProfile,
        midjourneyReferences: { styleReferenceUrl: midjourneyStyle.styleReferenceUrl, styleWeight: midjourneyStyle.styleWeight },
      });
      return NextResponse.json({
        taskId,
        prompt: isMidjourneyImageModel(selectedModel) ? buildMidjourneyPrompt(prompt, { visualStyle, taskMode: 'character-sheet', hasPeople: true, hasStyleReference: Boolean(midjourneyStyle.styleReferenceUrl) }) : prompt,
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
