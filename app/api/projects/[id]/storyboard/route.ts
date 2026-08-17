import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await projectExists(params.id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }
  const project = await readProject(params.id);
  return NextResponse.json({ storyboard: project.storyboard });
}

interface StoryboardImagePayload {
  sceneId: string;
  prompt?: string;
}

/** Cập nhật prompt cho từng ảnh storyboard/background theo sceneId — không cho sửa khi đang generating. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await projectExists(params.id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    images?: StoryboardImagePayload[];
    backgrounds?: StoryboardImagePayload[];
  };
  if (!Array.isArray(body.images) && !Array.isArray(body.backgrounds)) {
    return NextResponse.json({ error: 'Thiếu mảng "images" hoặc "backgrounds"' }, { status: 400 });
  }

  const promptById = new Map((body.images || []).map((img) => [img.sceneId, img.prompt]));
  const backgroundPromptById = new Map((body.backgrounds || []).map((img) => [img.sceneId, img.prompt]));
  const blocked: string[] = [];

  const { project } = await updateProject(params.id, (p) => {
    for (const image of p.storyboard.images) {
      if (!promptById.has(image.sceneId)) continue;
      const prompt = promptById.get(image.sceneId);
      if (prompt === undefined || prompt === image.prompt) continue; // không đổi → bỏ qua im lặng
      if (image.status === 'generating') {
        blocked.push(image.sceneId); // chỉ chặn khi prompt thực sự thay đổi
        continue;
      }
      image.prompt = prompt;
    }
    for (const image of p.storyboard.backgrounds) {
      if (!backgroundPromptById.has(image.sceneId)) continue;
      const prompt = backgroundPromptById.get(image.sceneId);
      if (prompt === undefined || prompt === image.prompt) continue; // không đổi → bỏ qua im lặng
      if (image.status === 'generating') {
        blocked.push(image.sceneId); // chỉ chặn khi prompt thực sự thay đổi
        continue;
      }
      image.prompt = prompt;
    }
  });

  if (blocked.length > 0) {
    return NextResponse.json(
      { warning: `Không thể sửa ảnh đang generating: ${blocked.join(', ')}`, storyboard: project.storyboard },
      { status: 200 }
    );
  }

  return NextResponse.json({ storyboard: project.storyboard });
}
