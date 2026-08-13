import { NextRequest, NextResponse } from 'next/server';
import { projectExists, updateProject } from '@/lib/data/projectStore';
import type { VeoModel } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_MODELS: VeoModel[] = [
  'veo_3_1_quality',
  'veo_3_1_fast',
  'veo_3_1_lite',
  'veo_3_1_lite_low_priority',
  'abra',
];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    veoModel?: string;
    sceneChaining?: boolean;
    burnOnScreenText?: boolean;
  };

  if (body.veoModel !== undefined && !VALID_MODELS.includes(body.veoModel as VeoModel)) {
    return NextResponse.json({ error: `Model không hợp lệ: ${body.veoModel}` }, { status: 400 });
  }

  const { project } = await updateProject(id, (p) => {
    if (body.veoModel !== undefined) p.veoModel = body.veoModel as VeoModel;
    if (body.sceneChaining !== undefined) p.sceneChaining = body.sceneChaining;
    if (body.burnOnScreenText !== undefined) p.burnOnScreenText = body.burnOnScreenText;
  });

  return NextResponse.json({ project });
}
