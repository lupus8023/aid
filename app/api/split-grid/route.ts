import { NextRequest, NextResponse } from 'next/server';
import { buildCloudinaryCompressedFetchUrl, uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { buildCloudinaryGridCellUrls } from '@/lib/gridCloudinary';

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
      // Cloudinary Fetch first creates a compressed 2K JPEG delivery, which is
      // then persisted normally and remains available after APIMart expires.
      const compressedFetchUrl = buildCloudinaryCompressedFetchUrl(imageUrl);
      grid = await uploadToCloudinary(compressedFetchUrl, {
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
