import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConcatMeta } from '../types';
import type { LivestreamJob } from './types';
import { jobOutputsDir, jobTmpDir, resolveWithinJob } from './paths';
import { run } from '../ffmpeg/run';

export function aspectDimensions(aspectRatio: '9:16' | '16:9'): { width: number; height: number } {
  return aspectRatio === '9:16' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
}

/**
 * Ghép TOÀN BỘ đoạn video (của mọi sản phẩm) theo đúng `order` tuyệt đối thành 1 file
 * final.mp4 liên tục — đúng nghĩa "video livestream". Không overlay text/mix nhạc nền
 * (không nằm trong scope tính năng này), khác với runConcatPipeline() của pipeline gốc.
 */
export async function runLivestreamConcat(
  job: LivestreamJob,
  onLog: (line: string) => Promise<void>
): Promise<{ outputPath: string; outputMeta: ConcatMeta; mergedSegmentPaths: string[] }> {
  const tmpDir = jobTmpDir(job.id);
  const outputsDir = jobOutputsDir(job.id);
  await fs.mkdir(tmpDir, { recursive: true });

  const allSegments = job.products.flatMap((p) => p.segments).sort((a, b) => a.order - b.order);
  const skipped = allSegments.filter((s) => s.status !== 'done' || !s.videoPath);
  const available = allSegments.filter((s) => s.status === 'done' && s.videoPath);

  if (available.length === 0) {
    throw new Error('Chưa có đoạn nào gen xong để ghép');
  }
  if (skipped.length > 0) {
    await onLog(
      `⚠️ Bỏ qua ${skipped.length} đoạn chưa gen xong: ${skipped
        .map((s) => s.id)
        .join(', ')} — vẫn ghép ${available.length} đoạn còn lại theo đúng thứ tự.`
    );
  }

  const concatListPath = path.join(tmpDir, 'concat_list.txt');
  const concatListContent = available
    .map((s) => resolveWithinJob(job.id, s.videoPath as string))
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(concatListPath, concatListContent, 'utf-8');
  await onLog(`✓ Concatenating ${available.length} đoạn...`);

  const outputPath = path.join(outputsDir, 'final.mp4');
  const { width, height } = aspectDimensions(job.aspectRatio);

  await run('ffmpeg', [
    '-f', 'concat', '-safe', '0', '-i', concatListPath,
    '-vf', `scale=${width}:${height}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
    '-c:a', 'aac', '-b:a', '192k',
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-movflags', '+faststart',
    outputPath, '-y',
  ]);

  const stat = await fs.stat(outputPath);
  const probe = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json',
    outputPath,
  ]);
  const probeData = JSON.parse(probe.stdout) as {
    streams?: Array<{ width: number; height: number; r_frame_rate: string }>;
    format?: { duration: string };
  };
  const stream = probeData.streams?.[0];
  const fpsRaw = stream?.r_frame_rate ?? '30/1';
  const [num, den] = fpsRaw.split('/').map(Number);
  const fps = den ? Math.round(num / den) : Math.round(num);

  const totalTarget = available.reduce((sum, s) => sum + s.duration, 0);
  const outputMeta: ConcatMeta = {
    sizeBytes: stat.size,
    durationSec: Number(probeData.format?.duration ?? totalTarget),
    width: stream?.width ?? width,
    height: stream?.height ?? height,
    fps,
  };

  // Đường dẫn tương đối các đoạn vừa ghép — route concat dùng để xoá file local sau khi
  // đã upload final lên R2 (deploy Ubuntu: không giữ segment local lâu dài).
  const mergedSegmentPaths = available.map((s) => s.videoPath as string);

  await onLog(`🎉 Final video: ${outputPath}`);
  return { outputPath, outputMeta, mergedSegmentPaths };
}
