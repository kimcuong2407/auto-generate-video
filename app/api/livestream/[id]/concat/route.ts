import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { resolveWithinJob } from '@/lib/livestream/paths';
import { runLivestreamConcat } from '@/lib/livestream/concat';
import type { LivestreamJob } from '@/lib/livestream/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!jobExists(params.id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const job = await readJob(params.id);
  return NextResponse.json({ concat: job.concat });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
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
      if (segment.status !== 'done' || !segment.videoPath) {
        missing.push(segment.id);
        continue;
      }
      try {
        await fs.access(resolveWithinJob(id, segment.videoPath));
        hasAnyReady = true;
      } catch {
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
    const { outputMeta } = await runLivestreamConcat(job, appendLog);
    await updateJob(id, (j) => {
      j.concat.status = 'done';
      j.concat.outputPath = 'outputs/final.mp4';
      j.concat.outputMeta = outputMeta;
      j.concat.finishedAt = new Date().toISOString();
      j.status = 'done';
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
