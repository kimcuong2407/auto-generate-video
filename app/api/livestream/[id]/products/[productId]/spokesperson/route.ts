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
 * Upload/thêm ảnh tham chiếu cho 1 sản phẩm trong job livestream — dùng làm refPaths
 * (character reference) khi gen video đoạn không có startPath từ frame-chaining, xem
 * lib/livestream/segmentGenerate.ts. Hỗ trợ nhiều ảnh: mỗi lần POST sẽ APPEND thêm (không ghi đè).
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
    return NextResponse.json({ error: 'Thiếu ảnh tham chiếu' }, { status: 400 });
  }

  // Đặt tên duy nhất theo thời điểm + index để không đè ảnh đã có (append). Date.now() an toàn ở
  // runtime server thường (chỉ bị chặn trong workflow script).
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
    const fileName = `${productId}-spokesperson-${stamp}-${k}${ext}`;
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
    if (!Array.isArray(p.spokespersonImagePaths)) p.spokespersonImagePaths = [];
    p.spokespersonImagePaths.push(...newRelPaths);
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job: updatedJob, warnings });
}

/**
 * Xoá ảnh tham chiếu. Truyền query ?path=inputs/xxx.jpg để xoá đúng 1 ảnh; không truyền path thì
 * xoá toàn bộ ảnh tham chiếu của sản phẩm.
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
  const current = product.spokespersonImagePaths ?? [];

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
      p.spokespersonImagePaths = (p.spokespersonImagePaths ?? []).filter((rel) => rel !== targetPath);
    } else {
      p.spokespersonImagePaths = [];
    }
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job: updatedJob });
}
