import type { SeriesEpisode } from './types';
import type { AppSettings, Storyboard } from '@/types';

export const SERIES_VIDEO_PROVIDER = 'comfyui' as const;

export function enforceSeriesVideoProvider(settings: AppSettings): AppSettings {
  return {
    ...settings,
    videoProvider: SERIES_VIDEO_PROVIDER,
  };
}

export function mergeResumedSeriesSettings(
  previous: AppSettings,
  incoming: Partial<AppSettings>,
  serverApiKey = '',
): AppSettings {
  return enforceSeriesVideoProvider({
    ...previous,
    ...incoming,
    apiKey: incoming.apiKey || previous.apiKey || serverApiKey,
    fal: {
      ...(previous.fal || {}),
      ...(incoming.fal || {}),
    },
    comfyui: previous.comfyui || incoming.comfyui
      ? {
          ...(previous.comfyui || {}),
          ...(incoming.comfyui || {}),
        } as AppSettings['comfyui']
      : undefined,
  });
}

function clearVideoArtifact(storyboard: Storyboard): Storyboard {
  return {
    ...storyboard,
    videoUrl: undefined,
    videoSourceUrl: undefined,
    videoCacheKey: undefined,
    videoCacheStatus: undefined,
    videoCachedAt: undefined,
    videoSegmentId: undefined,
    videoSegmentStoryboardIds: undefined,
    videoGenerationSignature: undefined,
    videoStatus: 'pending',
    videoTaskId: undefined,
    videoProviderUsed: undefined,
    videoSeed: undefined,
    videoPrompt: undefined,
    videoPromptOverride: false,
    videoDuration: undefined,
    videoEndingAudit: undefined,
    videoEndingWarning: undefined,
    videoDuplicateAudit: undefined,
    videoDuplicateRepairPrompt: undefined,
  };
}

export function resetEpisodeVideosForProviderChange(
  episode: SeriesEpisode | undefined,
): number {
  const storyboards = episode?.production?.storyboards;
  if (!storyboards?.length) return 0;
  const affected = storyboards.filter((storyboard) =>
    Boolean(
      storyboard.videoTaskId ||
      storyboard.videoUrl ||
      storyboard.videoSourceUrl ||
      storyboard.videoCacheKey ||
      storyboard.videoSegmentId ||
      storyboard.videoStatus === 'generating' ||
      storyboard.videoStatus === 'completed',
    ),
  ).length;
  if (!affected) return 0;
  episode!.production!.storyboards = storyboards.map(clearVideoArtifact);
  return affected;
}
