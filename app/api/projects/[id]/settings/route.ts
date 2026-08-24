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
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    veoModel?: string;
    sceneChaining?: boolean;
    burnOnScreenText?: boolean;
    videoRefImagePaths?: string[];
  };

  if (body.veoModel !== undefined && !VALID_MODELS.includes(body.veoModel as VeoModel)) {
    return NextResponse.json({ error: `Model không hợp lệ: ${body.veoModel}` }, { status: 400 });
  }
  if (body.videoRefImagePaths !== undefined) {
    if (!Array.isArray(body.videoRefImagePaths) || body.videoRefImagePaths.some((p) => typeof p !== 'string')) {
      return NextResponse.json({ error: 'videoRefImagePaths phải là mảng string' }, { status: 400 });
    }
  }

  const { project } = await updateProject(id, (p) => {
    if (body.veoModel !== undefined) p.veoModel = body.veoModel as VeoModel;
    if (body.sceneChaining !== undefined) p.sceneChaining = body.sceneChaining;
    if (body.burnOnScreenText !== undefined) p.burnOnScreenText = body.burnOnScreenText;
    // Tối đa 3 ảnh ref (giới hạn Google Flow r2v) — cắt phòng thủ dù UI đã chặn.
    if (body.videoRefImagePaths !== undefined) p.videoRefImagePaths = body.videoRefImagePaths.slice(0, 3);
  });

  return NextResponse.json({ project });
}
