import type { Storyboard } from '@/types';

/** Replace only model-authored visual execution fields. The screenplay beat,
 * exact dialogue, timing, shot grammar and reusable dialogue audio remain the
 * authority of the retained storyboard. */
export function mergeRegeneratedVisualPrompts(
  retained: Storyboard[],
  regenerated: Storyboard[],
): Storyboard[] {
  if (retained.length !== regenerated.length) {
    throw new Error(`视觉提示重写返回 ${regenerated.length} 镜，但保留分镜为 ${retained.length} 镜`);
  }
  return retained.map((storyboard, index) => {
    const fresh = regenerated[index];
    if (!fresh || fresh.sceneNumber !== storyboard.sceneNumber) {
      throw new Error(`视觉提示重写的第 ${index + 1} 项与保留的第 ${storyboard.sceneNumber} 镜不匹配`);
    }
    const next: Storyboard = {
      ...storyboard,
      description: fresh.description,
      prompt: fresh.prompt,
      videoDirection: fresh.videoDirection,
      videoDirectionSource: fresh.videoDirectionSource,
      characters: fresh.characters,
      objects: fresh.objects,
      characterCostume: fresh.characterCostume,
      sceneStyle: fresh.sceneStyle,
      referenceBindings: fresh.referenceBindings,
      videoPrompt: undefined,
      videoPromptOverride: false,
    };
    delete next.visualPromptRewriteId;
    return next;
  });
}
