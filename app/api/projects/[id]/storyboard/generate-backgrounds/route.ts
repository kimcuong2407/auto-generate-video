import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject } from '@/lib/data/projectStore';
import { triggerBackgroundGeneration } from '@/lib/data/backgroundGenerate';
import { runWithConcurrency } from '@/lib/concurrency';
import { STORYBOARD_MAX_CONCURRENT } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(id);
  const targets = project.storyboard.backgrounds.filter(
    (img) => (img.status === 'idle' || img.status === 'failed') && img.prompt.trim()
  );

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, queued: [] });
  }

  const results = await runWithConcurrency(targets, STORYBOARD_MAX_CONCURRENT, (image) =>
    triggerBackgroundGeneration(id, image.sceneId)
  );

  const queued = results.filter((r) => r.ok).map((r) => r.sceneId);
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({ ok: true, queued, failed });
}
