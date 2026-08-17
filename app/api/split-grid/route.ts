import { NextRequest, NextResponse } from 'next/server';
import { uploadToCloudinary } from '@/lib/cloudinaryUpload';
import { buildCloudinaryGridCellUrls } from '@/lib/gridCloudinary';

export async function POST(request: NextRequest) {
  try {
    const { imageUrl } = await request.json();
    if (typeof imageUrl !== 'string' || !/^https:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: 'A valid HTTPS grid image URL is required' }, { status: 400 });
    }

    // Cloudinary fetches and persists the short-lived APIMart result itself.
    // The browser no longer waits on Netlify's hanging getapib.org proxy.
    const grid = await uploadToCloudinary(imageUrl, {
      folder: 'aid-grid-sources',
      resource_type: 'image',
    });
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
