import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { DB_ENABLED } from '@/lib/db/config';
import { aiCallLogs } from '@/lib/db/schema/aiCallLogs';
import { parseCursor, parseLimit, parseLogFilters } from '@/lib/logs/filters';
import { aiLogConditions, whereOf } from '@/lib/logs/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Đọc log lượt gọi AI ở phạm vi TOÀN CỤC (tab /logs) — khác /api/ai-logs vốn bắt buộc có
 * jobSlug/projectId.
 *
 * HAI CHẾ ĐỘ, cùng lý do đã ghi ở /api/ai-logs: 1 lượt sinh kịch bản có thể ~60k ký tự, kéo cả
 * nội dung cho một trang 50 dòng là vài MB mỗi lần bấm lọc.
 *   GET ?<filters>   → danh sách metadata, KHÔNG chạm 3 cột mediumtext.
 *   GET ?id=N        → đầy đủ 1 lượt.
 *
 * PHÂN TRANG BẰNG CON TRỎ row_id, không OFFSET: bảng giữ vĩnh viễn nên OFFSET 10000 bắt MariaDB
 * đếm rồi bỏ 10.000 dòng mỗi lần lật trang. row_id là thứ tự ghi THẬT (xem doc-comment index của
 * bảng) nên vừa đúng vừa dùng được index.
 *
 * KHÔNG trả tổng số dòng: đếm toàn bảng mỗi lần mở tab là tự bắn chân khi bảng lớn. UI hiện
 * "đang xem N dòng" + nút tải thêm.
 */
export async function GET(req: NextRequest) {
  if (!DB_ENABLED) return NextResponse.json({ runs: [], nextCursor: null });
  const params = req.nextUrl.searchParams;
  const db = getDb();

  // --- Chế độ chi tiết ---
  const idRaw = params.get('id');
  if (idRaw) {
    const rowId = Number(idRaw);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      return NextResponse.json({ error: 'id không hợp lệ' }, { status: 400 });
    }
    // Chỉ WHERE row_id: tab này CỐ Ý toàn cục nên không có scope job/project để ghép thêm. Khác
    // /api/ai-logs (giữ scope để đoán rowId không đọc chéo sang job khác) — ghi rõ ở đây để người
    // đọc sau không tưởng là sót.
    const [run] = await db.select().from(aiCallLogs).where(eq(aiCallLogs.rowId, rowId)).limit(1);
    if (!run) return NextResponse.json({ error: 'Không tìm thấy lượt chạy' }, { status: 404 });
    return NextResponse.json({ run });
  }

  // --- Chế độ danh sách ---
  const filters = parseLogFilters(params);
  const limit = parseLimit(params.get('limit'));
  const cursor = parseCursor(params.get('cursor'));

  const conditions = aiLogConditions(filters);
  if (cursor) conditions.push(lt(aiCallLogs.rowId, cursor));

  const runs = await db
    .select({
      rowId: aiCallLogs.rowId,
      createdAt: aiCallLogs.createdAt,
      sourceKind: aiCallLogs.sourceKind,
      stepKey: aiCallLogs.stepKey,
      jobSlug: aiCallLogs.jobSlug,
      projectId: aiCallLogs.projectId,
      productId: aiCallLogs.productId,
      model: aiCallLogs.model,
      promptScope: aiCallLogs.promptScope,
      durationMs: aiCallLogs.durationMs,
      attempts: aiCallLogs.attempts,
      imageCount: aiCallLogs.imageCount,
      /** Độ dài thay vì nội dung — đủ biết lượt đó có trả về gì không, không kéo mediumtext. */
      outputLength: sql<number>`COALESCE(CHAR_LENGTH(${aiCallLogs.output}), 0)`,
      ok: sql<boolean>`${aiCallLogs.errorMessage} IS NULL`,
    })
    .from(aiCallLogs)
    .where(whereOf(conditions))
    .orderBy(desc(aiCallLogs.rowId))
    .limit(limit);

  return NextResponse.json({
    runs,
    // Hết dữ liệu thì null để UI ẩn nút "tải thêm" thay vì bấm hoài ra rỗng.
    nextCursor: runs.length === limit ? runs[runs.length - 1].rowId : null,
  });
}
