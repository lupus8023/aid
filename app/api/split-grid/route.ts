import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { uploadBufferToCloudinary, uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { buildCloudinaryGridCellUrls } from '@/lib/gridCloudinary';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const { imageUrl } = await request.json();
    if (typeof imageUrl !== 'string' || !/^https:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: 'A valid HTTPS grid image URL is required' }, { status: 400 });
    }

    // Cloudinary fetches and persists the short-lived APIMart result itself.
    // The browser no longer waits on Netlify's hanging getapib.org proxy.
    let grid;
    try {
      grid = await uploadToCloudinary(imageUrl, {
        folder: 'aid-grid-sources',
        resource_type: 'image',
      });
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
      if (!/file size too large/i.test(message)) throw error;
      // GPT Image 4K PNG grids can exceed Cloudinary's 10 MB upload limit.
      // Download with the same request context used by APIMart's browser UI,
      // compress to a small 2K JPEG, then upload the buffer. getapib.org can
      // stall generic server fetches but responds normally with these headers.
      const sourceResponse = await fetch(imageUrl, {
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: 'https://apimart.ai/',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(45_000),
      });
      if (!sourceResponse.ok) throw new Error(`APIMart mother grid download failed: ${sourceResponse.status}`);
      const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
      if (sourceBuffer.byteLength > MAX_SOURCE_BYTES) throw new Error('APIMart mother grid exceeds 25 MB');
      const compressed = await sharp(sourceBuffer)
        .resize({ width: 2048, withoutEnlargement: true })
        .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
        .toBuffer();
      grid = await uploadBufferToCloudinary(compressed, {
        folder: 'aid-grid-sources',
        resource_type: 'image',
      });
    }
    const width = Number(grid.width || 0);
    const height = Number(grid.height || 0);
    const cells = buildCloudinaryGridCellUrls(grid.secure_url, width, height);

    return NextResponse.json({ gridUrl: grid.secure_url, cells });
  } catch (error) {
    console.error('Split grid API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to persist and split grid image' },
      { status: 500 },
    );
  }
}
