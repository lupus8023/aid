import fs from 'node:fs';
import { buildMidjourneyImaginePayload } from '../lib/midjourney.ts';

function readApiKey() {
  const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const line = env.split(/\r?\n/).find(value => /^APIMART_API_KEY=/.test(value));
  const raw = line?.slice(line.indexOf('=') + 1).trim() || '';
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

const mode = process.argv[2] === 'mermaid-single'
  ? 'mermaid-single'
  : process.argv[2] === 'mermaid-grid'
  ? 'mermaid-grid'
  : process.argv[2] === 'grid'
    ? 'grid'
    : process.argv[2] === 'portrait'
      ? 'portrait'
      : 'single';
const apiKey = readApiKey();
if (!apiKey) throw new Error('APIMART_API_KEY missing from .env.local');

const singlePrompt = 'Cinematic medium close-up of the same Chinese woman from the character reference standing in a quiet skin-care laboratory, she raises a translucent facial mask toward cool window light and studies its surface, camera 1.6 metres away at natural eye level, gentle 50mm perspective, subject placed left of centre with laboratory glassware receding behind her, focus on her eyes and the mask edge, soft north-window key with weak warm practical fill, finite highlights on skin glass and fabric, quiet attentive mood';
const portraitPrompt = 'Cinematic medium close-up of the same Chinese woman from the character reference standing alone beside a rain-streaked laboratory window, both empty hands resting naturally on the dark workbench below frame, she looks toward cool dawn light with a quiet thoughtful expression, camera 1.8 metres away at natural eye level, gentle 50mm perspective, subject placed left of centre with laboratory glassware receding softly behind her, focus on her eyes, soft north-window key with weak warm practical edge light, finite highlights on skin hair glass and fabric, no product demonstration';
const mermaidSinglePrompt = 'A single extremely photorealistic feature-film frame of adult Mermaid Princess Lanxi in a shallow underwater meadow, the same strawberry-blonde identity and pearl-pink mermaid costume suggested by the character reference but performed by a real actress in practical makeup and a physically made costume, she studies one chipped white shell raised into rippled sunlight, restrained wonder in her eyes, silver fish cross the deep teal background, medium-wide 35mm composition at natural eye level, realistic underwater caustics, finite highlight rolloff, soft suspended particles, truthful wet hair skin fabric and scales, tactile physical production design, quiet high-budget live-action fantasy, no collage and no text';
const panels = [
  'Panel 1 (story scene 1): wide establishing frame of a solitary woman entering a rain-dark laboratory, low foreground glassware, cool dawn window at frame right.',
  'Panel 2 (story scene 2): medium profile as she removes her wet coat, camera at shoulder height through an out-of-focus steel shelf.',
  'Panel 3 (story scene 3): close detail of her hand placing a translucent facial mask beneath a practical task lamp, focus on damp material texture.',
  'Panel 4 (story scene 4): medium close-up as she studies the mask against window light, eyes on the material edge, negative space toward the window.',
  'Panel 5 (story scene 5): overhead insert of the mask, glass dish and metal tweezers arranged on a dark work surface, one sharp focus plane.',
  'Panel 6 (story scene 6): tight reaction portrait as a test indicator changes color off-screen, warm practical reflection entering her eyes.',
  'Panel 7 (story scene 7): low three-quarter view as she crosses to the microscope, foreground chair briefly occluding the lower frame.',
  'Panel 8 (story scene 8): macro view through laboratory glass as her fingertip steadies the sample, controlled cyan and amber reflections.',
  'Panel 9 (story scene 9): final medium-wide frame, she stands beside the illuminated sample with restrained relief, rain and dawn separating in the background.',
].join('\n');
const gridPrompt = `UNIQUE STORYBOARD BATCH: mj-smoke-1-9\nRender these nine distinct moments in exact order:\n${panels}\n\nScene continuity: the same compact skin-care laboratory before sunrise, rain on one north-facing window, dark steel benches, one amber task lamp.\nCharacter identities (match mapped references exactly wherever they appear): the same Chinese woman, shoulder-length dark hair, cream blouse and dark rain coat.`;
const mermaidPanels = [
  'Panel 1 (story scene 1): wide shallow underwater meadow, young Lanxi lifts a chipped white shell into rippled sunlight, delighted, silver fish nearby.',
  'Panel 2 (story scene 2): medium-wide childhood room, young Lanxi kneels among dozens of shells and carefully adjusts one in a sunbeam.',
  'Panel 3 (story scene 3): same room and angle years later, adult Lanxi crosses with scrolls; schedules fill the walls and a dusty shell box waits.',
  'Panel 4 (story scene 4): overhead desk frame, adult Lanxi writes beside a packed schedule and untouched food, rubbing her tired brow.',
  'Panel 5 (story scene 5): quiet library frame, Lanxi closes an illustrated whale story and reaches for a practical harbor-management book.',
  'Panel 6 (story scene 6): wide sunset shore with negative space, Lanxi sits alone and writes plan next week on an otherwise completed schedule.',
  'Panel 7 (story scene 7): medium two-shot at a tidal pool, Lanxi crouches beside one little girl proudly showing three ordinary shells.',
  'Panel 8 (story scene 8): close two-shot, Lanxi examines the shells with amused curiosity while the girl keeps searching the shallow water.',
  'Panel 9 (story scene 9): chipped white shell held in golden sunlight; the girl smiles while Lanxi watches and her adult certainty quietly breaks.',
].join('\n');
const mermaidGridPrompt = `UNIQUE STORYBOARD BATCH: unnecessary-shell-1-9\nRender these nine distinct moments in exact order:\n${mermaidPanels}\n\nScene continuity: natural ocean kingdom, pearl-white and teal-blue palette, realistic water and shells; restrained warm gold only for wonder and emotional recognition.\nCharacter identities (match mapped references exactly wherever they appear): Lanxi is the same strawberry-blonde mermaid princess from the character card, porcelain skin, pale pearl-pink dress and tail; panels 1-2 show her younger, panels 3-9 show her adult. Panels 7-9 add one ordinary little girl only.`;
const referenceUrl = process.env.MIDJOURNEY_REFERENCE_URL || 'https://pandais.beauty/uploads/main_1772791349274.png';

const body = buildMidjourneyImaginePayload(mode === 'grid' || mode === 'mermaid-grid'
  ? {
      prompt: mode === 'mermaid-grid' ? mermaidGridPrompt : gridPrompt,
      aspectRatio: '16:9',
      imageUrls: [referenceUrl],
      referenceMode: 'image',
      visualStyle: mode === 'mermaid-grid' ? 'cinematic-natural' : 'neo-noir',
      taskMode: 'grid',
      hasPeople: true,
    }
  : {
      prompt: mode === 'mermaid-single' ? mermaidSinglePrompt : mode === 'portrait' ? portraitPrompt : singlePrompt,
      aspectRatio: '16:9',
      imageUrls: [referenceUrl],
      referenceMode: mode === 'mermaid-single' ? 'image' : 'character',
      visualStyle: 'cinematic-natural',
      taskMode: 'single',
      hasPeople: true,
    });
if (process.env.MIDJOURNEY_PROFILE) {
  body.extra = `--profile ${process.env.MIDJOURNEY_PROFILE}`;
}
if (mode === 'portrait') {
  body.negative_prompt = `${body.negative_prompt}, product, package, box, facial mask, cosmetics, advertisement, held object`;
}

const createResponse = await fetch('https://api.apimart.ai/v1/midjourney/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const created = await createResponse.json();
if (!createResponse.ok) throw new Error(`create ${createResponse.status}: ${JSON.stringify(created)}`);
const taskId = created?.data?.[0]?.task_id || created?.data?.task_id || created?.task_id || created?.id;
if (!taskId) throw new Error(`Midjourney create response omitted task id: ${JSON.stringify(created)}`);

process.stdout.write(`TASK ${taskId}\nMODE ${mode}\nPROMPT ${body.prompt}\nNEGATIVE ${body.negative_prompt}\n`);
for (let attempt = 1; attempt <= 120; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 5000));
  const response = await fetch(`https://api.apimart.ai/v1/midjourney/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json();
  const task = payload?.data || payload;
  process.stdout.write(`POLL ${attempt} ${task?.status || response.status} ${task?.progress || ''}\n`);
  if (task?.status === 'SUCCESS') {
    process.stdout.write(`RESULT ${JSON.stringify({ taskId, grid: task.grid_image_url, images: task.image_urls })}\n`);
    process.exit(0);
  }
  if (task?.status === 'FAILURE') throw new Error(`Midjourney failure: ${task?.fail_reason || JSON.stringify(task)}`);
}
throw new Error(`Midjourney ${mode} smoke test timed out`);
