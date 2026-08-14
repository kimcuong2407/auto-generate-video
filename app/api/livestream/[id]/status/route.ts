import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { getFlowStatus } from '@/lib/googleFlow/flowJobs';
import { syncGeneratingSegments, runChainingForJustDone } from '@/lib/livestream/segmentSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  // 1. Refresh flow_status cache (không chặn nếu lỗi — chỉ ghi lại lỗi để UI hiển thị)
  try {
    const status = await getFlowStatus();
    await updateJob(id, (job) => {
      job.flowStatusCache = {
        flowConnected: status.flow_connected,
        geminiConnected: status.gemini_connected,
        projectsError: status.projects_error ?? null,
        checkedAt: new Date().toISOString(),
      };
    });
  } catch (err) {
    await updateJob(id, (job) => {
      job.flowStatusCache = {
        flowConnected: false,
        geminiConnected: false,
        projectsError: (err as Error).message,
        checkedAt: new Date().toISOString(),
      };
    });
  }

  // 2. Sync các đoạn đang generating với Google Flow (poll trước, timeout sau — xem
  //    lib/livestream/segmentSync.ts). Dùng chung với background poller.
  const { justDoneSegmentIds } = await syncGeneratingSegments(id);

  // 3. Chain khung hình cho các đoạn vừa done + cascade trigger đoạn kế.
  await runChainingForJustDone(id, justDoneSegmentIds);

  const job = await readJob(id);
  return NextResponse.json({ job });
}
