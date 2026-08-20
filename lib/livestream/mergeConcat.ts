/**
 * Ghép video final.mp4 của NHIỀU job (mỗi job đã tự "Ghép video" xong ở cấp job) thành 1 video
 * livestream liên tục cuối cùng — không re-flatten lại từng segment, chỉ nối các final.mp4 sẵn có.
 * Mirror lib/livestream/concat.ts (cùng tham số encode) để 2 luồng cho ra file tương thích nhau.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConcatMeta } from '../types';
import type { LivestreamJob } from './types';
import { readJob } from './jobStore';
import { resolveWithinJob, mergeOutputsDir, mergeTmpDir, resolveWithinMerge } from './paths';
import { aspectDimensions } from './concat';
import { run } from '../ffmpeg/run';

/** Đảm bảo final.mp4 của 1 job có mặt local (tải lại từ R2 vào tmp dir của merge nếu job đã bị xoá local). */
async function ensureLocalFinal(job: LivestreamJob, mergeSlug: string, index: number): Promise<string> {
  if (job.concat.outputPath) {
    const localPath = resolveWithinJob(job.slug, job.concat.outputPath);
    try {
      await fs.access(localPath);
      return localPath;
    } catch {
      // mất local (deploy mới) → thử tải từ R2 bên dưới
    }
  }
  if (!job.concat.outputUrl) {
    throw new Error(`Job "${job.name}" không có video final (cả local lẫn R2)`);
  }
  const res = await fetch(job.concat.outputUrl);
  if (!res.ok) throw new Error(`Tải final.mp4 job "${job.name}" từ R2 thất bại: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpDir = mergeTmpDir(mergeSlug);
  await fs.mkdir(tmpDir, { recursive: true });
  const downloadedPath = path.join(tmpDir, `job-${index}-final.mp4`);
  await fs.writeFile(downloadedPath, buffer);
  return downloadedPath;
}

export async function runMergeConcat(
  mergeSlug: string,
  jobSlugs: string[],
  onLog: (line: string) => Promise<void>
): Promise<{ outputPath: string; outputMeta: ConcatMeta }> {
  if (jobSlugs.length < 2) {
    throw new Error('Cần ít nhất 2 job để gộp');
  }

  const jobs = await Promise.all(jobSlugs.map((slug) => readJob(slug)));

  const notReady = jobs.filter((j) => j.concat.status !== 'done');
  if (notReady.length > 0) {
    throw new Error(
      `Các job sau chưa "Ghép video" xong: ${notReady.map((j) => j.name).join(', ')}`
    );
  }

  const aspectRatio = jobs[0].aspectRatio;
  const mismatched = jobs.filter((j) => j.aspectRatio !== aspectRatio);
  if (mismatched.length > 0) {
    throw new Error(
      `Các job phải cùng tỉ lệ khung hình ${aspectRatio} — job lệch: ${mismatched
        .map((j) => `${j.name} (${j.aspectRatio})`)
        .join(', ')}`
    );
  }

  await onLog(`✓ Chuẩn bị ${jobs.length} video final theo đúng thứ tự...`);
  const finalPaths = await Promise.all(jobs.map((job, i) => ensureLocalFinal(job, mergeSlug, i)));

  const tmpDir = mergeTmpDir(mergeSlug);
  const outputsDir = mergeOutputsDir(mergeSlug);
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(outputsDir, { recursive: true });

  const concatListPath = path.join(tmpDir, 'concat_list.txt');
  const concatListContent = finalPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(concatListPath, concatListContent, 'utf-8');

  const outputPath = resolveWithinMerge(mergeSlug, 'outputs/final.mp4');

  // Mọi final.mp4 đầu vào đã cùng tham số encode (do cùng chạy qua runLivestreamConcat) → thử
  // stream-copy trước (nhanh, không mất chất lượng), fallback re-encode nếu ffmpeg từ chối copy
  // (VD job cũ encode bằng tham số khác trước khi tính năng này tồn tại).
  try {
    await onLog('✓ Ghép nhanh (stream copy)...');
    await run('ffmpeg', ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outputPath, '-y']);
  } catch (err) {
    await onLog(`⚠️ Stream copy thất bại (${(err as Error).message.slice(-200)}), chuyển sang re-encode...`);
    const { width, height } = aspectDimensions(aspectRatio);
    await run('ffmpeg', [
      '-f', 'concat', '-safe', '0', '-i', concatListPath,
      '-vf', `scale=${width}:${height}`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-movflags', '+faststart',
      outputPath, '-y',
    ]);
  }

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
  const { width, height } = aspectDimensions(aspectRatio);
  const fpsRaw = stream?.r_frame_rate ?? '30/1';
  const [num, den] = fpsRaw.split('/').map(Number);
  const fps = den ? Math.round(num / den) : Math.round(num);

  const outputMeta: ConcatMeta = {
    sizeBytes: stat.size,
    durationSec: Number(probeData.format?.duration ?? 0),
    width: stream?.width ?? width,
    height: stream?.height ?? height,
    fps,
  };

  await onLog(`🎉 Video gộp cuối cùng: ${outputPath}`);
  return { outputPath: 'outputs/final.mp4', outputMeta };
}
