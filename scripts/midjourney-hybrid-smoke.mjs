import fs from 'node:fs';

function readApiKey() {
  const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const line = env.split(/\r?\n/).find(value => /^APIMART_API_KEY=/.test(value));
  const raw = line?.slice(line.indexOf('=') + 1).trim() || '';
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

const apiKey = readApiKey();
if (!apiKey) throw new Error('APIMART_API_KEY missing from .env.local');
const requestedModel = process.argv[2] === 'nano'
  ? 'gemini-3.1-flash-image-preview'
  : 'gpt-image-2';

const anchorUrl = process.env.HYBRID_ANCHOR_URL
  || 'https://res.cloudinary.com/dgprzvbak/image/upload/c_crop,x_0,y_0,w_1472,h_824/c_limit,w_1600,h_1600/q_auto:good,f_auto/v1787924693/aid-images/mj-mermaid-photoreal-sheet-1787924689631.png';

const scenes = [
  '1. The frame takes in an underwater meadow as young Lanxi lifts a chipped white shell into rippled sunlight with delight; small silver fish pass nearby.',
  '2. Lanxi and the breadth of her childhood room share the frame while she kneels among many shells and adjusts one shell in a sunbeam.',
  '3. In the same room years later, adult Lanxi crosses with scrolls while a dusty shell box remains on a shelf in the depth of the image.',
  '4. The camera looks down across a crowded desk as adult Lanxi writes beside planning charts and untouched food, then rubs her tired brow.',
  '5. Among tall library shelves, adult Lanxi closes an illustrated whale book and reaches for a serious harbour-management book.',
  '6. Adult Lanxi appears small against a broad sunset shore, sitting alone with planning papers and quiet negative space around her.',
  '7. At a tidal pool, adult Lanxi and one little girl share the frame as the girl proudly shows three ordinary shells.',
  '8. The camera moves closer while adult Lanxi examines the shells with amused curiosity and the girl searches the shallow water behind her.',
  '9. A chipped white shell fills the sunlit foreground; the little girl smiles beyond it while adult Lanxi watches and quietly softens.',
].join('\n');

const basePrompt = `Create ONE strict cinematic storyboard contact sheet with exactly nine panels.

REFERENCE IMAGE 1 is the authoritative live-action film anchor. Preserve Lanxi as the same photographed strawberry-blonde actress, the same face, hair, pale pearl-pink practical mermaid costume and tail, realistic skin and fabric, teal water, warm-gold highlights, lens behavior, exposure and feature-film color grade. Preserve the photographic medium and production design. Do not copy the reference pose, shell position or camera angle.

LAYOUT: exactly 3 equal columns by 3 equal rows. Nine equal rectangular cells. Read left-to-right, top-to-bottom. Every cell is one complete 16:9 film frame. Straight shared cell boundaries, consistent cell size, no merged cells, no inset panels, no free-form collage, no empty cells, no borders or gutters. This is a sheet of finished film stills, not a production storyboard template.

The following nine lines are invisible directing notes. Never reproduce, summarize, title, label or quote any part of them inside the image. Use each line only to determine the visual content of its corresponding cell, in this exact order:
${scenes}

CONTINUITY: Panels 1-2 show the same younger Lanxi. Panels 3-9 show the same adult Lanxi. Panels 7-9 include exactly one little girl in addition to adult Lanxi. Keep Lanxi's facial identity, strawberry-blonde hair, pearl-pink costume and tail continuous. Use grounded actor blocking, restrained facial performance, physically believable underwater movement and real location-scale production design.

IMAGE QUALITY: an extremely photorealistic frame photographed for a high-budget live-action fantasy feature, real actors, practical costume and set materials, individual facial asymmetry, unretouched pores and baby hairs, realistic underwater caustics, natural optical depth of field, finite highlight rolloff, subtle 35mm motion character, no beauty-render polish.

ZERO TYPOGRAPHY: every pixel of every cell is photographic imagery. Do not render any words, letters, numbers, headings, camera terms, captions, labels, panel numbers, subtitles, logos, watermarks, UI, schedule text, book text or signage. Do not print the directing notes. No CGI character, 3D render, doll, figurine, illustration, anime, plastic skin or airbrushed face.`;
const prompt = requestedModel === 'gemini-3.1-flash-image-preview'
  ? `${basePrompt
      .replaceAll('Young Lanxi', 'Lanxi at age 18')
      .replaceAll('young Lanxi', 'Lanxi at age 18')
      .replaceAll('one little girl', 'one adult coastal scholar')
      .replaceAll('The little girl', 'The adult coastal scholar')
      .replaceAll('the little girl', 'the adult coastal scholar')
      .replaceAll('the girl', 'the adult coastal scholar')}

All people shown are adults in wholesome, family-safe fantasy storytelling. Lanxi wears a modest, opaque, full-coverage practical costume. The coastal scholar wears an ordinary full-coverage travel dress. No nudity, sensual pose, romance, danger or distress.`
  : basePrompt;

const createResponse = await fetch('https://api.apimart.ai/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: requestedModel,
    prompt,
    n: 1,
    size: '16:9',
    resolution: '4k',
    image_urls: [anchorUrl],
  }),
});
const created = await createResponse.json();
if (!createResponse.ok) throw new Error(`create ${createResponse.status}: ${JSON.stringify(created)}`);
const taskId = created?.data?.[0]?.task_id || created?.data?.task_id || created?.task_id || created?.id;
if (!taskId) throw new Error(`GPT-Image-2 create response omitted task id: ${JSON.stringify(created)}`);

process.stdout.write(`TASK ${taskId}\nMODEL ${requestedModel}\nANCHOR ${anchorUrl}\nPROMPT ${prompt}\n`);
for (let attempt = 1; attempt <= 120; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 5000));
  const response = await fetch(`https://api.apimart.ai/v1/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json();
  const task = payload?.data || payload;
  const status = String(task?.status || '').toLowerCase();
  process.stdout.write(`POLL ${attempt} ${status || response.status}\n`);
  if (status === 'completed') {
    const raw = task?.result?.images?.[0]?.url;
    const imageUrl = Array.isArray(raw) ? raw[0] : raw;
    if (!imageUrl) throw new Error(`${requestedModel} completed without image URL: ${JSON.stringify(task)}`);
    process.stdout.write(`RESULT ${JSON.stringify({ taskId, imageUrl })}\n`);
    process.exit(0);
  }
  if (status === 'failed') throw new Error(`${requestedModel} failure: ${JSON.stringify(task)}`);
}
throw new Error(`${requestedModel} hybrid smoke test timed out`);
