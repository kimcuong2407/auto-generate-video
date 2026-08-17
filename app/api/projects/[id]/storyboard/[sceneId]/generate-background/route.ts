import { NextRequest, NextResponse } from 'next/server';
import { projectExists } from '@/lib/data/projectStore';
import { triggerBackgroundGeneration } from '@/lib/data/backgroundGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  const { id, sceneId } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const result = await triggerBackgroundGeneration(id, sceneId);
  if (!result.ok) {
    const status = result.error === 'Scene background không tồn tại' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, imagePath: result.imagePath });
}
