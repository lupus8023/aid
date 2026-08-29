import fs from 'node:fs';
import path from 'node:path';

import { buildVideoSegmentPrompt } from '../lib/videoGenerator.ts';

const companion = process.env.AID_COMPANION_URL || 'http://127.0.0.1:3018';
const framePath = path.resolve('outputs/nana-broadcast-candid/nana-shanghai-clean-first-frame.png');
if (!fs.existsSync(framePath)) throw new Error(`First frame is missing: ${framePath}`);
const firstFrame = `data:image/png;base64,${fs.readFileSync(framePath).toString('base64')}`;

const comfyui = {
  sshHost: 'me21gb3rds8p0h44.ssh.x-gpu.com',
  sshPort: 43213,
  sshUser: 'root',
  sshKeyPath: '~/.ssh/id_ed25519',
  comfyPort: 8188,
  workflowRoot: '/root/ComfyUI',
  imageWorkflowPath: '',
  multiImageWorkflowPath: '',
  firstLastWorkflowPath: '',
  h3Fl2vaProfile: 'balanced8',
  timeoutSeconds: 7200,
};

const storyboard = {
  id: 'nana-shanghai-broadcast-candid-1',
  sceneNumber: 1,
  action: 'Nana walks along the shop window at a natural pace. She slows for one moment, glances at an object behind the glass, adjusts the small paper shopping bag in her hand, and continues walking as a foreground pedestrian crosses between her and the camera.',
  description: 'Nana shops naturally on a busy Shanghai street while a distant television camera catches an unposed moment through pedestrian traffic.',
  prompt: 'Nana walks beside a Shanghai shop window in a candid long-lens television view.',
  characters: ['Nana'],
  objects: [],
  imageUrl: firstFrame,
  status: 'completed',
  videoDuration: 8,
  durationHint: 8,
  clipType: 'performance',
  shotSize: 'medium-wide full-body shot',
  angle: 'distant natural eye-level viewpoint from across the pedestrian flow',
  cameraMove: 'restrained lateral long-lens pan that briefly loses part of Nana behind a passing foreground pedestrian, then recovers without centering her',
  sceneStyle: 'busy tree-lined Shanghai shopping street in late afternoon, real pedestrians, bicycles, shop-window reflections and passing traffic',
  visualStyle: 'cinematic-natural',
  capturePreset: 'broadcast-candid',
  performance: [{
    character: 'Nana',
    objective: 'browse without noticing the distant camera',
    blocking: 'walk parallel to the shop window, slow once, then continue along the pavement',
    gesture: 'adjust the small paper bag once while looking into the window',
    expression: 'a fleeting private look of interest, then a neutral relaxed face',
    gaze: 'move from the window display to the walking path, never address the camera',
    breath: 'ordinary walking breath',
    reaction: 'briefly shifts around an approaching pedestrian without posing',
    subtext: 'an ordinary private shopping moment caught at a distance',
  }],
  audioPlan: {
    backgroundHuman: 'none',
    environment: ['soft Shanghai street traffic', 'distant bicycle freewheel', 'light tree-leaf movement'],
    foley: ['natural footsteps', 'small paper shopping bag rustle'],
    music: 'none',
    silenceBefore: 0,
    silenceAfter: 0,
  },
  dialogueLines: [],
  speech: [],
};

const videoPrompt = buildVideoSegmentPrompt([storyboard], [], { duration: 8, language: 'zh' });
if (!/CAPTURE MODE: Authentic live television candid footage/i.test(videoPrompt)) {
  throw new Error('Compiled H3 prompt is missing broadcast-candid capture mode');
}
if (/<d>/i.test(videoPrompt)) throw new Error('Silent Nana test unexpectedly contains dialogue');
storyboard.videoPrompt = videoPrompt;
storyboard.videoPromptOverride = true;

const outputDir = path.resolve('outputs/nana-broadcast-candid');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'h3-submitted-prompt.txt'), videoPrompt);

const response = await fetch(`${companion}/api/generate-video`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    storyboard,
    segmentStoryboards: [storyboard],
    language: 'zh',
    videoProvider: 'comfyui',
    aspectRatio: '16:9',
    voiceReferences: {},
    comfyui,
  }),
});
const created = await response.json();
if (!response.ok) throw new Error(`H3 create ${response.status}: ${JSON.stringify(created)}`);
const taskId = String(created.taskId || '');
if (!taskId) throw new Error(`H3 response omitted taskId: ${JSON.stringify(created)}`);
process.stdout.write(`TASK ${taskId}\nWORKFLOW ${created.workflow || ''}\nPROMPT_LENGTH ${videoPrompt.length}\n`);
fs.writeFileSync(path.join(outputDir, 'h3-task.json'), JSON.stringify({ taskId, workflow: created.workflow, videoPrompt }, null, 2));

for (let attempt = 1; attempt <= 160; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 15000));
  const pollResponse = await fetch(`${companion}/api/check-video-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, comfyui, localDelivery: true }),
  });
  const status = await pollResponse.json();
  if (!pollResponse.ok) throw new Error(`H3 poll ${pollResponse.status}: ${JSON.stringify(status)}`);
  process.stdout.write(`POLL ${attempt} ${status.status} ${status.stage || ''} ${status.progress ?? ''}\n`);
  if (status.status === 'failed') throw new Error(status.error || 'H3 generation failed');
  if (status.status !== 'completed') continue;

  const download = await fetch(`${companion}/api/comfyui/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, comfyui, smoothAudioTail: true }),
  });
  if (!download.ok) throw new Error(`H3 download ${download.status}: ${await download.text()}`);
  const outputPath = path.join(outputDir, 'nana-shanghai-broadcast-candid.mp4');
  fs.writeFileSync(outputPath, Buffer.from(await download.arrayBuffer()));
  process.stdout.write(`RESULT ${outputPath}\n`);
  process.exit(0);
}

throw new Error('H3 Nana smoke test timed out');
