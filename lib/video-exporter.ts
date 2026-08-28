import { VideoClip } from '../components/video-editor/types';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { clippedPacingSections, effectiveClipDuration } from './videoPacing';

const STORY_AUDIO_TAIL_FADE_SECONDS = 0.05;

let ffmpeg: FFmpeg | null = null;

type ProgressCallback = (progress: number, stage?: string) => void;

async function getFFmpeg(onProgress?: ProgressCallback): Promise<FFmpeg> {
  if (!ffmpeg) {
    onProgress?.(5, '准备 FFmpeg');
    const instance = new FFmpeg();
    ffmpeg = instance;
    instance.on('log', ({ message }) => {
      console.log('FFmpeg:', message);
    });
    try {
      await Promise.race([
        instance.load(),
        new Promise<never>((_, reject) => window.setTimeout(
          () => reject(new Error('浏览器 FFmpeg 加载超时；请启动新版 Companion 使用本机合并')),
          30_000,
        )),
      ]);
    } catch (error) {
      try { instance.terminate(); } catch {}
      if (ffmpeg === instance) ffmpeg = null;
      throw error;
    }
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

    if (clips.length === 1
      && clips[0].trimStart === 0
      && clips[0].trimEnd === 0
      && clippedPacingSections(clips[0]).every(section => section.rate === 1)) {
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

      const pacingSections = clippedPacingSections(clip);
      const duration = Math.max(0.1, effectiveClipDuration(clip));
      console.log(`Pacing clip ${i}: sections=${pacingSections.length}, outputDuration=${duration}`);
      onProgress(trimProgress, `裁剪片段 ${i + 1}/${clips.length}`);

      const filters: string[] = [];
      if (pacingSections.length > 1) {
        filters.push(`[0:v:0]split=${pacingSections.length}${pacingSections.map((_section, sectionIndex) => `[vsrc${sectionIndex}]`).join('')}`);
        filters.push(`[0:a:0]asplit=${pacingSections.length}${pacingSections.map((_section, sectionIndex) => `[asrc${sectionIndex}]`).join('')}`);
      }
      pacingSections.forEach((section, sectionIndex) => {
        const videoSource = pacingSections.length > 1 ? `vsrc${sectionIndex}` : '0:v:0';
        const audioSource = pacingSections.length > 1 ? `asrc${sectionIndex}` : '0:a:0';
        const start = section.sourceStart.toFixed(3);
        const end = section.sourceEnd.toFixed(3);
        const rate = section.rate.toFixed(2);
        filters.push(`[${videoSource}]trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${rate}[v${sectionIndex}]`);
        filters.push(`[${audioSource}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,atempo=${rate}[a${sectionIndex}]`);
      });
      if (pacingSections.length > 1) {
        filters.push(`${pacingSections.map((_section, sectionIndex) => `[v${sectionIndex}][a${sectionIndex}]`).join('')}concat=n=${pacingSections.length}:v=1:a=1[vpaced][apaced]`);
      } else {
        filters.push('[v0]null[vpaced]');
        filters.push('[a0]anull[apaced]');
      }
      filters.push(`[apaced]apad=pad_dur=0.100,atrim=end=${duration.toFixed(3)},afade=t=out:st=${Math.max(0, duration - STORY_AUDIO_TAIL_FADE_SECONDS).toFixed(3)}:d=${STORY_AUDIO_TAIL_FADE_SECONDS.toFixed(3)}[aout]`);

      await ffmpegInstance.exec([
        '-i', inputName,
        '-filter_complex', filters.join(';'),
        '-map', '[vpaced]',
        '-map', '[aout]',
        '-t', duration.toFixed(3),
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
