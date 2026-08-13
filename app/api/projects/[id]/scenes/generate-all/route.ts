import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject } from '@/lib/data/projectStore';
import { triggerSceneGeneration } from '@/lib/mcp/sceneGenerate';
import { runWithConcurrency } from '@/lib/concurrency';
import { FLOW_MAX_CONCURRENT_JOBS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(id);
  let targets = project.script.scenes.filter((s) => s.status === 'idle' || s.status === 'failed');

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, queued: [] });
  }

  // Khi bật chain khung hình: chỉ trigger scene đầu mỗi chuỗi cảnh dở dang (order === 1, hoặc
  // scene liền trước đã done) — các cảnh idle/failed còn lại sẽ tự cascade qua poll status
  // sau khi scene liền trước xong, để đảm bảo luôn dùng đúng khung hình cuối làm start_path.
  const concurrency = project.sceneChaining ? 1 : FLOW_MAX_CONCURRENT_JOBS;
  if (project.sceneChaining) {
    const byOrder = new Map(project.script.scenes.map((s) => [s.order, s]));
    targets = targets.filter((s) => {
      const prev = byOrder.get(s.order - 1);
      return s.order === 1 || prev?.status === 'done';
    });
  }

  const results = await runWithConcurrency(targets, concurrency, (scene) =>
    triggerSceneGeneration(id, scene.id)
  );

  const queued = results.filter((r) => r.ok).map((r) => r.sceneId);
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({ ok: true, queued, failed });
}
