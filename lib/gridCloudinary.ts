export function buildCloudinaryGridCellUrls(
  secureUrl: string,
  width: number,
  height: number,
): string[] {
  if (!secureUrl.includes('/upload/')) throw new Error('Invalid Cloudinary delivery URL');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 3 || height < 3) {
    throw new Error('Invalid grid image dimensions');
  }

  const cellWidth = Math.floor(width / 3);
  const cellHeight = Math.floor(height / 3);
  const inset = Math.max(0, Math.round(Math.min(cellWidth, cellHeight) * 0.045));
  const cropWidth = cellWidth - inset * 2;
  const cropHeight = cellHeight - inset * 2;
  const urls: string[] = [];

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const x = column * cellWidth + inset;
      const y = row * cellHeight + inset;
      const transform = `c_crop,x_${x},y_${y},w_${cropWidth},h_${cropHeight}/q_auto,f_auto`;
      urls.push(secureUrl.replace('/upload/', `/upload/${transform}/`));
    }
  }
  return urls;
}
