import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Đặt danh sách ảnh người dùng tự chọn cho 1 bước gen: `step='script'` (job.scriptRefPaths — ảnh
 * cho vision + chốt sân khấu) hoặc `step='video'` (job.videoRefPaths — ảnh gửi thẳng cho Veo).
 *
 * Mảng rỗng = trả quyền chọn lại cho server (pickVisionRefEntries / thứ tự ưu tiên mặc định của
 * pickRefImagePaths). KHÔNG cho upload ảnh mới ở đây — 2 bước này chỉ dùng ảnh đã có trong job.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { paths?: string[]; step?: string };
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
  const step = body.step === 'video' ? 'video' : 'script';

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
    if (step === 'video') j.videoRefPaths = unique;
    else j.scriptRefPaths = unique;
  });
  return NextResponse.json({ job: updatedJob });
}
