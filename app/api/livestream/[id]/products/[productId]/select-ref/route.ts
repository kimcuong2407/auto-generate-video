import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chọn ảnh tham chiếu cho 1 sản phẩm:
 * - kind='product': chọn 1 ảnh trong kho spokespersonImagePaths làm ref chính (bắt buộc, path != null).
 * - kind='background': chọn 1 ảnh trong kho backgroundImagePaths (tuỳ chọn, path=null để bỏ chọn).
 * Ảnh đã chọn được dùng làm refPaths (r2v) khi gen video — xem lib/livestream/segmentGenerate.ts.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; productId: string } }
) {
  const { id, productId } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { path?: string | null; kind?: string } | null;
  if (!body || (body.kind !== 'product' && body.kind !== 'background')) {
    return NextResponse.json({ error: "kind phải là 'product' hoặc 'background'" }, { status: 400 });
  }
  const { kind } = body;
  const targetPath = body.path ?? null;

  const job = await readJob(id);
  const product = job.products.find((p) => p.id === productId);
  if (!product) {
    return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 });
  }

  // product: bắt buộc chọn 1 ảnh hợp lệ. background: cho phép null (bỏ chọn).
  if (kind === 'product') {
    if (!targetPath || !(product.spokespersonImagePaths ?? []).includes(targetPath)) {
      return NextResponse.json({ error: 'Ảnh không tồn tại trong kho ảnh sản phẩm' }, { status: 400 });
    }
  } else if (targetPath && !(product.backgroundImagePaths ?? []).includes(targetPath)) {
    return NextResponse.json({ error: 'Ảnh không tồn tại trong kho ảnh background' }, { status: 400 });
  }

  const { job: updatedJob, result } = await updateJob(id, (j) => {
    const p = j.products.find((x) => x.id === productId);
    if (!p) return { error: 'Sản phẩm không tồn tại' };
    if (kind === 'product') {
      p.selectedRefImagePath = targetPath;
    } else {
      p.selectedBackgroundImagePath = targetPath;
    }
    return { error: null as string | null };
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ job: updatedJob });
}
