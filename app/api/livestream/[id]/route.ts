import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { jobExists, readJob, updateJob, deleteJob } from '@/lib/livestream/jobStore';
import { jobDir } from '@/lib/livestream/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await jobExists(params.id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const job = await readJob(params.id);
  return NextResponse.json({ job });
}

/** Cập nhật cài đặt cấp job — hiện chỉ có `backgroundModel` (provider gen ảnh background AI). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { backgroundModel?: string };

  const { job } = await updateJob(id, (j) => {
    if (body.backgroundModel !== undefined && body.backgroundModel.trim())
      j.backgroundModel = body.backgroundModel.trim();
  });

  return NextResponse.json({ job });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
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

  // Xóa metadata trong DB (job + products + segments) rồi mới xóa thư mục media.
  await deleteJob(id);
  await fs.rm(jobDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
