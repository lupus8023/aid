import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: process.env.AID_LOCAL_COMPANION === '1',
    name: 'AID Companion',
    version: process.env.AID_COMPANION_VERSION || 'development',
  });
}
