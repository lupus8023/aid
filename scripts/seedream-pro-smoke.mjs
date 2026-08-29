import fs from 'node:fs';

function readApiKey() {
  const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const line = env.split(/\r?\n/).find(value => /^APIMART_API_KEY=/.test(value));
  const raw = line?.slice(line.indexOf('=') + 1).trim() || '';
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

const apiKey = readApiKey();
if (!apiKey) throw new Error('APIMART_API_KEY missing from .env.local');

let taskId = process.argv[2] || '';
if (!taskId) {
  const createResponse = await fetch('https://api.apimart.ai/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'seedream-5-0-pro',
      prompt: 'A quiet cinematic coastal observatory at blue hour, physically realistic stone glass and sea mist, one complete frame, no people, no text, no logo, no watermark',
      n: 1,
      size: '16:9',
      resolution: '1.5K',
    }),
  });
  const created = await createResponse.json();
  if (!createResponse.ok) throw new Error(`create ${createResponse.status}: ${JSON.stringify(created)}`);
  taskId = created?.data?.[0]?.task_id || created?.data?.task_id || created?.task_id || created?.id;
  if (!taskId) throw new Error(`Seedream Pro create response omitted task id: ${JSON.stringify(created)}`);
}
process.stdout.write(`TASK ${taskId}\n`);

for (let attempt = 1; attempt <= 60; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 5000));
  let response;
  try {
    response = await fetch(`https://api.apimart.ai/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    process.stdout.write(`POLL ${attempt} network-retry ${error instanceof Error ? error.message : String(error)}\n`);
    continue;
  }
  const payload = await response.json();
  const task = payload?.data || payload;
  const status = String(task?.status || '').toLowerCase();
  process.stdout.write(`POLL ${attempt} ${status || response.status}\n`);
  if (status === 'completed' || status === 'success') {
    const raw = task?.result?.images?.[0]?.url;
    const imageUrl = Array.isArray(raw) ? raw[0] : raw;
    if (!imageUrl) throw new Error(`Seedream Pro completed without image URL: ${JSON.stringify(task)}`);
    process.stdout.write(`RESULT ${JSON.stringify({ taskId, imageUrl })}\n`);
    process.exit(0);
  }
  if (status === 'failed' || status === 'cancelled') {
    throw new Error(`Seedream Pro failure: ${JSON.stringify(task)}`);
  }
}
throw new Error('Seedream Pro smoke test timed out');
