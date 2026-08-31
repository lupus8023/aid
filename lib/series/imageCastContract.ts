import type { Character, Storyboard } from '@/types';

export type ImageCastCharacter = Pick<Character, 'name' | 'description' | 'imageUrl'> & { appearance?: 'on_screen' | 'voice_only' };
export interface ImageCastCheck { sceneNumber: number; imageUrl: string; passed: boolean | null; issues: string[] }

export function visibleImageCast<T extends ImageCastCharacter>(board: Pick<Storyboard, 'characters'>, characters: T[]): T[] {
  return characters.filter(c => board.characters.includes(c.name) && c.appearance !== 'voice_only');
}

export function prepareImageCastRepair(board: Storyboard, check: ImageCastCheck, characters: ImageCastCharacter[]): Storyboard {
  if (check.passed !== false || check.imageUrl !== board.imageUrl || check.sceneNumber !== board.sceneNumber) throw new Error('角色核验结果已过期或无需修复');
  const attempts = board.imageCastRepairAttempts || 0;
  if (attempts >= 2) throw new Error(`镜头${board.sceneNumber}角色核验在两次自动补图后仍未通过：${check.issues.join('；')}。已保留其余成果，停止继续付费。`);
  const cast = visibleImageCast(board, characters);
  return {
    ...board, imageUrl: undefined, gridSourceUrl: undefined, taskId: undefined, imageTaskMode: undefined, imageCandidateUrls: undefined,
    imagePromptOverride: undefined, imageRetryCount: 0, status: 'pending',
    imageFailureReason: `角色一致性自动修复：${check.issues.join('；')}`,
    imageCastRepairAttempts: attempts + 1,
    imageCastRepairPrompt: `CHARACTER CONTINUITY CORRECTION: Show exactly ${cast.length} distinct identities from their original reference sheets: ${cast.map(c => `${c.name}: ${c.description.slice(0, 180)}`).join('; ')}. Match species, face/head, body and wardrobe; no missing, merged or duplicated roles. Never replace an animal or fantasy creature with a human. Keep each identity recognizable. Previous defects: ${check.issues.join('; ').slice(0, 600)}.\n\nOriginal shot, preserve its action: ${board.prompt}`,
  };
}
