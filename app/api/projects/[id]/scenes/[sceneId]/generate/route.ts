import { NextRequest, NextResponse } from 'next/server';
import { projectExists } from '@/lib/data/projectStore';
import { triggerSceneGeneration } from '@/lib/data/sceneGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  const { id, sceneId } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const result = await triggerSceneGeneration(id, sceneId);
  if (!result.ok) {
    const status = result.error === 'Scene không tồn tại' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, jobId: result.jobId });
}
