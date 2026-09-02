import fs from 'node:fs';
import path from 'node:path';

import { buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';

const companion = process.env.AID_COMPANION_URL || 'http://127.0.0.1:3018';
const framePath = path.resolve(process.env.AID_H3_SMOKE_FRAME || 'outputs/nana-broadcast-candid/nana-shanghai-clean-first-frame.png');
const outputDir = path.resolve(process.env.AID_H3_MOTION_OUTPUT || 'outputs/h3-motion-context-smoke');
const chainId = process.env.AID_H3_MOTION_CHAIN || `aid-motion-smoke-${Date.now()}`;
const startIndex = Number(process.env.AID_H3_MOTION_START_INDEX || 0);
const endIndex = Number(process.env.AID_H3_MOTION_END_INDEX || 1);
if (!fs.existsSync(framePath)) throw new Error(`First frame is missing: ${framePath}`);
fs.mkdirSync(outputDir, { recursive: true });
const image = `data:image/png;base64,${fs.readFileSync(framePath).toString('base64')}`;

const comfyui = {
  sshHost: 'me21gb3rds8p0h44.ssh.x-gpu.com', sshPort: 43213, sshUser: 'root',
  sshKeyPath: '~/.ssh/id_ed25519', comfyPort: 8188, workflowRoot: '/root/ComfyUI',
  imageWorkflowPath: '', multiImageWorkflowPath: '', firstLastWorkflowPath: '',
  h3Fl2vaProfile: 'dasiwa4', timeoutSeconds: 7200,
};

function storyboard(index) {
  const first = index === 0;
  const action = first
    ? 'Nana walks naturally past the shop window from left to right, holding a small paper bag. A foreground pedestrian crosses briefly while the distant camera pans with her.'
    : 'Without resetting her stride, Nana continues rightward from the exact prior motion phase. She shifts the paper bag once, glances briefly at the next display, and the camera lags slightly before catching up.';
  const shot = {
    id: `motion-smoke-${index}`, sceneNumber: index + 1, action, description: action,
    prompt: action, characters: ['Nana'], objects: [], imageUrl: image, status: 'completed',
    videoDuration: 5, durationHint: 5, clipType: 'performance',
    shotSize: 'medium-wide full-body shot', angle: 'distant natural eye-level long-lens viewpoint',
    cameraMove: 'restrained lateral pan following the same left-to-right movement',
    sceneStyle: 'busy Shanghai shopping street in late afternoon with shop-window reflections',
    visualStyle: 'cinematic-natural', capturePreset: 'broadcast-candid',
    sequenceId: 'motion-smoke-sequence', locationId: 'motion-smoke-location', transition: 'cut',
    videoStartMode: first ? 'storyboard' : 'previous-segment-tail',
    performance: [{
      character: 'Nana', objective: 'browse without noticing the camera',
      blocking: first ? 'walk steadily past the first display' : 'continue the same stride past the next display',
      gesture: 'adjust the paper bag once', expression: 'relaxed and unposed',
      gaze: 'briefly toward the display, never toward camera', breath: 'ordinary walking breath',
      reaction: 'keeps moving around foreground foot traffic', subtext: 'a private shopping moment',
    }],
    audioPlan: {
      backgroundHuman: 'none', environment: ['steady Shanghai street ambience', 'distant traffic'],
      foley: ['continuous footsteps', 'paper bag rustle'], music: 'none', silenceBefore: 0, silenceAfter: 0,
    },
    dialogueLines: [], speech: [],
  };
  shot.videoPrompt = buildVideoSegmentPrompt([shot], [], { duration: 5, language: 'zh' });
  shot.videoPromptOverride = true;
  return shot;
}

async function submitAndWait(index) {
  const shot = storyboard(index);
  const startedAt = Date.now();
  const response = await fetch(`${companion}/api/generate-video`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storyboard: shot, segmentStoryboards: [shot], language: 'zh', videoProvider: 'comfyui',
      aspectRatio: '16:9', firstFrameUrl: index > 0 ? image : undefined, voiceReferences: {}, comfyui,
      motionContext: { chainId, segmentIndex: index, contextFrames: 22, continueAudio: true, isFinalSegment: false },
    }),
  });
  const created = await response.json();
  if (!response.ok) throw new Error(`segment ${index} create ${response.status}: ${JSON.stringify(created)}`);
  process.stdout.write(`SEGMENT ${index} TASK ${created.taskId}\n`);

  for (let attempt = 0; attempt < 180; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const poll = await fetch(`${companion}/api/check-video-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: created.taskId, comfyui, localDelivery: true }),
    });
    const status = await poll.json();
    if (!poll.ok) throw new Error(`segment ${index} poll: ${JSON.stringify(status)}`);
    if (status.status === 'failed') throw new Error(`segment ${index}: ${status.error}`);
    if (status.status !== 'completed') continue;
    const download = await fetch(`${companion}/api/comfyui/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: created.taskId, comfyui, smoothAudioTail: false }),
    });
    if (!download.ok) throw new Error(`segment ${index} download: ${await download.text()}`);
    const output = path.join(outputDir, `segment-${index}.mp4`);
    fs.writeFileSync(output, Buffer.from(await download.arrayBuffer()));
    const seconds = (Date.now() - startedAt) / 1000;
    process.stdout.write(`SEGMENT ${index} RESULT ${output} ELAPSED ${seconds.toFixed(1)}s\n`);
    return { taskId: created.taskId, output, elapsedSeconds: seconds, videoPrompt: created.videoPrompt };
  }
  throw new Error(`segment ${index} timed out`);
}

const results = [];
for (let index = startIndex; index <= endIndex; index += 1) results.push(await submitAndWait(index));
fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify({ chainId, results }, null, 2));
process.stdout.write(`DONE ${path.join(outputDir, 'report.json')}\n`);
