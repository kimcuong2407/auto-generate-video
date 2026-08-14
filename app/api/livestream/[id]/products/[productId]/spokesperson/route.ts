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
 * Upload/thay ảnh người mẫu tham chiếu cho 1 sản phẩm trong job livestream — dùng làm refPaths
 * (character reference) khi gen video đoạn không có startPath từ frame-chaining, xem
 * lib/livestream/segmentGenerate.ts.
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
  const file = form.get('image');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Thiếu ảnh người mẫu' }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Ảnh vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB` },
      { status: 400 }
    );
  }
  const ext = path.extname(file.name).toLowerCase() || '.jpg';
  if (!IMAGE_EXTS.has(ext)) {
    return NextResponse.json({ error: 'Chỉ nhận file ảnh (jpg/png/webp/gif)' }, { status: 400 });
  }

  if (product.spokespersonImagePath) {
    await unlinkIfExists(resolveWithinJob(id, product.spokespersonImagePath));
  }

  const fileName = `${productId}-spokesperson${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(jobInputsDir(id), fileName), buffer);
  const relPath = path.join('inputs', fileName);

  const { job: updatedJob, result } = await updateJob(id, (j) => {
    const p = j.products.find((x) => x.id === productId);
    if (!p) return { error: 'Sản phẩm không tồn tại' };
    p.spokespersonImagePath = relPath;
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job: updatedJob });
}

export async function DELETE(
  _req: NextRequest,
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

  if (product.spokespersonImagePath) {
    await unlinkIfExists(resolveWithinJob(id, product.spokespersonImagePath));
  }

  const { job: updatedJob, result } = await updateJob(id, (j) => {
    const p = j.products.find((x) => x.id === productId);
    if (!p) return { error: 'Sản phẩm không tồn tại' };
    p.spokespersonImagePath = null;
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job: updatedJob });
}
