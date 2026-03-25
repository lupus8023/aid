import { VideoClip } from '../components/video-editor/types';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      console.log('FFmpeg:', message);
    });
    await ffmpeg.load();
  }
  return ffmpeg;
}

export async function exportVideo(
  clips: VideoClip[],
  onProgress: (progress: number) => void
): Promise<Blob> {
  try {
    console.log('Starting export with clips:', clips);

    // 如果只有一个片段且没有裁剪，直接下载
    if (clips.length === 1 && clips[0].trimStart === 0 && clips[0].trimEnd === 0) {
      const response = await fetch(clips[0].url);
      const blob = await response.blob();
      onProgress(100);
      return blob;
    }

    const ffmpegInstance = await getFFmpeg();
    console.log('FFmpeg loaded');

    // 下载并裁剪所有视频片段
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      console.log(`Fetching clip ${i}:`, clip.url);

      const response = await fetch(clip.url);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      console.log(`Fetched clip ${i}, size:`, data.byteLength);
      await ffmpegInstance.writeFile(`input${i}.mp4`, data);

      // 裁剪视频（重新编码）
      const duration = clip.duration - clip.trimStart - clip.trimEnd;
      console.log(`Trimming clip ${i}: start=${clip.trimStart}, duration=${duration}`);

      await ffmpegInstance.exec([
        '-i', `input${i}.mp4`,
        '-ss', clip.trimStart.toString(),
        '-t', duration.toString(),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        `trimmed${i}.mp4`
      ]);

      onProgress(((i + 1) / clips.length) * 80);
    }

    // 创建 concat 文件
    let concatContent = '';
    for (let i = 0; i < clips.length; i++) {
      concatContent += `file 'trimmed${i}.mp4'\n`;
    }
    console.log('Concat content:', concatContent);
    await ffmpegInstance.writeFile('concat.txt', concatContent);

  // 合并视频
  console.log('Starting concat...');
  await ffmpegInstance.exec([
    '-f', 'concat',
    '-safe', '0',
    '-i', 'concat.txt',
    '-c', 'copy',
    'output.mp4'
  ]);
  console.log('Concat complete');

  onProgress(100);

  // 读取输出
  const data = await ffmpegInstance.readFile('output.mp4');
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  console.log('Output size:', bytes.byteLength);
  return new Blob([bytes], { type: 'video/mp4' });
  } catch (error) {
    console.error('Export error:', error);
    throw error;
  }
}
