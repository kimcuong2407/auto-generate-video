import { NextRequest, NextResponse } from 'next/server';
import { jobExists, updateJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cập nhật thủ công 1 sản phẩm — dùng làm fallback khi ingest tự động thất bại
 * (ingestStatus='needs_manual', VD link bị chặn scraping hoặc file là ảnh chưa đọc được),
 * hoặc chỉ để chỉnh tên/thời lượng trước khi sinh script.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; productId: string } }
) {
  const { id, productId } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    targetDurationSec?: number;
  };

  const { job, result } = await updateJob(id, (j) => {
    const product = j.products.find((p) => p.id === productId);
    if (!product) {
      return { error: 'Sản phẩm không tồn tại' };
    }
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name) product.name = name;
    }
    if (body.description !== undefined) {
      product.description = body.description.trim();
      if (product.description) {
        product.ingestStatus = 'ready';
        product.ingestError = null;
      }
    }
    if (body.targetDurationSec !== undefined) {
      const n = Math.round(Number(body.targetDurationSec));
      if (Number.isFinite(n) && n > 0) product.targetDurationSec = n;
    }
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job });
}
