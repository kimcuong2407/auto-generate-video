import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { resolveWithinJob } from '@/lib/livestream/paths';
import { runLivestreamConcat } from '@/lib/livestream/concat';
import { uploadFileToR2, deleteFromR2, md5File, keyFromPublicUrl } from '@/lib/r2/client';
import type { LivestreamJob } from '@/lib/livestream/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await jobExists(params.id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const job = await readJob(params.id);
  return NextResponse.json({ concat: job.concat });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  if (job.concat.status === 'running') {
    return NextResponse.json({ error: 'Đang ghép video, vui lòng chờ' }, { status: 409 });
  }

  // Cho phép ghép ngay cả khi còn đoạn chưa gen xong — chỉ bỏ qua các đoạn đó, vẫn ghép các
  // đoạn đã có video theo đúng thứ tự (xử lý thật trong runLivestreamConcat).
  const missing: string[] = [];
  let hasAnyReady = false;
  for (const product of job.products) {
    for (const segment of product.segments) {
      if (segment.status !== 'done') {
        missing.push(segment.id);
        continue;
      }
      if (segment.videoPath) {
        try {
          await fs.access(resolveWithinJob(id, segment.videoPath));
          hasAnyReady = true;
          continue;
        } catch {
          // mất local → còn videoUrl thì runLivestreamConcat sẽ tải lại từ R2
        }
      }
      if (segment.videoUrl) {
        hasAnyReady = true;
      } else {
        missing.push(segment.id);
      }
    }
  }
  if (!hasAnyReady) {
    return NextResponse.json({ error: 'missing_segments', segments: missing }, { status: 400 });
  }

  await updateJob(id, (j) => {
    j.status = 'concatenating';
    j.concat = {
      status: 'running',
      log: [],
      outputPath: null,
      outputUrl: null,
      outputMeta: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
  });

  // Fire-and-forget: chạy ffmpeg trong background, không chặn response HTTP
  runConcatInBackground(id).catch(() => {
    // lỗi đã được xử lý và ghi vào job.json bên trong runConcatInBackground
  });

  return NextResponse.json({ ok: true, started: true });
}

async function runConcatInBackground(id: string): Promise<void> {
  const job: LivestreamJob = await readJob(id);

  const appendLog = async (line: string) => {
    await updateJob(id, (j) => {
      j.concat.log.push(line);
    });
  };

  try {
    const { outputMeta, mergedSegmentPaths } = await runLivestreamConcat(job, appendLog);

    // Upload final lên R2 để xem/tải online không phụ thuộc route stream local. No-op nếu R2
    // chưa cấu hình (outputUrl = null → UI fallback về route media local).
    const finalAbsPath = resolveWithinJob(id, 'outputs/final.mp4');
    // Key R2 mang hash nội dung: ghép lại ra video khác là key mới, CDN không có gì để trả
    // bản cũ (cùng lý do với segment — xem segmentVideoFileName).
    const finalKey = `livestream/${id}/final.${(await md5File(finalAbsPath)).slice(0, 8)}.mp4`;
    const previousUrl = job.concat.outputUrl;
    const outputUrl = await uploadFileToR2(finalAbsPath, finalKey, 'video/mp4');
    // Dọn bản final cũ trên R2 (key khác nên không bị ghi đè). Local vẫn là outputs/final.mp4
    // duy nhất, ffmpeg đã ghi đè tại chỗ.
    const previousKey = keyFromPublicUrl(previousUrl);
    if (previousKey && previousKey !== finalKey) await deleteFromR2(previousKey);
    if (outputUrl) {
      await appendLog(`☁️ Đã upload final lên R2: ${outputUrl}`);
    }

    // Xoá các file segment local sau khi concat xong (đã có videoUrl trên R2 để preview) —
    // deploy Ubuntu không giữ segment local lâu dài. Best-effort, nuốt lỗi từng file. Giữ
    // videoUrl trên segment; chỉ set videoPath = null để UI biết chuyển sang dùng R2.
    for (const relPath of mergedSegmentPaths) {
      try {
        await fs.rm(resolveWithinJob(id, relPath), { force: true });
      } catch {
        // bỏ qua — file có thể đã bị xoá, không chặn flow
      }
    }

    await updateJob(id, (j) => {
      j.concat.status = 'done';
      j.concat.outputPath = 'outputs/final.mp4';
      j.concat.outputUrl = outputUrl;
      j.concat.outputMeta = outputMeta;
      j.concat.finishedAt = new Date().toISOString();
      j.status = 'done';
      // Segment local đã xoá — bỏ videoPath để UI dùng videoUrl (R2). Chỉ đụng đoạn thực sự
      // vừa được ghép (còn videoUrl), tránh xoá path của đoạn chưa upload R2 thành công.
      const merged = new Set(mergedSegmentPaths);
      for (const p of j.products) {
        for (const s of p.segments) {
          if (s.videoPath && merged.has(s.videoPath) && s.videoUrl) {
            s.videoPath = null;
          }
        }
      }
    });
  } catch (err) {
    const message = (err as Error).message;
    await updateJob(id, (j) => {
      j.concat.status = 'failed';
      j.concat.error = message.slice(-500);
      j.concat.finishedAt = new Date().toISOString();
      j.concat.log.push(`✗ Lỗi: ${message.slice(-500)}`);
      j.status = 'failed';
    });
  }
}
