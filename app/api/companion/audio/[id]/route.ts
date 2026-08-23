import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (process.env.AID_LOCAL_COMPANION !== '1') {
    return NextResponse.json({ error: 'Not available outside Companion' }, { status: 404 });
  }
  const { id } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) {
    return NextResponse.json({ error: 'Invalid audio id' }, { status: 400 });
  }
  const root = String(process.env.AID_COMPANION_DATA_DIR || '').trim();
  if (!root) return NextResponse.json({ error: 'Companion audio storage is not configured' }, { status: 500 });
  try {
    const buffer = await readFile(path.join(root, 'audio', `${id}.wav`));
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Audio track not found' }, { status: 404 });
  }
}
