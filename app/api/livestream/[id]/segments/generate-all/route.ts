import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { findPreviousSegment, triggerSegmentGeneration } from '@/lib/livestream/segmentGenerate';
import { runWithConcurrency } from '@/lib/concurrency';
import { FLOW_MAX_CONCURRENT_JOBS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const allSegments = job.products.flatMap((product) =>
    product.segments.map((segment) => ({ product, segment }))
  );
  let targets = allSegments.filter(
    ({ segment }) => segment.status === 'idle' || segment.status === 'failed'
  );

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, queued: [] });
  }

  // Khi có chaining: chỉ trigger đoạn đầu mỗi chuỗi dở dang (đoạn liền trước theo chế độ
  // chaining đã done, hoặc không có đoạn liền trước) — các đoạn còn lại tự cascade qua poll
  // status sau khi đoạn liền trước xong, đảm bảo luôn dùng đúng khung hình cuối làm start_path.
  const concurrency = job.chaining === 'off' ? FLOW_MAX_CONCURRENT_JOBS : 1;
  if (job.chaining !== 'off') {
    targets = targets.filter(({ product, segment }) => {
      const prev = findPreviousSegment(job, product, segment);
      return !prev || prev.status === 'done';
    });
  }

  const results = await runWithConcurrency(targets, concurrency, ({ segment }) =>
    triggerSegmentGeneration(id, segment.id)
  );

  const queued = results.filter((r) => r.ok).map((r) => r.segmentId);
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({ ok: true, queued, failed });
}
