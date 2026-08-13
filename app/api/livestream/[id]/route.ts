import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { jobDir } from '@/lib/livestream/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!jobExists(params.id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const job = await readJob(params.id);
  return NextResponse.json({ job });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const generatingSegments = job.products.flatMap((p) =>
    p.segments.filter((s) => s.status === 'generating')
  );
  if (generatingSegments.length > 0) {
    return NextResponse.json(
      { error: `Không thể xoá job khi còn đoạn đang generating: ${generatingSegments.map((s) => s.id).join(', ')}` },
      { status: 409 }
    );
  }

  await fs.rm(jobDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
