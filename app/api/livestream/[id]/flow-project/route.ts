import { NextResponse } from 'next/server';
import { jobExists, readJob, updateJob, ensureJobFlowId } from '@/lib/livestream/jobStore';
import { FlowApiError } from '@/lib/googleFlow/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tạo (hoặc lấy lại nếu đã có) Flow project cho job và gán flowProjectId — dùng chung
 * ensureJobFlowId với luồng gen video (segmentGenerate.ts). Cho phép người dùng chủ động
 * tạo Flow project trước khi bấm gen video, thay vì đợi lỗi "Chưa có flowProjectId" giữa chừng.
 *
 * GET  → chỉ đọc trạng thái flowProjectId hiện tại (không tạo mới).
 * POST → đảm bảo có flowProjectId (tạo nếu chưa có). Lỗi phiên Flow hết hạn trả 502.
 *        ?force=1 → xoá flowProjectId cũ rồi tạo lại — cần khi đổi tài khoản Flow, vì
 *        project cũ thuộc account khác sẽ gây 404 "Requested entity was not found" lúc gen.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const job = await readJob(id);
  return NextResponse.json({ flowProjectId: job.flowProjectId ?? null });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const force = new URL(req.url).searchParams.get('force') === '1';

  try {
    if (force) {
      // Xoá projectId cũ để ensureJobFlowId tạo mới với tài khoản Flow hiện tại.
      await updateJob(id, (j) => {
        j.flowProjectId = null;
      });
    }
    const flowProjectId = await ensureJobFlowId(id);
    if (!flowProjectId) {
      return NextResponse.json(
        {
          error:
            'Không tạo được Flow project — phiên đăng nhập Google Flow có thể đã hết hạn, ' +
            'vui lòng kết nối lại ở Settings › Flow.',
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ flowProjectId });
  } catch (err) {
    const message =
      err instanceof FlowApiError
        ? `Flow API lỗi: ${err.message}`
        : `Tạo Flow project thất bại: ${(err as Error).message}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
