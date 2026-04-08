// Split a 3x3 grid image into 9 individual images using Canvas
// Each cell has the same aspect ratio as the whole grid
export async function splitGridImage(
  imageUrl: string,
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9'
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const cellWidth = img.width / 3;
      const cellHeight = img.height / 3;
      const cells: string[] = [];

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const canvas = document.createElement('canvas');
          canvas.width = cellWidth;
          canvas.height = cellHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, col * cellWidth, row * cellHeight, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
          cells.push(canvas.toDataURL('image/jpeg', 0.95));
        }
      }
      resolve(cells);
    };
    img.onerror = () => reject(new Error('Failed to load grid image'));
    img.src = imageUrl;
  });
}

// Build the 3x3 grid prompt for a given set of storyboards
export function buildGridPrompt(
  sceneStyle: string,
  characterDescriptions: string,
  shotDescriptions: string[],
  aspectRatio: '16:9' | '9:16' | '1:1'
): string {
  const orientation = aspectRatio === '9:16' ? 'vertical portrait' : aspectRatio === '1:1' ? 'square' : 'horizontal landscape';
  const shots = shotDescriptions.slice(0, 9);
  while (shots.length < 9) shots.push(shots[shots.length - 1] || 'medium shot');

  return `Generate a 3x3 cinematic storyboard grid. Each of the 9 panels must be ${orientation} (${aspectRatio} aspect ratio). The entire grid image is also ${orientation}.

Scene environment: ${sceneStyle}
Characters: ${characterDescriptions}

Panel layout (left-to-right, top-to-bottom):
Panel 1: ${shots[0]}
Panel 2: ${shots[1]}
Panel 3: ${shots[2]}
Panel 4: ${shots[3]}
Panel 5: ${shots[4]}
Panel 6: ${shots[5]}
Panel 7: ${shots[6]}
Panel 8: ${shots[7]}
Panel 9: ${shots[8]}

CRITICAL: Maintain exact same characters, clothing, lighting, and environment across all 9 panels. Each panel must be clearly separated. No borders or labels between panels.`;
}
