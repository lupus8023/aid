import { createVideoTask, getVideoTaskStatus } from './apimart';
import { Storyboard } from '@/types';
import { buildVideoContinuityRules, buildVideoStyleContract } from './promptArchitecture';
import { allocateSegmentTimeline, estimateVideoSegmentSeconds } from './videoSegments';

function clock(seconds: number): string {
  const formatted = seconds.toFixed(Number.isInteger(seconds) ? 0 : 1);
  return seconds < 10 ? `0${formatted}` : formatted;
}

export function buildVideoSegmentPrompt(
  storyboards: Storyboard[],
  characterAudios: { character: string; audioUrl: string }[] = [],
  options: { firstFrameUrl?: string; duration?: number; hasVoiceReferences?: boolean } = {},
): string {
  const first = storyboards[0];
  if (!first) throw new Error('视频片段至少需要一个分镜');
  const duration = Math.min(15, Math.max(2, options.duration || estimateVideoSegmentSeconds(storyboards)));
  const timeline = allocateSegmentTimeline(storyboards, duration);
  const referenceOffset = options.firstFrameUrl ? 2 : 1;
  const characters = [...new Set(storyboards.flatMap(storyboard => storyboard.characters || []))];
  const objects = [...new Set(storyboards.flatMap(storyboard => storyboard.objects || []))];
  const dialogueFor = (storyboard: Storyboard) => storyboard.dialogueLines?.length
    ? storyboard.dialogueLines
    : Object.entries(storyboard.dialogue || {}).map(([character, text]) => ({ character, text }));
  const dialogueLines = storyboards.flatMap(dialogueFor).filter(line => String(line.text || '').trim());
  const hasVoiceReferences = options.hasVoiceReferences || characterAudios.length > 0;
  const audioMapping = characterAudios.length
    ? `\nVOICE REFERENCES:\n${characterAudios.map(audio => `@[${audio.character}] 使用@[${audio.audioUrl}]`).join('\n')}`
    : '';

  const storyboardSection = storyboards.map((storyboard, index) => {
    const range = timeline[index];
    const referenceNumber = index + referenceOffset;
    const beatCharacters = [...new Set(storyboard.characters || [])];
    const dialogue = dialogueFor(storyboard)
      .filter(line => String(line.text || '').trim())
      .map(line => `${line.character}: "${String(line.text).trim()}"`)
      .join(' / ');
    const cast = beatCharacters.length
      ? `${beatCharacters.length} total — ${beatCharacters.map(name => `${name} (one instance)`).join(', ')}`
      : '0 — no character or person visible';
    return `[00:${clock(range.start)}–00:${clock(range.end)}] BEAT ${index + 1} | Picture ${referenceNumber} | Scene ${storyboard.sceneNumber}\nEXACT CAST: ${cast}. No other person, creature, reflection-double or background extra.\nVISUAL ACTION: ${storyboard.description}\nPERFORMANCE: Execute one readable action and its immediate reaction; use concrete body mechanics, eye direction, weight shift and contact points from the scene.\nEDIT: ${index === 0 ? (options.firstFrameUrl ? 'The inherited first frame is already mid-motion. Continue that velocity immediately; no freeze, pose reset, settling pause or slow acceleration.' : 'Enter on active motion or a decisive visual fact.') : 'Cut on action, eyeline or cause-and-effect from the previous beat.'}\nAPPROVED DIALOGUE: ${dialogue || 'none — no speech, narration, vocalization or moving lips as if speaking.'}`;
  }).join('\n\n');

  return `GOAL:
Create one compact ${duration}-second feature-film sequence that advances the story through ${storyboards.length} distinct visual beat${storyboards.length > 1 ? 's' : ''}. It must feel photographed and edited by filmmakers: immediate, specific and performance-driven, never like a slow AI demonstration.

REFERENCE IMAGE CONTRACT:
${options.firstFrameUrl ? 'Picture 1 is the exact continuity state inherited from the preceding generated clip. Begin from its screen direction, body state, lighting and spatial geography.' : `Picture ${referenceOffset} is the literal opening visual authority.`}
${storyboards.map((_, index) => `Picture ${index + referenceOffset} defines the exact identity, wardrobe, composition, location facts, color response, lighting, lens rendering and texture for Beat ${index + 1}.`).join('\n')}
Do not morph between reference images. Treat them as editorial shot references captured by the same production, camera family and color pipeline.

IDENTITY & OBJECT CONTRACT:
CAST REGISTRY: ${characters.length ? characters.map(name => `${name} = one unique identity`).join('; ') : 'no named cast'}.
The EXACT CAST line in each beat is authoritative. Show each listed identity exactly once in that beat and keep every unlisted identity absent. A character reference sheet may contain multiple views of one identity; it is identity evidence, never permission to instantiate copies. Never clone, split, merge, recast or add a background double. Preserve exact face geometry, age, hair, body proportions, wardrobe and accessories. ${objects.length ? `Keep these objects physically identical: ${objects.join(', ')}.` : ''}

${buildVideoStyleContract(first.visualStyle)}

AUDIO:
DIALOGUE MODE: ${dialogueLines.length ? 'approved script only. Speak only the exact words under APPROVED DIALOGUE, once, by the named character, inside that beat. Preserve wording and order; do not paraphrase, repeat, overlap, improvise or add reactions.' : 'silent. No character speaks or makes a vocal sound.'}
${hasVoiceReferences ? 'Reference audio is timbre/accent evidence only. Never copy, quote, continue or echo its spoken content.' : ''}
Keep the soundtrack clean and sparse: quiet perspective-correct room tone plus only low-level Foley caused by a clearly visible action. No music, score, singing, humming, chanting, narration, whispering, laughter, crowd speech, off-screen voice, radio/TV voice, invented words or unexplained sound. No subtitles, captions, speech bubbles or on-screen text.${audioMapping}

STORYBOARD — ${duration} seconds:
${storyboardSection}

EDITING RULES:
Every beat must visibly occur inside its assigned time range. Use motivated hard cuts between distinct setups; no morphing, cross-generated in-between imagery or decorative dissolve unless explicitly requested. Vary shot scale and camera energy. Begin action immediately, remove dead air, and end on a decisive action, reaction or visual reveal.
For inherited continuity, frame 1 is a motion handoff rather than a pose to hold: preserve velocity, camera inertia, eyeline and secondary motion through the first half-second.

${buildVideoContinuityRules(hasVoiceReferences)}`;
}

