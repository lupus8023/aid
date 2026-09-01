import type { Storyboard } from '@/types';
import { isImageSafetyRejection } from './imagePromptSafety';

export function prepareReviewedImageRetry(board: Storyboard, review: string): Storyboard {
  const note = review.trim();
  if (board.status !== 'failed' || !board.taskId || !isImageSafetyRejection(board.imageFailureReason) || !note) {
    throw new Error('已审核重试需要当前被安全系统拒绝的任务、原任务号和审核说明');
  }
  const adultClarification = 'CAST AGE CLARITY: every named human or humanlike character in this frame is an adult over 21.';
  const prompt = board.imagePromptOverride || board.prompt;
  return {
    ...board,
    status: 'pending',
    taskId: undefined,
    imageTaskMode: undefined,
    imageFailureReason: undefined,
    imagePromptOverride: prompt.includes(adultClarification) ? prompt : `${adultClarification}\n${prompt}`,
    imageRetryCount: (board.imageRetryCount || 0) + 1,
    imageFailureHistory: [...(board.imageFailureHistory || []), {
      taskId: board.taskId,
      reason: board.imageFailureReason || '上游内容安全拒绝',
      at: new Date().toISOString(),
      review: note,
    }],
  };
}
