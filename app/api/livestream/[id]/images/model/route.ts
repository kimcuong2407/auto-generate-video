import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { jobInputsDir, resolveWithinJob } from '@/lib/livestream/paths';
import { IMAGE_EXTS } from '@/lib/livestream/ingestEntry';
import { uploadImageToR2, deleteImageFromR2 } from '@/lib/livestream/imageR2';
import { MAX_IMAGE_SIZE_BYTES } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function unlinkIfExists(absPath: string) {
  try {
    await fs.unlink(absPath);
  } catch {
    // Không tồn tại thì bỏ qua
  }
}

/**
 * Upload/thay ảnh MẪU (người dẫn) CHUNG cả job — chỉ 1 ảnh duy nhất (không phải kho). Ảnh này áp
 * cho MỌI segment của MỌI sản phẩm, truyền kèm ảnh sản phẩm + background làm refPaths (r2v) khi gen
 * video (xem lib/livestream/segmentGenerate.ts). POST sẽ GHI ĐÈ ảnh mẫu cũ (xoá file cũ nếu có).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);

  const form = await req.formData();
  const file = form.get('image');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Thiếu ảnh mẫu' }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Ảnh "${file.name}" vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB` },
      { status: 400 }
    );
  }
  const ext = path.extname(file.name).toLowerCase() || '.jpg';
  if (!IMAGE_EXTS.has(ext)) {
    return NextResponse.json(
      { error: `"${file.name}" không phải ảnh (jpg/png/webp/gif)` },
      { status: 400 }
    );
  }

  // Xoá ảnh mẫu cũ (local + R2) trước khi ghi ảnh mới (job chỉ giữ 1 ảnh mẫu).
  const oldModelPath = job.selectedModelImagePath;
  if (oldModelPath) {
    await unlinkIfExists(resolveWithinJob(id, oldModelPath));
    await deleteImageFromR2(id, oldModelPath);
  }

  const fileName = `model-${Date.now()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(jobInputsDir(id), fileName), buffer);
  const relPath = path.join('inputs', fileName);

  // Đẩy ảnh mẫu mới lên R2 (best-effort), lưu URL theo relPath.
  const r2Url = await uploadImageToR2(id, relPath);

  const { job: updatedJob } = await updateJob(id, (j) => {
    j.selectedModelImagePath = relPath;
    if (!j.imageR2Urls) j.imageR2Urls = {};
    if (oldModelPath) delete j.imageR2Urls[oldModelPath];
    j.imageR2Urls[relPath] = r2Url;
  });

  return NextResponse.json({ job: updatedJob });
}

/** Xoá ảnh mẫu hiện tại của job (nếu có) và clear selectedModelImagePath. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const oldModelPath = job.selectedModelImagePath;
  if (oldModelPath) {
    await unlinkIfExists(resolveWithinJob(id, oldModelPath));
    await deleteImageFromR2(id, oldModelPath);
  }

  const { job: updatedJob } = await updateJob(id, (j) => {
    j.selectedModelImagePath = null;
    if (j.imageR2Urls && oldModelPath) delete j.imageR2Urls[oldModelPath];
  });

  return NextResponse.json({ job: updatedJob });
}
