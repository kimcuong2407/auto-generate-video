import { NextRequest, NextResponse } from 'next/server';
import { jobExists } from '@/lib/livestream/jobStore';
import { syncSegmentManually } from '@/lib/livestream/segmentSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; segmentId: string } }
) {
  const { id, segmentId } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const result = await syncSegmentManually(id, segmentId);
  if (!result.ok) {
    const status = result.error === 'Đoạn không tồn tại' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
