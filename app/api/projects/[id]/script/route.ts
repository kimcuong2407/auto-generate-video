import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import { buildSceneFromFields, mergeStoryboardWithScript, mergeBackgroundsWithScript } from '@/lib/data/projectFactory';
import { slugify } from '@/lib/paths';
import type { Scene } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await projectExists(params.id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }
  const project = await readProject(params.id);
  return NextResponse.json({ script: project.script });
}

interface ScenePayload {
  id: string;
  label?: string;
  duration?: number;
  camera?: string;
  type?: string;
  voiceoverVi?: string;
  onScreenText?: string;
  veoPrompt?: string;
  negativePrompt?: string;
}

/**
 * Nhận toàn bộ mảng scenes mong muốn (đúng thứ tự hiển thị) — hỗ trợ thêm/xoá/kéo-thả
 * sắp xếp lại cảnh, không chỉ sửa nội dung cảnh có sẵn như trước. Scene id nào không có
 * trong mảng gửi lên coi như bị xoá; id lạ coi như cảnh mới.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await projectExists(params.id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const body = (await req.json()) as { scenes: ScenePayload[] };
  if (!Array.isArray(body.scenes)) {
    return NextResponse.json({ error: 'Thiếu mảng "scenes"' }, { status: 400 });
  }
  if (body.scenes.length === 0) {
    return NextResponse.json({ error: 'Danh sách scenes rỗng' }, { status: 400 });
  }

  // Sanitize id trước (không tin id thô từ client), đảm bảo duy nhất trong mảng gửi lên.
  const usedIds = new Set<string>();
  const incoming = body.scenes.map((raw, index) => {
    let id = slugify(raw.id || raw.label || `scene-${index + 1}`);
    if (!id) id = `scene-${index + 1}`;
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);
    return { ...raw, id };
  });
  const incomingIds = new Set(incoming.map((s) => s.id));

  const { project, result } = await updateProject(params.id, (project) => {
    const existingById = new Map(project.script.scenes.map((s) => [s.id, s]));

    const removedGenerating = project.script.scenes.filter(
      (s) => !incomingIds.has(s.id) && s.status === 'generating'
    );
    if (removedGenerating.length > 0) {
      return {
        conflict: true,
        conflictMessage: `Không thể xoá cảnh đang generating: ${removedGenerating
          .map((s) => s.id)
          .join(', ')}. Vui lòng đợi hoặc thử lại sau.`,
        blocked: [] as string[],
      };
    }

    const blocked: string[] = [];
    const scenes: Scene[] = incoming.map((item, index) => {
      const existing = existingById.get(item.id);
      const order = index + 1;

      if (!existing) {
        return buildSceneFromFields(
          {
            id: item.id,
            label: item.label || `Cảnh ${order}`,
            duration: item.duration ?? 6,
            camera: item.camera || 'static',
            type: item.type,
            voiceoverVi: item.voiceoverVi,
            onScreenText: item.onScreenText,
            veoPrompt: item.veoPrompt,
            negativePrompt: item.negativePrompt,
          },
          order
        );
      }

      if (existing.status === 'generating') {
        blocked.push(existing.id);
        return { ...existing, order };
      }

      return {
        ...existing,
        order,
        label: item.label ?? existing.label,
        duration: item.duration ?? existing.duration,
        camera: item.camera ?? existing.camera,
        type: item.type ?? existing.type,
        voiceoverVi: item.voiceoverVi ?? existing.voiceoverVi,
        onScreenText: item.onScreenText ?? existing.onScreenText,
        veoPrompt: item.veoPrompt ?? existing.veoPrompt,
        negativePrompt: item.negativePrompt ?? existing.negativePrompt,
      };
    });

    project.script.scenes = scenes;
    project.script.totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
    project.storyboard.images = mergeStoryboardWithScript(project.storyboard.images, scenes);
    project.storyboard.backgrounds = mergeBackgroundsWithScript(project.storyboard.backgrounds, scenes);
    return { conflict: false, conflictMessage: '', blocked };
  });

  if (result.conflict) {
    return NextResponse.json({ error: result.conflictMessage }, { status: 409 });
  }

  if (result.blocked.length > 0) {
    return NextResponse.json(
      { warning: `Không thể sửa scene đang generating: ${result.blocked.join(', ')}`, script: project.script },
      { status: 200 }
    );
  }

  return NextResponse.json({ script: project.script });
}
