import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import { getFlowStatus } from '@/lib/googleFlow/flowJobs';
import { syncGeneratingScenes, runChainingForJustDone } from '@/lib/data/sceneSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  // 1. Refresh flow_status cache (không chặn nếu lỗi — chỉ ghi lại lỗi để UI hiển thị)
  try {
    const status = await getFlowStatus();
    await updateProject(id, (project) => {
      project.flowStatusCache = {
        flowConnected: status.flow_connected,
        geminiConnected: status.gemini_connected,
        projectsError: status.projects_error ?? null,
        checkedAt: new Date().toISOString(),
      };
    });
  } catch (err) {
    await updateProject(id, (project) => {
      project.flowStatusCache = {
        flowConnected: false,
        geminiConnected: false,
        projectsError: (err as Error).message,
        checkedAt: new Date().toISOString(),
      };
    });
  }

  // 2. Sync các scene đang generating với Google Flow (client-pull khi mở tab). Dùng chung
  // logic với background poller server-side (lib/data/sceneSync.ts) — poller đã reconcile
  // độc lập UI, đây chỉ để tab đang mở thấy kết quả ngay không phải chờ vòng poll kế.
  const { justDoneSceneIds } = await syncGeneratingScenes(id);

  // 3. Chain khung hình cho các scene vừa done (tách khỏi mutator sync để tránh deadlock
  // write-queue theo projectId — xem ghi chú trong sceneSync.ts).
  await runChainingForJustDone(id, justDoneSceneIds);

  const project = await readProject(id);
  return NextResponse.json({ project });
}
