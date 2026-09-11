import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { DB_ENABLED } from '@/lib/db/config';
import { aiCallLogs } from '@/lib/db/schema/aiCallLogs';
import { flowJobLogs } from '@/lib/db/schema/flowJobLogs';
import { deleteFiltersOrNull, parseLogFilters } from '@/lib/logs/filters';
import { conditionsFor, whereOf, type LogTable } from '@/lib/logs/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * XOÁ LOG THEO BỘ LỌC — đường DUY NHẤT làm mất log, và mất là vĩnh viễn.
 *
 * Từ khi bỏ cắt tỉa (xem recordAiCall), không còn cơ chế tự động nào xoá log. Đổi lại, chỗ này
 * phải khó bấm nhầm. Ba rào chắn, không rào nào được bỏ:
 *
 *   1. `confirm` phải đúng chữ 'XOA'. KHÔNG nhận `true` — một boolean quá dễ gửi nhầm từ code.
 *   2. Bộ lọc phải thu hẹp phạm vi. Đây là chốt chặn ca tệ nhất: một lỗi fetch ở UI làm mọi filter
 *      thành undefined, request tới với bộ lọc rỗng, rồi DELETE không điều kiện quét sạch bảng —
 *      không lỗi nào báo, chỉ có log biến mất. deleteFiltersOrNull trả null cho MỌI dạng rỗng
 *      (mảng rỗng, chuỗi toàn khoảng trắng, ngày sai định dạng); xem scripts/check-log-delete-guard.ts.
 *   3. Đếm thử (`?dryRun=1`) chạy CÙNG hàm dựng điều kiện với đường xoá thật. Hai bản logic riêng
 *      thì số hiện trong hộp xác nhận sẽ khác số thực xoá — xác nhận kiểu đó là xác nhận giả.
 */

function tableOf(raw: string | null): LogTable | null {
  return raw === 'ai' || raw === 'flow' ? raw : null;
}

/** Đếm số dòng SẼ bị xoá, để UI hiện trong hộp xác nhận trước khi Mr.D gõ 'XOA'. */
export async function GET(req: NextRequest) {
  if (!DB_ENABLED) return NextResponse.json({ count: 0 });
  const params = req.nextUrl.searchParams;

  const table = tableOf(params.get('table'));
  if (!table) return NextResponse.json({ error: 'table phải là "ai" hoặc "flow"' }, { status: 400 });
  if (params.get('dryRun') !== '1') {
    return NextResponse.json({ error: 'GET chỉ dùng để đếm thử (dryRun=1)' }, { status: 400 });
  }

  const filters = deleteFiltersOrNull(parseLogFilters(params));
  if (!filters) {
    return NextResponse.json(
      { error: 'Phải chọn ít nhất 1 bộ lọc — không có đường xoá toàn bộ log' },
      { status: 400 }
    );
  }

  const where = whereOf(conditionsFor(table, filters));
  const db = getDb();
  // Tách nhánh theo bảng thay vì ép kiểu chung: Drizzle suy kiểu cột từ chính bảng truyền vào,
  // nhét `as never` để dùng một nhánh sẽ vứt luôn phần kiểm kiểu đang bảo vệ mình.
  const [row] =
    table === 'ai'
      ? await db.select({ count: sql<number>`COUNT(*)` }).from(aiCallLogs).where(where)
      : await db.select({ count: sql<number>`COUNT(*)` }).from(flowJobLogs).where(where);

  return NextResponse.json({ count: Number(row?.count ?? 0) });
}

export async function POST(req: NextRequest) {
  if (!DB_ENABLED) return NextResponse.json({ error: 'Chưa cấu hình DB' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  const { confirm } = body;
  if (confirm !== 'XOA') {
    return NextResponse.json(
      { error: "Thiếu xác nhận: gõ đúng chữ XOA để xác nhận xoá vĩnh viễn" },
      { status: 400 }
    );
  }

  const params = req.nextUrl.searchParams;
  const table = tableOf(params.get('table'));
  if (!table) return NextResponse.json({ error: 'table phải là "ai" hoặc "flow"' }, { status: 400 });

  // CÙNG hàm với nhánh đếm thử ở trên — xem rào chắn số 3.
  const filters = deleteFiltersOrNull(parseLogFilters(params));
  if (!filters) {
    return NextResponse.json(
      { error: 'Phải chọn ít nhất 1 bộ lọc — không có đường xoá toàn bộ log' },
      { status: 400 }
    );
  }

  const conditions = conditionsFor(table, filters);
  // Chốt cuối, phòng khi hàm trên bị sửa hỏng sau này: không điều kiện thì KHÔNG xoá.
  if (conditions.length === 0) {
    return NextResponse.json({ error: 'Điều kiện xoá rỗng — từ chối' }, { status: 400 });
  }

  const db = getDb();
  const where = whereOf(conditions);
  const res =
    table === 'ai'
      ? await db.delete(aiCallLogs).where(where)
      : await db.delete(flowJobLogs).where(where);
  const deleted = Number((res as unknown as { affectedRows?: number })?.affectedRows ?? 0);

  console.log(`[logs] Mr.D xoá ${deleted} dòng khỏi bảng ${table} với bộ lọc`, {
    sourceKinds: filters.sourceKinds,
    steps: filters.steps,
    owner: filters.owner,
    model: filters.model,
    status: filters.status,
    from: filters.fromUtc,
    to: filters.toUtc,
  });

  return NextResponse.json({ deleted });
}
