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
 * Upload/thêm ảnh background (bối cảnh) vào KHO ẢNH CHUNG cấp job — người dùng chọn 1 ảnh trong kho
 * này qua route images/select-ref (kind='background'), dùng kèm ảnh sản phẩm làm refPaths (r2v) khi
 * gen video. Mỗi lần POST sẽ APPEND thêm (không ghi đè).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const form = await req.formData();
  const files = form.getAll('image').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'Thiếu ảnh background' }, { status: 400 });
  }

  const stamp = Date.now();
  const newRelPaths: string[] = [];
  const warnings: string[] = [];
  let k = 0;
  for (const file of files) {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      warnings.push(`Ảnh "${file.name}" vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB — đã bỏ qua`);
      continue;
    }
    const ext = path.extname(file.name).toLowerCase() || '.jpg';
    if (!IMAGE_EXTS.has(ext)) {
      warnings.push(`"${file.name}" không phải ảnh (jpg/png/webp/gif) — đã bỏ qua`);
      continue;
    }
    const fileName = `bg-${stamp}-${k}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(jobInputsDir(id), fileName), buffer);
    newRelPaths.push(path.join('inputs', fileName));
    k += 1;
  }

  if (newRelPaths.length === 0) {
    return NextResponse.json({ error: warnings[0] || 'Không có ảnh hợp lệ' }, { status: 400 });
  }

  // Đẩy từng ảnh background mới lên R2 (best-effort); lưu URL theo relPath.
  const r2Urls: Record<string, string | null> = {};
  for (const rel of newRelPaths) {
    r2Urls[rel] = await uploadImageToR2(id, rel);
  }

  const { job: updatedJob } = await updateJob(id, (j) => {
    if (!Array.isArray(j.backgroundImagePaths)) j.backgroundImagePaths = [];
    j.backgroundImagePaths.push(...newRelPaths);
    if (!j.imageR2Urls) j.imageR2Urls = {};
    Object.assign(j.imageR2Urls, r2Urls);
  });

  return NextResponse.json({ job: updatedJob, warnings });
}

/**
 * Xoá ảnh background khỏi kho chung. Truyền query ?path=inputs/xxx.jpg để xoá đúng 1 ảnh; không
 * truyền path thì xoá toàn bộ. Nếu ảnh bị xoá đang được chọn (selectedBackgroundImagePath) thì clear.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const targetPath = new URL(req.url).searchParams.get('path');
  const current = job.backgroundImagePaths ?? [];

  const removedPaths = targetPath ? [targetPath] : current;

  if (targetPath && !current.includes(targetPath)) {
    return NextResponse.json({ error: 'Ảnh không tồn tại trong kho' }, { status: 404 });
  }
  for (const rel of removedPaths) {
    await unlinkIfExists(resolveWithinJob(id, rel));
    await deleteImageFromR2(id, rel);
  }

  const { job: updatedJob } = await updateJob(id, (j) => {
    if (targetPath) {
      j.backgroundImagePaths = (j.backgroundImagePaths ?? []).filter((rel) => rel !== targetPath);
      if (j.selectedBackgroundImagePath === targetPath) j.selectedBackgroundImagePath = null;
    } else {
      j.backgroundImagePaths = [];
      j.selectedBackgroundImagePath = null;
    }
    if (j.imageR2Urls) for (const rel of removedPaths) delete j.imageR2Urls[rel];
  });

  return NextResponse.json({ job: updatedJob });
}
