import { VideoClip } from '../components/video-editor/types';
import { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpeg: FFmpeg | null = null;

type ProgressCallback = (progress: number, stage?: string) => void;

async function getFFmpeg(onProgress?: ProgressCallback): Promise<FFmpeg> {
  if (!ffmpeg) {
    onProgress?.(5, '准备 FFmpeg');
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
  onProgress: ProgressCallback
): Promise<Blob> {
  const tempPrefix = `export_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempFiles: string[] = [];

  const trackFile = (name: string) => {
    tempFiles.push(name);
    return name;
  };

  let ffmpegInstance: FFmpeg | null = null;

  try {
    console.log('Starting export with clips:', clips);

    if (clips.length === 1 && clips[0].trimStart === 0 && clips[0].trimEnd === 0) {
      onProgress(20, '读取素材');
      const response = await fetch(clips[0].url);
      const blob = await response.blob();
      onProgress(100, '生成文件');
      return blob;
    }

    ffmpegInstance = await getFFmpeg(onProgress);
    console.log('FFmpeg loaded');

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const inputName = trackFile(`${tempPrefix}_input${i}.mp4`);
      const trimmedName = trackFile(`${tempPrefix}_trimmed${i}.mp4`);
      const readProgress = 10 + (i / clips.length) * 20;
      const trimProgress = 30 + (i / clips.length) * 45;

      onProgress(readProgress, `读取素材 ${i + 1}/${clips.length}`);
      console.log(`Fetching clip ${i}:`, clip.url);

      const response = await fetch(clip.url);
      if (!response.ok) throw new Error(`Failed to fetch clip ${i + 1}`);

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      console.log(`Fetched clip ${i}, size:`, data.byteLength);
      await ffmpegInstance.writeFile(inputName, data);

      const duration = Math.max(0.1, clip.duration - clip.trimStart - clip.trimEnd);
      console.log(`Trimming clip ${i}: start=${clip.trimStart}, duration=${duration}`);
      onProgress(trimProgress, `裁剪片段 ${i + 1}/${clips.length}`);

      await ffmpegInstance.exec([
        '-i', inputName,
        '-ss', clip.trimStart.toString(),
        '-t', duration.toString(),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        trimmedName
      ]);

      // Long films used to keep every original alongside every trimmed clip,
      // doubling FFmpeg WASM memory. The trimmed copy is now the only file kept.
      await ffmpegInstance.deleteFile(inputName);
    }

    const concatName = trackFile(`${tempPrefix}_concat.txt`);
    const outputName = trackFile(`${tempPrefix}_output.mp4`);
    const concatContent = clips.map((_, i) => `file '${tempPrefix}_trimmed${i}.mp4'`).join('\n') + '\n';

    console.log('Concat content:', concatContent);
    await ffmpegInstance.writeFile(concatName, concatContent);

    onProgress(82, '快速合并视频');
    console.log('Starting concat...');
    await ffmpegInstance.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', concatName,
      '-c', 'copy',
      '-movflags', '+faststart',
      outputName
    ]);
    console.log('Concat complete');

    onProgress(95, '生成文件');
    const data = await ffmpegInstance.readFile(outputName);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    console.log('Output size:', bytes.byteLength);
    onProgress(100, '完成');
    return new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
  } catch (error) {
    console.error('Export error:', error);
    throw error;
  } finally {
    if (ffmpegInstance) {
      await Promise.all(tempFiles.map(async (file) => {
        try {
          await ffmpegInstance!.deleteFile(file);
        } catch {}
      }));
    }
  }
}
