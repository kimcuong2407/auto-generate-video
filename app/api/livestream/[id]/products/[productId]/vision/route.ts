import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { jobExists, updateJob } from '@/lib/livestream/jobStore';
import { jobInputsDir } from '@/lib/livestream/paths';
import { IMAGE_EXTS } from '@/lib/livestream/ingestEntry';
import { extractProductFromImage } from '@/lib/livestream/productVision';
import { MAX_IMAGE_SIZE_BYTES } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upload 1 ảnh chụp màn hình trang sản phẩm cho 1 sản phẩm đã tồn tại (thường dùng khi
 * ingestStatus='needs_manual' — VD link Shopee bị chặn fetch tự động) — AI vision đọc ảnh
 * để tự điền tên/mô tả, thay vì bắt người dùng gõ tay toàn bộ.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; productId: string } }
) {
  const { id, productId } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get('image');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Thiếu ảnh' }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Ảnh vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB` },
      { status: 400 }
    );
  }
  const ext = path.extname(file.name).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    return NextResponse.json({ error: 'Chỉ nhận file ảnh (jpg/png/webp/gif)' }, { status: 400 });
  }

  const fileName = `${productId}-screenshot-${Date.now()}${ext}`;
  const inputsDir = jobInputsDir(id);
  const absPath = path.join(inputsDir, fileName);
  await fs.writeFile(absPath, Buffer.from(await file.arrayBuffer()));

  let info: { name: string; description: string };
  try {
    info = await extractProductFromImage(absPath);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const { job, result } = await updateJob(id, (j) => {
    const product = j.products.find((p) => p.id === productId);
    if (!product) return { error: 'Sản phẩm không tồn tại' };
    product.name = info.name;
    product.description = info.description;
    product.sourceFilePath = path.join('inputs', fileName);
    product.ingestStatus = 'ready';
    product.ingestError = null;
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job });
}
