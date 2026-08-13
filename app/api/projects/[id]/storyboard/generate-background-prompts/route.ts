import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject } from '@/lib/data/projectStore';
import { triggerBackgroundPromptGeneration } from '@/lib/data/storyboardPromptGenerate';
import { runWithConcurrency } from '@/lib/concurrency';
import { STORYBOARD_MAX_CONCURRENT } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sinh prompt AI cho mọi ảnh background chưa "generating" (ghi đè prompt hiện có nếu đã có). */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(id);
  const targets = project.storyboard.backgrounds.filter((img) => img.status !== 'generating');

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, done: [] });
  }

  const results = await runWithConcurrency(targets, STORYBOARD_MAX_CONCURRENT, (image) =>
    triggerBackgroundPromptGeneration(id, image.sceneId)
  );

  const done = results.filter((r) => r.ok).map((r) => r.sceneId);
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({ ok: true, done, failed });
}
