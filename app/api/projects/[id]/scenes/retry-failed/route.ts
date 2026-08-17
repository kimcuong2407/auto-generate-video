import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject } from '@/lib/data/projectStore';
import { triggerSceneGeneration } from '@/lib/data/sceneGenerate';
import { runWithConcurrency } from '@/lib/concurrency';
import { FLOW_MAX_CONCURRENT_JOBS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(id);
  const targets = project.script.scenes.filter((s) => s.status === 'failed');

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, queued: [] });
  }

  const results = await runWithConcurrency(targets, FLOW_MAX_CONCURRENT_JOBS, (scene) =>
    triggerSceneGeneration(id, scene.id, { requireFailed: true })
  );

  const queued = results.filter((r) => r.ok).map((r) => r.sceneId);
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({ ok: true, queued, failed });
}
