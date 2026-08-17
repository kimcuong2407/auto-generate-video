import { NextRequest, NextResponse } from 'next/server';
import { projectExists, updateProject } from '@/lib/data/projectStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    model?: string;
    useProductReference?: boolean;
    useSpokespersonReference?: boolean;
  };

  const { project } = await updateProject(id, (p) => {
    if (body.model !== undefined && body.model.trim()) p.storyboard.model = body.model.trim();
    if (body.useProductReference !== undefined) p.storyboard.useProductReference = body.useProductReference;
    if (body.useSpokespersonReference !== undefined)
      p.storyboard.useSpokespersonReference = body.useSpokespersonReference;
  });

  return NextResponse.json({ storyboard: project.storyboard });
}
