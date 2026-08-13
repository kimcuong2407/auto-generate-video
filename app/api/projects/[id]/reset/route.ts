import { NextRequest, NextResponse } from 'next/server';
import { projectExists, updateProject } from '@/lib/data/projectStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };

  const { project, result } = await updateProject(id, (p) => {
    const generating = [
      ...p.script.scenes.filter((s) => s.status === 'generating').map((s) => s.id),
      ...p.storyboard.images.filter((img) => img.status === 'generating').map((img) => img.sceneId),
    ];
    if (generating.length > 0 && !body.force) {
      return { blocked: true, generating };
    }

    p.currentStep = 1;
    for (const scene of p.script.scenes) {
      scene.status = 'idle';
      scene.jobId = null;
      scene.error = null;
      scene.lastUpdatedAt = null;
      scene.lastFramePath = null;
      scene.chainedFromPrevious = false;
      // Giữ nguyên videoPath/attempts — không xoá file đã gen, chỉ reset con trỏ trạng thái
    }
    for (const image of p.storyboard.images) {
      image.status = 'idle';
      image.error = null;
      image.lastUpdatedAt = null;
      // Giữ nguyên imagePath/attempts — không xoá file ảnh đã gen, chỉ reset con trỏ trạng thái
    }
    p.concat = {
      status: 'idle',
      log: [],
      outputPath: null,
      outputMeta: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    return { blocked: false, generating: [] as string[] };
  });

  if (result.blocked) {
    return NextResponse.json(
      {
        error: `Có scene đang generating (${result.generating.join(', ')}) — job Flow có thể vẫn chạy phía server dù reset. Gọi lại với { force: true } nếu vẫn muốn reset.`,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ project });
}
