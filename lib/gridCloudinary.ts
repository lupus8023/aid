export function buildCloudinaryGridCellUrls(
  secureUrl: string,
  width: number,
  height: number,
  gridSize: 2 | 3 = 3,
): string[] {
  if (!secureUrl.includes('/upload/')) throw new Error('Invalid Cloudinary delivery URL');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < gridSize || height < gridSize) {
    throw new Error('Invalid grid image dimensions');
  }

  const cellWidth = Math.floor(width / gridSize);
  const cellHeight = Math.floor(height / gridSize);
  const inset = Math.max(0, Math.round(Math.min(cellWidth, cellHeight) * 0.045));
  const cropWidth = cellWidth - inset * 2;
  const cropHeight = cellHeight - inset * 2;
  const urls: string[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let column = 0; column < gridSize; column++) {
      const x = column * cellWidth + inset;
      const y = row * cellHeight + inset;
      // Crop from the persisted high-resolution mother, then cap only the
      // delivered derivative. A native 4K grid yields ~1.3K-wide 16:9 cells,
      // while q_auto:good keeps each reference compact for browser/Companion.
      const transform = `c_crop,x_${x},y_${y},w_${cropWidth},h_${cropHeight}/c_limit,w_1600,h_1600/q_auto:good,f_auto`;
      urls.push(secureUrl.replace('/upload/', `/upload/${transform}/`));
    }
  }
  return urls;
}
