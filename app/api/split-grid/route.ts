import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { uploadBufferToCloudinary, uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { buildCloudinaryGridCellUrls } from '@/lib/gridCloudinary';

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_PERSISTED_GRID_BYTES = 9.5 * 1024 * 1024;

async function compressMotherGrid(sourceBuffer: Buffer): Promise<Buffer> {
  const pipeline = sharp(sourceBuffer).rotate().resize({
    width: 4096,
    height: 4096,
    fit: 'inside',
    withoutEnlargement: true,
  });
  let compressed = await pipeline.clone().jpeg({ quality: 90, chromaSubsampling: '4:4:4', progressive: true }).toBuffer();
  if (compressed.byteLength > MAX_PERSISTED_GRID_BYTES) {
    compressed = await pipeline.clone().jpeg({ quality: 84, chromaSubsampling: '4:4:4', progressive: true }).toBuffer();
  }
  return compressed;
}

export async function POST(request: NextRequest) {
  try {
    const { imageUrl, gridSize: requestedGridSize } = await request.json();
    const gridSize: 2 | 3 = Number(requestedGridSize) === 2 ? 2 : 3;
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
      // 4K PNG grids can exceed Cloudinary's 10 MB upload limit. Preserve the
      // useful 4K detail, encode a high-quality mother below the upload limit,
      // and let delivery transformations crop/size each lightweight cell.
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
      if (sourceBuffer.byteLength > MAX_SOURCE_BYTES) throw new Error('APIMart mother grid exceeds 50 MB');
      const compressed = await compressMotherGrid(sourceBuffer);
      grid = await uploadBufferToCloudinary(compressed, {
        folder: 'aid-grid-sources',
        resource_type: 'image',
      });
    }
    const width = Number(grid.width || 0);
    const height = Number(grid.height || 0);
    const cells = buildCloudinaryGridCellUrls(grid.secure_url, width, height, gridSize);

    return NextResponse.json({
      gridUrl: grid.secure_url,
      cells,
      preprocessing: {
        sourceWidth: width,
        sourceHeight: height,
        maxCellEdge: 1600,
        gridSize,
        delivery: 'quality-first-auto-compressed',
      },
    });
  } catch (error) {
    console.error('Split grid API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to persist and split grid image' },
      { status: 500 },
    );
  }
}
