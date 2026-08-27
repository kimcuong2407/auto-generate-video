import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * TOGGLE "tách 1 ảnh khỏi bước gen video" (job.detachedImagePaths).
 *
 * Ảnh bị tách vẫn được AI vision đọc để mô tả vào prompt/stage bible, nhưng KHÔNG còn đính kèm
 * làm reference image khi gọi Veo — xem pickRefImagePaths() ở lib/livestream/refImages.ts.
 *
 * Nhận relPath của BẤT KỲ ảnh nào trong 2 kho của job (ảnh sản phẩm/ảnh mẫu dùng chung kho
 * spokespersonImagePaths, ảnh nền ở backgroundImagePaths). Validate để không nhét được path lạ vào
 * job rồi nằm đó vĩnh viễn sau khi ảnh bị xoá.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { path?: string } | null;
  const targetPath = body?.path;
  if (!targetPath) {
    return NextResponse.json({ error: 'Thiếu path' }, { status: 400 });
  }

  const job = await readJob(id);
  const known =
    (job.spokespersonImagePaths ?? []).includes(targetPath) ||
    (job.backgroundImagePaths ?? []).includes(targetPath) ||
    job.selectedModelImagePath === targetPath;
  if (!known) {
    return NextResponse.json({ error: 'Ảnh không thuộc job này' }, { status: 400 });
  }

  const { job: updatedJob } = await updateJob(id, (j) => {
    const current = j.detachedImagePaths ?? [];
    j.detachedImagePaths = current.includes(targetPath)
      ? current.filter((p) => p !== targetPath)
      : [...current, targetPath];
  });

  return NextResponse.json({ job: updatedJob });
}
