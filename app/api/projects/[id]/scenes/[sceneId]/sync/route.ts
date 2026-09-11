import { NextRequest, NextResponse } from 'next/server';
import { projectExists } from '@/lib/data/projectStore';
import { syncSceneManually } from '@/lib/data/sceneSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sync tay 1 cảnh với Google Flow — đối xứng với
 * app/api/livestream/[id]/segments/[segmentId]/sync.
 *
 * Dùng khi cảnh bị timeout giết oan (hoặc người dùng bấm Dừng) trong khi job vẫn chạy thật bên
 * Google: đây là đường lấy lại video mà không phải gen lại, đỡ một suất quota Veo.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; sceneId: string } }
) {
  const { id, sceneId } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const result = await syncSceneManually(id, sceneId);
  if (!result.ok) {
    const status = result.error === 'Scene không tồn tại' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
