export function createProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function scopedVideoCacheKey(projectId: string, storyboardId: string, generationSignature?: string): string {
  return `project-video:${projectId}:${storyboardId}${generationSignature ? `:${generationSignature}` : ''}`;
}
