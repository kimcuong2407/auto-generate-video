import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Đặt danh sách ảnh gửi cho AI ở bước SINH SCRIPT (job.scriptRefPaths).
 *
 * Mảng rỗng = trả quyền chọn lại cho server (pickVisionRefEntries). Khác background-refs: KHÔNG
 * cho upload ảnh mới ở đây — bước script chỉ suy luận từ ảnh đã có trong job, thêm ảnh lạ vào
 * lượt chốt sân khấu là mở đường cho bible tả một buổi live không liên quan gì tới hàng đang bán.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { paths?: string[] };
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];

  const job = await readJob(id);
  const known = new Set<string>([
    ...(job.spokespersonImagePaths ?? []),
    ...(job.backgroundImagePaths ?? []),
    ...(job.selectedModelImagePath ? [job.selectedModelImagePath] : []),
  ]);
  const invalid = paths.filter((p) => !known.has(p));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Ảnh không thuộc job này: ${invalid.join(', ')}` },
      { status: 400 }
    );
  }

  // Bỏ trùng, giữ thứ tự tick — thứ tự là thứ AI nhận, ảnh mẫu nên đứng đầu.
  const unique = [...new Set(paths)];
  const { job: updatedJob } = await updateJob(id, (j) => {
    j.scriptRefPaths = unique;
  });
  return NextResponse.json({ job: updatedJob });
}
