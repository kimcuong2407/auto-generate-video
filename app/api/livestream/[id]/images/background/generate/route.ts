import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { triggerBackgroundImageGeneration } from '@/lib/livestream/backgroundGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Gen ảnh background livestream bằng AI (dựa vào ảnh sản phẩm + ảnh mẫu ở BỘ ẢNH CHUNG cấp job làm
 * reference). Ảnh sinh ra được thêm vào kho backgroundImagePaths của job; người dùng tự chọn làm ref
 * (không bắt buộc). Body JSON `{ prompt?: string; productId?: string }` — prompt override mặc định
 * (BACKGROUND_SYSTEM_PROMPT); productId chỉ dùng để lấy mô tả sản phẩm ghép vào prompt (mặc định
 * sản phẩm đầu tiên của job vì ảnh nay áp chung cả job).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { prompt?: string; productId?: string };

  const job = await readJob(id);
  if (job.products.length === 0) {
    return NextResponse.json({ error: 'Job chưa có sản phẩm nào' }, { status: 400 });
  }
  // productId chỉ để lấy mô tả ghép prompt; mặc định sản phẩm đầu tiên.
  const productId = body.productId || job.products[0].id;

  const result = await triggerBackgroundImageGeneration(id, productId, body.prompt);

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Gen ảnh background thất bại' }, { status: 500 });
  }

  return NextResponse.json({ job: await readJob(id), imagePath: result.imagePath });
}
