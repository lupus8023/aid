import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enforceSeriesVideoProvider,
  mergeResumedSeriesSettings,
  resetEpisodeVideosForProviderChange,
} from '../lib/series/videoProviderChange.ts';

test('series production always locks video generation to local H3', () => {
  for (const videoProvider of ['apimart', 'fal', 'comfyui']) {
    const settings = enforceSeriesVideoProvider({
      apiProvider: 'apimart', apiKey: '', scriptModel: 'gpt-4o', imageModel: 'gpt-image-2',
      videoModel: 'doubao-seedance-1-5-pro', videoProvider,
    });
    assert.equal(settings.videoProvider, 'comfyui');
    assert.equal(settings.videoModel, 'minimax-h3');
  }
});

test('resuming with a new video provider keeps sealed credentials and nested Companion settings', () => {
  const previous = {
    apiProvider: 'apimart', apiKey: '', scriptModel: 'gpt-4o', imageModel: 'gpt-image-2',
    videoModel: 'doubao-seedance-1-5-pro', videoProvider: 'apimart', dmxApiKey: 'dmx-secret',
    comfyui: { sshHost: 'gpu', sshPort: 22, sshUser: 'root', sshKeyPath: '~/.ssh/id', comfyPort: 8188, workflowRoot: '/root/ComfyUI', h3Fl2vaProfile: 'dasiwa4' },
  };
  const resumed = mergeResumedSeriesSettings(previous, {
    videoProvider: 'comfyui',
    comfyui: { timeoutSeconds: 7200 },
  }, 'server-key');
  assert.equal(resumed.videoProvider, 'comfyui');
  assert.equal(resumed.videoModel, 'minimax-h3');
  assert.equal(resumed.apiKey, 'server-key');
  assert.equal(resumed.dmxApiKey, 'dmx-secret');
  assert.equal(resumed.comfyui.sshHost, 'gpu');
  assert.equal(resumed.comfyui.timeoutSeconds, 7200);
});

test('provider change invalidates paid video artifacts while preserving images and audio', () => {
  const episode = {
    production: {
      storyboards: [{
        id: 'scene-1', sceneNumber: 1, description: 'shot', prompt: 'frame', characters: [],
        status: 'completed', imageUrl: 'https://images.test/1.webp', audioUrl: 'data:audio/test',
        videoStatus: 'completed', videoTaskId: 'task-seedance', videoUrl: 'https://videos.test/1.mp4',
        videoSourceUrl: 'https://videos.test/source.mp4', videoCacheKey: 'cache-1',
        videoSegmentId: 'segment-1', videoSegmentStoryboardIds: ['scene-1'],
        videoProviderUsed: 'apimart', videoPrompt: 'seedance prompt', videoPromptOverride: true,
      }],
    },
  };
  assert.equal(resetEpisodeVideosForProviderChange(episode), 1);
  const shot = episode.production.storyboards[0];
  assert.equal(shot.imageUrl, 'https://images.test/1.webp');
  assert.equal(shot.audioUrl, 'data:audio/test');
  assert.equal(shot.videoStatus, 'pending');
  assert.equal(shot.videoTaskId, undefined);
  assert.equal(shot.videoUrl, undefined);
  assert.equal(shot.videoProviderUsed, undefined);
  assert.equal(shot.videoPrompt, undefined);
});
