import { NextRequest, NextResponse } from 'next/server';
import { uploadImage, uploadImageBuffer } from '@/lib/imageUpload';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let result;
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('image');
      if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Missing image file' }, { status: 400 });
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return NextResponse.json({ error: '仅支持 PNG、JPEG 或 WebP 图片' }, { status: 400 });
      if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: '图片超过 50 MB' }, { status: 413 });
      result = await uploadImageBuffer(Buffer.from(await file.arrayBuffer()));
    } else {
      const { imageData } = await request.json();
      if (typeof imageData !== 'string' || !imageData) return NextResponse.json({ error: 'Missing imageData' }, { status: 400 });
      result = await uploadImage(imageData);
    }
    return NextResponse.json({ url: result.secure_url });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
