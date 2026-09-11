import { NextRequest, NextResponse } from 'next/server';
import { desc, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { DB_ENABLED } from '@/lib/db/config';
import { flowJobLogs } from '@/lib/db/schema/flowJobLogs';
import { parseCursor, parseLimit, parseLogFilters } from '@/lib/logs/filters';
import { flowLogConditions, whereOf } from '@/lib/logs/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Đọc log lượt GỬI video lên Veo (bảng flow_job_logs) cho tab /logs.
 *
 * Vì sao TÁCH khỏi /api/logs/ai thay vì gộp bằng UNION: hai bảng có tập cột gần như rời nhau
 * (system/user/output vs veo_prompt/ref_images/chained) và hai trục phân trang độc lập — row_id
 * của bảng này không so sánh được với row_id bảng kia. Gộp thì phải bịa cột NULL cho nửa còn lại
 * (mất index, MariaDB materialize cả union rồi mới ORDER BY ... LIMIT), hoặc sắp theo created_at —
 * đúng thứ doc-comment index của ai_call_logs đã cấm dùng làm trục sắp xếp.
 *
 * Hai chế độ + con trỏ row_id: giống /api/logs/ai, xem doc-comment ở đó.
 */
export async function GET(req: NextRequest) {
  if (!DB_ENABLED) return NextResponse.json({ runs: [], nextCursor: null });
  const params = req.nextUrl.searchParams;
  const db = getDb();

  const idRaw = params.get('id');
  if (idRaw) {
    const rowId = Number(idRaw);
    if (!Number.isInteger(rowId) || rowId <= 0) {
      return NextResponse.json({ error: 'id không hợp lệ' }, { status: 400 });
    }
    const [run] = await db.select().from(flowJobLogs).where(eq(flowJobLogs.rowId, rowId)).limit(1);
    if (!run) return NextResponse.json({ error: 'Không tìm thấy lượt gen' }, { status: 404 });
    return NextResponse.json({ run });
  }

  const filters = parseLogFilters(params);
  const limit = parseLimit(params.get('limit'));
  const cursor = parseCursor(params.get('cursor'));

  const conditions = flowLogConditions(filters);
  if (cursor) conditions.push(lt(flowJobLogs.rowId, cursor));

  const runs = await db
    .select({
      rowId: flowJobLogs.rowId,
      createdAt: flowJobLogs.createdAt,
      sourceKind: flowJobLogs.sourceKind,
      jobSlug: flowJobLogs.jobSlug,
      projectId: flowJobLogs.projectId,
      unitId: flowJobLogs.unitId,
      unitOrder: flowJobLogs.unitOrder,
      flowJobId: flowJobLogs.flowJobId,
      model: flowJobLogs.model,
      aspect: flowJobLogs.aspect,
      durationSec: flowJobLogs.durationSec,
      chained: flowJobLogs.chained,
      errorKind: flowJobLogs.errorKind,
      attempts: flowJobLogs.attempts,
      durationMs: flowJobLogs.durationMs,
      /** Không kéo veo_prompt ở danh sách — 1 prompt Veo vài nghìn ký tự × 50 dòng. */
      promptLength: sql<number>`COALESCE(CHAR_LENGTH(${flowJobLogs.veoPrompt}), 0)`,
      ok: sql<boolean>`${flowJobLogs.errorMessage} IS NULL`,
    })
    .from(flowJobLogs)
    .where(whereOf(conditions))
    .orderBy(desc(flowJobLogs.rowId))
    .limit(limit);

  return NextResponse.json({
    runs,
    nextCursor: runs.length === limit ? runs[runs.length - 1].rowId : null,
  });
}