export function buildStoryboardVideoPrompt(
  storyboard: Storyboard,
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
): string {
  if (storyboard.videoPromptOverride && storyboard.videoPrompt?.trim()) {
    return `${storyboard.videoPrompt.trim()}\n\n${buildVideoStyleContract(storyboard.visualStyle)}\n\n${buildVideoContinuityRules(characterAudios.length > 0)}`;
  }
  return buildVideoSegmentPrompt([storyboard], characterAudios, {
    firstFrameUrl,
    duration: storyboard.videoDuration,
  });
}

// 为单个分镜生成视频
export async function generateStoryboardVideo(
  storyboard: Storyboard,
  apiKey: string,
  model: string = 'sora-2',
  aspectRatio: '16:9' | '9:16' = '16:9',
  audioFiles: string[] = [],
  characterAudios: { character: string; audioUrl: string }[] = [],
  firstFrameUrl?: string,
  generateAudio?: boolean
): Promise<string> {
  // 确保有生成的图片
  if (!storyboard.imageUrl) {
    throw new Error(`Storyboard scene ${storyboard.sceneNumber} does not have a generated image`);
  }

  // Validate imageUrl is a public http/https URL (not base64)
  if (!storyboard.imageUrl.startsWith('http://') && !storyboard.imageUrl.startsWith('https://')) {
    throw new Error(`Scene ${storyboard.sceneNumber} image is not a public URL. Please regenerate the image individually first.`);
  }

  const videoPrompt = buildStoryboardVideoPrompt(storyboard, characterAudios, firstFrameUrl);


  console.log(`Creating video task for storyboard scene ${storyboard.sceneNumber}`);
  console.log(`Mode: Image-to-Video`);
  console.log(`Video prompt: ${videoPrompt}`);
  console.log(`Reference image: ${storyboard.imageUrl}`);
  console.log(`Using model: ${model}`);

  const isGrokImagine = model.toLowerCase().includes('grok-imagine');

  // firstFrameUrl = last frame of previous shot's video (Cloudinary so_last)
  const imageRoles = firstFrameUrl
    ? [{ url: firstFrameUrl, role: 'first_frame' as const }, { url: storyboard.imageUrl!, role: 'last_frame' as const }]
    : undefined;

  const taskId = await createVideoTask(
    videoPrompt,
    imageRoles ? [] : [storyboard.imageUrl!],
    apiKey,
    model,
    aspectRatio,
    {
      duration: storyboard.videoDuration,
      quality: isGrokImagine ? '480p' : undefined,
      // Don't pass audio when using firstFrame/lastFrame continuity mode (API limitation)
      audioUrls: firstFrameUrl ? [] : audioFiles,
      generateAudio: !firstFrameUrl && generateAudio,
      imageRoles
    }
  );

  console.log(`Video task created successfully, task ID: ${taskId}`);
  return taskId;
}

// 轮询检查视频任务状态，直到完成
export async function waitForVideoGeneration(
  taskId: string,
  apiKey: string,
  maxAttempts: number = 120, // 视频生成通常需要更长时间
  intervalMs: number = 5000 // 每5秒检查一次
): Promise<string> {
  console.log(`Starting to poll video task ${taskId}, max attempts: ${maxAttempts}, interval: ${intervalMs}ms`);

  for (let i = 0; i < maxAttempts; i++) {
    const status = await getVideoTaskStatus(taskId, apiKey);
    console.log(`Attempt ${i + 1}/${maxAttempts} - Video task ${taskId} status:`, status.status);

    if (status.status === 'completed' && status.result?.videos?.[0]?.url) {
      console.log(`Video task ${taskId} completed successfully, video URL:`, status.result.videos[0].url);
      return status.result.videos[0].url;
    }

    if (status.status === 'failed') {
      console.error(`Video task ${taskId} failed:`, status);
      throw new Error('Video generation failed');
    }

    // 等待后再次检查
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  console.error(`Video task ${taskId} timeout after ${maxAttempts} attempts (${maxAttempts * intervalMs / 1000} seconds)`);
  throw new Error('Video generation timeout');
}
