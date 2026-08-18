export type GridRecoveryItem = {
  status?: string;
  taskId?: string;
};

export type GridRecoveryPlan =
  | { kind: 'none' }
  | { kind: 'resume'; taskId: string }
  | { kind: 'release'; reason: string };

/**
 * Browser refresh destroys the in-memory poller. A persisted `generating`
 * state is only valid when it can reconnect to one APIMart task.
 */
export function planInterruptedGridRecovery(group: GridRecoveryItem[]): GridRecoveryPlan {
  const interrupted = group.filter(item => item.status === 'generating');
  if (interrupted.length === 0) return { kind: 'none' };

  const taskIds = [...new Set(interrupted.map(item => item.taskId).filter((value): value is string => Boolean(value)))];
  if (taskIds.length === 1) return { kind: 'resume', taskId: taskIds[0] };

  return {
    kind: 'release',
    reason: taskIds.length === 0
      ? '页面刷新中断了轮询，且没有可恢复的 APIMart 任务编号；已解除锁定，请重新生成本批'
      : '页面刷新后检测到多个不一致的 APIMart 任务编号；已解除锁定，请重新生成本批',
  };
}

export function normalizeSavedImageFailureReason(reason?: string): string | undefined {
  if (!reason) return reason;
  return reason.includes('[object Object]')
    ? '供应商返回了结构化错误；请重新生成本批以获取具体失败原因并自动修正'
    : reason;
}
