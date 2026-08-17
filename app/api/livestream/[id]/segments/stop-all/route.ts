import { NextRequest, NextResponse } from 'next/server';
import { jobExists } from '@/lib/livestream/jobStore';
import { stopAllSegmentGeneration } from '@/lib/livestream/segmentGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const stopped = await stopAllSegmentGeneration(id);
  return NextResponse.json({ ok: true, stopped });
}
