import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_COMPANION_ORIGINS = new Set([
  'https://pandais.beauty',
  'https://www.pandais.beauty',
  'http://127.0.0.1:3018',
  'http://localhost:3018',
]);

function corsHeaders(response: NextResponse, origin: string): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  response.headers.set('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
  response.headers.set('Access-Control-Allow-Private-Network', 'true');
  response.headers.set('Access-Control-Max-Age', '86400');
  response.headers.append('Vary', 'Origin');
  response.headers.append('Vary', 'Access-Control-Request-Private-Network');
  return response;
}

export function middleware(request: NextRequest) {
  if (process.env.AID_LOCAL_COMPANION !== '1') return NextResponse.next();

  const origin = request.headers.get('origin') || '';
  if (origin && !ALLOWED_COMPANION_ORIGINS.has(origin)) {
    return NextResponse.json({ error: 'Origin is not allowed by the local aid companion' }, { status: 403 });
  }
  if (request.method === 'OPTIONS') {
    return corsHeaders(new NextResponse(null, { status: 204 }), origin || 'http://127.0.0.1:3018');
  }
  return corsHeaders(NextResponse.next(), origin || 'http://127.0.0.1:3018');
}

export const config = {
  matcher: [
    '/api/comfyui/test',
    '/api/companion/status',
    '/api/companion/audio/:path*',
    '/api/companion/export/:path*',
    '/api/comfyui/download',
    '/api/comfyui/character-replace',
    '/api/generate-video',
    '/api/image-to-video',
    '/api/check-video-status',
    '/api/generate-audio',
    '/api/generate-story-plan',
    '/api/direct-storyboard',
    '/api/expand-story',
  ],
};
