import { NextRequest, NextResponse } from 'next/server';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';

export async function POST(request: NextRequest) {
  try {
    const { imageData } = await request.json();
    if (!imageData) return NextResponse.json({ error: 'Missing imageData' }, { status: 400 });

    const result = await uploadToCloudinary(imageData, { folder: 'aid-images' });
    return NextResponse.json({ url: result.secure_url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
