import { NextRequest, NextResponse } from 'next/server';
import { jobExists } from '@/lib/livestream/jobStore';
import { stopSegmentGeneration } from '@/lib/livestream/segmentGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; segmentId: string } }
) {
  const { id, segmentId } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const result = await stopSegmentGeneration(id, segmentId);
  if (!result.ok) {
    const status = result.error === 'Đoạn không tồn tại' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
