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

/** Ảnh upload riêng cho bước gen background nằm ở inputs/bgref-* — tách tiền tố để nhận diện. */
const BG_REF_PREFIX = 'bgref-';

/**
 * Đặt danh sách ảnh gửi kèm khi GEN BACKGROUND (job.backgroundRefPaths).
 *
 * Mảng rỗng = trả quyền chọn lại cho server (pickVisionRefEntries). Mỗi path phải là ảnh đã có
 * trong job — chặn path lạ để không gửi file ngoài job cho AI.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { paths?: string[] };
  const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];

  const job = await readJob(id);
  // Ảnh hợp lệ = mọi ảnh job đang có (kho sản phẩm + ảnh mẫu + kho background + ảnh bgref-* đã
  // upload cho chính bước này).
  const known = new Set<string>([
    ...(job.spokespersonImagePaths ?? []),
    ...(job.backgroundImagePaths ?? []),
    ...(job.backgroundRefPaths ?? []),
    ...(job.selectedModelImagePath ? [job.selectedModelImagePath] : []),
  ]);
  const invalid = paths.filter((p) => !known.has(p));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Ảnh không thuộc job này: ${invalid.join(', ')}` },
      { status: 400 }
    );
  }

  // Bỏ trùng, giữ nguyên thứ tự người dùng chọn — thứ tự là thứ AI nhận, ảnh mẫu nên đứng đầu.
  const unique = [...new Set(paths)];
  const { job: updatedJob } = await updateJob(id, (j) => {
    j.backgroundRefPaths = unique;
  });
  return NextResponse.json({ job: updatedJob });
}

/**
 * Upload ảnh tham chiếu DÙNG RIÊNG cho bước gen background (VD ảnh phòng live mẫu).
 *
 * Khác route images/background: ảnh ở đó là KHO BỐI CẢNH để chọn 1 ảnh làm nền khi gen video; ảnh
 * ở đây chỉ là tài liệu tham chiếu cho AI lúc dựng khung hình, không vào kho đó và không bao giờ
 * được gửi cho Veo. Upload xong tự thêm vào backgroundRefPaths.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const form = await req.formData();
  const files = form.getAll('image').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'Thiếu ảnh tham chiếu' }, { status: 400 });
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
    const fileName = `${BG_REF_PREFIX}${stamp}-${k}${ext}`;
    await fs.writeFile(path.join(jobInputsDir(id), fileName), Buffer.from(await file.arrayBuffer()));
    newRelPaths.push(path.join('inputs', fileName));
    k += 1;
  }

  if (newRelPaths.length === 0) {
    return NextResponse.json({ error: warnings[0] || 'Không có ảnh hợp lệ' }, { status: 400 });
  }

  const r2Urls: Record<string, string | null> = {};
  for (const rel of newRelPaths) {
    r2Urls[rel] = await uploadImageToR2(id, rel);
  }

  const { job: updatedJob } = await updateJob(id, (j) => {
    if (!Array.isArray(j.backgroundRefPaths)) j.backgroundRefPaths = [];
    j.backgroundRefPaths.push(...newRelPaths);
    if (!j.imageR2Urls) j.imageR2Urls = {};
    Object.assign(j.imageR2Urls, r2Urls);
  });

  return NextResponse.json({ job: updatedJob, warnings });
}

/**
 * Xoá 1 ảnh bgref-* đã upload (?path=inputs/bgref-xxx.jpg). Chỉ xoá được ảnh upload riêng cho bước
 * này — ảnh thuộc kho sản phẩm/background phải xoá ở đúng khu của nó để không mất ảnh đang dùng
 * cho gen video.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const targetPath = new URL(req.url).searchParams.get('path');
  if (!targetPath) {
    return NextResponse.json({ error: 'Thiếu ?path' }, { status: 400 });
  }
  if (!path.basename(targetPath).startsWith(BG_REF_PREFIX)) {
    return NextResponse.json(
      { error: 'Chỉ xoá được ảnh tải lên riêng cho bước gen background' },
      { status: 400 }
    );
  }

  try {
    await fs.unlink(resolveWithinJob(id, targetPath));
  } catch {
    // file đã mất — vẫn dọn tiếp bản ghi.
  }
  await deleteImageFromR2(id, targetPath);

  const { job: updatedJob } = await updateJob(id, (j) => {
    j.backgroundRefPaths = (j.backgroundRefPaths ?? []).filter((rel) => rel !== targetPath);
    if (j.imageR2Urls) delete j.imageR2Urls[targetPath];
  });
  return NextResponse.json({ job: updatedJob });
}
