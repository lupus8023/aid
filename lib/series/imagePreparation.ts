import { isProviderContentRejection } from '../pipeline/providerPayload';

export interface SeriesImageAsset {
  imageSubmissionKey?: string;
  imageTaskId?: string;
  imageIssue?: { kind: 'review' | 'failed' | 'pending' | 'uncertain'; message: string; taskId?: string };
  imageFailures?: Array<{ taskId?: string; message: string; at: string; retryable: boolean }>;
}
export class SeriesImagePreparationError extends Error {}

/** A failed provider task is different from a failed status request. Only the
 * former may start another paid task, and only for explicit temporary errors. */
export async function prepareSeriesImage(asset: SeriesImageAsset, operations: {
  label: string;
  submit(): Promise<string>;
  recoverSubmission?(): Promise<string>;
  poll(taskId: string): Promise<{ status: string; imageUrl?: string; error?: string }>;
  persist(url: string): Promise<string>;
  save(stage: string): Promise<void>;
  wait(): Promise<void>;
  aborted(): boolean;
  maxPolls?: number;
}): Promise<string> {
  const { label, save } = operations;
  const fail = async (kind: 'review' | 'failed' | 'pending' | 'uncertain', message: string): Promise<never> => {
    asset.imageIssue = { kind, message, taskId: asset.imageTaskId };
    await save(`${label}：${kind === 'review' ? '上游审核拒绝，保留记录' : message}`);
    throw new SeriesImagePreparationError(`${label}：${message}`);
  };
  // Only a provider-confirmed result may clear a previous moderation refusal.
  // Retrying the queue may reconcile the original task, never buy a replacement.
  if (asset.imageIssue?.kind === 'review' && asset.imageTaskId) {
    if (operations.aborted()) throw new Error('已暂停');
    let restored;
    try { restored = await operations.poll(asset.imageTaskId); }
    catch (error) {
      if (operations.aborted()) throw error;
      throw new SeriesImagePreparationError(`${label}：上游复核状态暂不可查询；原拒绝记录保留`);
    }
    if (restored.status === 'completed' && restored.imageUrl) {
      let url;
      try { url = await operations.persist(restored.imageUrl); }
      catch (error) {
        if (operations.aborted()) throw error;
        throw new SeriesImagePreparationError(`${label}：上游已返回完成结果，但保存失败；原任务保留`);
      }
      if (!url) throw new SeriesImagePreparationError(`${label}：上游已返回完成结果，但保存没有返回地址；原任务保留`);
      asset.imageIssue = undefined;
      await save(`${label}上游原任务已完成，结果已恢复`);
      return url;
    }
  }
  // A resumed worker must not reset the paid retry budget or resubmit a refusal.
  if (asset.imageIssue?.kind === 'uncertain' && !asset.imageTaskId && asset.imageSubmissionKey && operations.recoverSubmission) {
    if (operations.aborted()) throw new Error('已暂停');
    try {
      asset.imageTaskId = await operations.recoverSubmission();
      if (!asset.imageTaskId) throw new Error('回执没有任务编号');
      asset.imageIssue = undefined;
      await save(`${label}已从本地提交回执恢复任务编号`);
    } catch (error) {
      if (operations.aborted()) throw error;
      throw new SeriesImagePreparationError(`${label}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (asset.imageIssue && asset.imageIssue.kind !== 'pending') {
    throw new SeriesImagePreparationError(`${label}：${asset.imageIssue.message}`);
  }
  for (;;) {
    if (!asset.imageTaskId) {
      if ((asset.imageFailures?.length || 0) >= 3) return fail('failed', '已达到三次生成上限，保留失败记录');
      await save(`提交${label}`);
      try {
        asset.imageTaskId = await operations.submit();
      } catch (error) {
        if (isProviderContentRejection(error)) return fail('review', error instanceof Error ? error.message : String(error));
        // A lost submission response is ambiguous: do not automatically buy again.
        const detail = error instanceof Error ? error.message : String(error);
        return fail('uncertain', `提交结果未确认，需核对供应商任务后再继续，避免重复计费：${detail}`);
      }
      if (!asset.imageTaskId) return fail('uncertain', '提交响应未返回任务编号，需核对供应商任务，避免重复计费');
      asset.imageIssue = undefined;
      await save(`${label}已提交，保存任务编号`);
    }
    let consecutivePollErrors = 0;
    let retry = false;
    for (let i = 0; i < (operations.maxPolls ?? 240); i++) {
      await operations.wait();
      let result;
      try { result = await operations.poll(asset.imageTaskId!); }
      catch (error) {
        if (operations.aborted()) throw error;
        if (isProviderContentRejection(error)) return fail('review', error instanceof Error ? error.message : String(error));
        if (++consecutivePollErrors >= 6) return fail('pending', '状态查询连续失败；保留任务编号，重试只继续查询');
        continue;
      }
      consecutivePollErrors = 0;
      if (result.status === 'failed') {
        const message = result.error || '上游生成失败';
        const review = isProviderContentRejection(message);
        const retryable = !review && /timeout|timed out|temporar|overload|rate.limit|\b(?:429|502|503|504)\b|超时|繁忙|限流/i.test(message);
        asset.imageFailures ||= [];
        if (!asset.imageFailures.some(f => f.taskId === asset.imageTaskId)) {
          asset.imageFailures.push({ taskId: asset.imageTaskId, message, at: new Date().toISOString(), retryable });
        }
        if (review || !retryable || asset.imageFailures.length >= 3) return fail(review ? 'review' : 'failed', message);
        asset.imageTaskId = undefined;
        asset.imageSubmissionKey = undefined;
        asset.imageIssue = undefined;
        await save(`${label}上游临时失败，自动恢复 ${asset.imageFailures.length}/3`);
        retry = true;
        break;
      }
      if (result.status === 'completed' && result.imageUrl) {
        for (let storageAttempt = 0; storageAttempt < 3; storageAttempt++) {
          try {
            const url = await operations.persist(result.imageUrl);
            if (!url) throw new Error('资产持久化没有返回地址');
            asset.imageIssue = undefined;
            return url;
          } catch (error) {
            if (operations.aborted()) throw error;
            if (storageAttempt === 2) return fail('pending', '图片已生成，但保存失败；保留任务编号，重试只重新保存');
            await operations.wait();
          }
        }
      }
    }
    if (retry) continue;
    return fail('pending', '等待超时；保留任务编号，重试会继续查询');
  }
}
