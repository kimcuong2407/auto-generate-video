import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import { evaluateScript } from '@/lib/data/veoPromptEvaluate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chấm điểm bộ veoPrompt của project — nút "Chấm điểm" ở Bước 2.
 *
 * Tốn 1 lượt AI text mỗi lần gọi (rẻ hơn nhiều so với 1 lượt Veo hỏng, xem veoPromptEvaluate.ts).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(id);
  if (project.script.scenes.length === 0) {
    return NextResponse.json({ error: 'Chưa có kịch bản để chấm — sinh kịch bản trước' }, { status: 400 });
  }

  try {
    const evaluation = await evaluateScript(project);
    await updateProject(id, (p) => {
      p.script.evaluation = evaluation;
    });
    return NextResponse.json({ ok: true, evaluation });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
