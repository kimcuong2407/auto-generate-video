import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { DB_ENABLED } from '@/lib/db/config';
import { aiCallLogs } from '@/lib/db/schema/aiCallLogs';
import { isPromptStepKey } from '@/lib/livestream/promptSteps';

/**
 * Trần số lượt trả về. Trước kia cắt tỉa giữ sẵn 20 lượt/bước nên `limit` chỉ là hình thức; từ khi
 * log giữ VĨNH VIỄN (xem recordAiCall) đây là thứ DUY NHẤT chặn một job đã gen lại 200 lần kéo cả
 * bảng mediumtext về client.
 */
const LIST_LIMIT = 30;
/** Timeline gộp mọi bước × mọi sản phẩm nên cần trần cao hơn 1 bước, nhưng vẫn phải có trần. */
const TIMELINE_LIMIT = 300;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Đọc LOG lượt gọi AI thật (bảng ai_call_logs) của 1 bước — input/output nguyên văn đã gửi/nhận.
 *
 * TÁCH KHỎI GET /api/prompts chứ không nhồi chung: panel prompt gọi lại /api/prompts sau MỖI lần
 * bấm Lưu, mà 1 lượt log có thể ~60k ký tự (system + user + output). Nhồi chung là tải lại vài MB
 * cho mỗi lần lưu prompt, trong khi phần lớn thời gian Mr.D không mở mục log.
 *
 * HAI CHẾ ĐỘ (cùng lý do trên — tránh kéo mediumtext khi chưa cần):
 *   GET ?step=&jobSlug=        → CHỈ metadata 20 lượt (~2KB), đủ vẽ dropdown chọn lượt.
 *   GET ?step=&jobSlug=&id=N   → đầy đủ 1 lượt (system/user/output/error).
 *
 * `jobSlug` bỏ trống = '' — các bước chạy trước khi job tồn tại (extract / vision_screenshot /
 * v2_field_extract), xem doc-comment bảng ai_call_logs.
 */
export async function GET(req: NextRequest) {
  const step = req.nextUrl.searchParams.get('step')?.trim() || '';
  const jobSlug = req.nextUrl.searchParams.get('jobSlug')?.trim() || '';
  // Luồng Video Review dùng cột riêng project_id — xem doc-comment bảng ai_call_logs.
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim() || '';
  const idParam = req.nextUrl.searchParams.get('id')?.trim() || '';
  // Bỏ `step` = timeline GỘP mọi bước của 1 job (soi cả pipeline một lượt thay vì mở từng bước).
  const wantTimeline = !step && (!!jobSlug || !!projectId);

  if (!wantTimeline && !isPromptStepKey(step)) {
    return NextResponse.json({ error: `Bước không hợp lệ: ${step}` }, { status: 400 });
  }
  // Chưa cấu hình DB thì trả danh sách rỗng thay vì 500: UI hiện "chưa có lượt nào", không vỡ trang.
  if (!DB_ENABLED) return NextResponse.json({ runs: [] });

  const db = getDb();
  // project_id LUÔN nằm trong WHERE, kể cả khi rỗng: bỏ nó ra thì query của module livestream
  // (project_id='') sẽ quét luôn log của mọi project review và ngược lại.
  const owner = and(eq(aiCallLogs.jobSlug, jobSlug), eq(aiCallLogs.projectId, projectId));
  const scope = wantTimeline ? owner : and(owner, eq(aiCallLogs.stepKey, step));

  // --- Chế độ 2: 1 lượt đầy đủ ---
  if (idParam) {
    const rowId = Number(idParam);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      return NextResponse.json({ error: 'id không hợp lệ' }, { status: 400 });
    }
    // Giữ CẢ jobSlug + step trong WHERE (không chỉ rowId): đoán rowId không đọc chéo được sang
    // bước khác hay job khác.
    const [run] = await db
      .select()
      .from(aiCallLogs)
      .where(and(scope, eq(aiCallLogs.rowId, rowId)))
      .limit(1);
    if (!run) return NextResponse.json({ error: 'Không tìm thấy lượt chạy' }, { status: 404 });
    return NextResponse.json({ run });
  }

  // --- Chế độ 1: danh sách metadata (KHÔNG select 3 cột mediumtext) ---
  const runs = await db
    .select({
      rowId: aiCallLogs.rowId,
      createdAt: aiCallLogs.createdAt,
      durationMs: aiCallLogs.durationMs,
      attempts: aiCallLogs.attempts,
      model: aiCallLogs.model,
      promptScope: aiCallLogs.promptScope,
      productId: aiCallLogs.productId,
      stepKey: aiCallLogs.stepKey,
      imageCount: aiCallLogs.imageCount,
      /** Độ dài output thay vì nội dung — đủ để biết lượt đó có trả về gì không. */
      outputLength: sql<number>`COALESCE(CHAR_LENGTH(${aiCallLogs.output}), 0)`,
      ok: sql<boolean>`${aiCallLogs.errorMessage} IS NULL`,
    })
    .from(aiCallLogs)
    .where(scope)
    .orderBy(desc(aiCallLogs.rowId))
    .limit(wantTimeline ? TIMELINE_LIMIT : LIST_LIMIT);

  return NextResponse.json({ runs });
}
