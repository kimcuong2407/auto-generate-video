import { NextRequest, NextResponse } from 'next/server';
import { projectExists } from '@/lib/data/projectStore';
import { stopAllSceneGeneration } from '@/lib/data/sceneGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const stopped = await stopAllSceneGeneration(id);
  return NextResponse.json({ ok: true, stopped });
}
