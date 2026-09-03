import type { Character, Storyboard } from '@/types';

export type ImageCastCharacter = Pick<Character, 'name' | 'description' | 'imageUrl'> & { appearance?: 'on_screen' | 'voice_only' };
export interface ImageCastCheck { sceneNumber: number; imageUrl: string; passed: boolean | null; issues: string[] }

type CastBoard = Pick<Storyboard, 'characters'> & Partial<Pick<Storyboard, 'prompt'>>;

// Director identity tags describe depicted roles, including silent companions
// omitted from a dialogue-driven beat cast. Do not scan dialogue or infer names
// from arbitrary prose: a mentioned or off-screen character need not be visible.
export function storyboardVisualCastNames(board: CastBoard, knownNames: string[]): string[] {
  const names = new Set(board.characters);
  for (const match of (board.prompt || '').matchAll(/\[([^\]\n]+)\]\(([^)\n]*)\)/g)) {
    const name = match[1].trim();
    if (knownNames.includes(name) && !/off[ -]?screen|voice[ -]?only|not visible|画外|仅声音/i.test(match[2])) names.add(name);
  }
  return [...names];
}

export function visibleImageCast<T extends ImageCastCharacter>(board: CastBoard, characters: T[]): T[] {
  const names = storyboardVisualCastNames(board, characters.map(c => c.name));
  return characters.filter(c => names.includes(c.name) && c.appearance !== 'voice_only');
}

export function prepareImageCastRepair(board: Storyboard, check: ImageCastCheck, characters: ImageCastCharacter[]): Storyboard {
  if (check.passed !== false || check.imageUrl !== board.imageUrl || check.sceneNumber !== board.sceneNumber) throw new Error('角色核验结果已过期或无需修复');
  const attempts = board.imageCastRepairAttempts || 0;
  if (attempts >= 2) throw new Error(`镜头${board.sceneNumber}角色核验在两次自动补图后仍未通过：${check.issues.join('；')}。已保留其余成果，停止继续付费。`);
  const cast = visibleImageCast(board, characters);
  return {
    ...board, characters: storyboardVisualCastNames(board, characters.filter(c => c.appearance !== 'voice_only').map(c => c.name)),
    imageUrl: undefined, gridSourceUrl: undefined, taskId: undefined, imageTaskMode: undefined, imageGridSize: undefined, imageCandidateUrls: undefined,
    imagePromptOverride: undefined, imageRetryCount: 0, status: 'pending',
    imageFailureReason: `视觉身份一致性自动修复：${check.issues.join('；')}`,
    imageCastRepairAttempts: attempts + 1,
    imageCastRepairPrompt: `VISUAL IDENTITY CONTINUITY CORRECTION: Show exactly ${cast.length} distinct character identities from their original reference sheets: ${cast.map(c => `${c.name}: ${c.description.slice(0, 180)}`).join('; ')}. Match species, face/head, body and wardrobe; no missing, merged or duplicated roles. Never replace an animal or fantasy creature with a human. For every registered object reference, preserve its exact silhouette, proportions, parts, material, color and physical markings; never redesign, substitute, deform or duplicate it. Previous defects: ${check.issues.join('; ').slice(0, 600)}.\n\nOriginal shot, preserve its action: ${board.prompt}`,
  };
}
