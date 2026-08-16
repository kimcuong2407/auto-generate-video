import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { jobInputsDir, resolveWithinJob } from '@/lib/livestream/paths';
import { IMAGE_EXTS } from '@/lib/livestream/ingestEntry';
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
 * Upload/thêm ảnh background (bối cảnh) cho 1 sản phẩm — người dùng chọn 1 ảnh trong kho này qua
 * route select-ref (kind='background'), dùng kèm ảnh sản phẩm làm refPaths (r2v) khi gen video.
 * Mỗi lần POST sẽ APPEND thêm (không ghi đè).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; productId: string } }
) {
  const { id, productId } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const product = job.products.find((p) => p.id === productId);
  if (!product) {
    return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 });
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
    const fileName = `${productId}-bg-${stamp}-${k}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(jobInputsDir(id), fileName), buffer);
    newRelPaths.push(path.join('inputs', fileName));
    k += 1;
  }

  if (newRelPaths.length === 0) {
    return NextResponse.json({ error: warnings[0] || 'Không có ảnh hợp lệ' }, { status: 400 });
  }

  const { job: updatedJob, result } = await updateJob(id, (j) => {
    const p = j.products.find((x) => x.id === productId);
    if (!p) return { error: 'Sản phẩm không tồn tại' };
    if (!Array.isArray(p.backgroundImagePaths)) p.backgroundImagePaths = [];
    p.backgroundImagePaths.push(...newRelPaths);
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job: updatedJob, warnings });
}

/**
 * Xoá ảnh background. Truyền query ?path=inputs/xxx.jpg để xoá đúng 1 ảnh; không truyền path thì
 * xoá toàn bộ. Nếu ảnh bị xoá đang được chọn (selectedBackgroundImagePath) thì clear lựa chọn.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; productId: string } }
) {
  const { id, productId } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const product = job.products.find((p) => p.id === productId);
  if (!product) {
    return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 });
  }

  const targetPath = new URL(req.url).searchParams.get('path');
  const current = product.backgroundImagePaths ?? [];

  if (targetPath) {
    if (!current.includes(targetPath)) {
      return NextResponse.json({ error: 'Ảnh không tồn tại trong sản phẩm' }, { status: 404 });
    }
    await unlinkIfExists(resolveWithinJob(id, targetPath));
  } else {
    for (const rel of current) {
      await unlinkIfExists(resolveWithinJob(id, rel));
    }
  }

  const { job: updatedJob, result } = await updateJob(id, (j) => {
    const p = j.products.find((x) => x.id === productId);
    if (!p) return { error: 'Sản phẩm không tồn tại' };
    if (targetPath) {
      p.backgroundImagePaths = (p.backgroundImagePaths ?? []).filter((rel) => rel !== targetPath);
      if (p.selectedBackgroundImagePath === targetPath) p.selectedBackgroundImagePath = null;
    } else {
      p.backgroundImagePaths = [];
      p.selectedBackgroundImagePath = null;
    }
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job: updatedJob });
}
