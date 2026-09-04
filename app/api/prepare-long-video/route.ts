import { NextRequest, NextResponse } from 'next/server';
import { directorPlanningPrompt, validateDirectorPlan } from '@/lib/h3Director';
import { extractJson } from '@/lib/pipeline/json';
import { chatOnce } from '@/lib/pipeline/llm';
import { generationDraft, recoverGeneration } from '@/lib/pipeline/generationDraft';
import { streamingJsonResponse } from '@/lib/streamingJsonResponse';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { prompt, duration, apiKey, dmxApiKey, scriptProvider, scriptModel } = await request.json();
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) throw new Error('请提供有效的原始提示词（最多 20000 字符）');
    const instruction = directorPlanningPrompt(prompt, duration);
    if (!apiKey && !dmxApiKey) throw new Error('请在设置中配置文本模型，以整理长视频分段');
    return streamingJsonResponse(async () => ({
      plan: await recoverGeneration({
        draft: generationDraft('h3-director-plan-v1', [prompt, duration, scriptProvider, scriptModel, apiKey, dmxApiKey]),
        attempts: 1,
        parse: raw => validateDirectorPlan({ ...extractJson(raw), sourcePrompt: prompt, duration }, duration, prompt),
        generate: () => chatOnce(instruction, { apiKey, dmxApiKey, provider: scriptProvider, model: scriptModel || 'gpt-4o', maxOutputTokens: 6500, timeoutMs: 120000, singleAttempt: true }),
      }),
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '长视频分段整理失败' }, { status: 400 });
  }
}
