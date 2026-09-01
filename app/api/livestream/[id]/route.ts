import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { jobExists, readJob, updateJob, deleteJob } from '@/lib/livestream/jobStore';
import { jobDir } from '@/lib/livestream/paths';
import { isChaining } from '@/lib/livestream/refImages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await jobExists(params.id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const job = await readJob(params.id);
  return NextResponse.json({ job });
}

/**
 * Cập nhật cài đặt cấp job:
 * - `backgroundModel`: provider gen ảnh background AI.
 * - `chaining`: chế độ auto-gen nối tiếp. 'off' = tắt hẳn (mỗi đoạn phải bấm tay, chạy song song);
 *   'per_product' = tự chạy tiếp trong cùng sản phẩm; 'continuous' = tự chạy xuyên suốt cả job.
 *   Đây là công tắc bật/tắt cascade ở lib/livestream/segmentSync.ts (runChainingForJustDone +
 *   resumeStalledJob) — trước đây chỉ đặt được lúc TẠO job nên không ai tắt/bật lại được.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    backgroundModel?: string;
    chaining?: string;
  };

  if (body.chaining !== undefined && !isChaining(body.chaining)) {
    return NextResponse.json(
      { error: "chaining phải là 'off', 'per_product' hoặc 'continuous'" },
      { status: 400 }
    );
  }

  const { job } = await updateJob(id, (j) => {
    if (body.backgroundModel !== undefined && body.backgroundModel.trim())
      j.backgroundModel = body.backgroundModel.trim();
    if (body.chaining !== undefined && isChaining(body.chaining)) j.chaining = body.chaining;
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
