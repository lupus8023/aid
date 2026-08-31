import { NextRequest, NextResponse } from 'next/server';
import { uploadImage } from '@/lib/imageUpload';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { imageData } = await request.json();
    if (typeof imageData !== 'string' || !imageData) return NextResponse.json({ error: 'Missing imageData' }, { status: 400 });

    const result = await uploadImage(imageData);
    return NextResponse.json({ url: result.secure_url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
