import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db/client';
import { DB_ENABLED } from '@/lib/db/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Các bảng log giữ vĩnh viễn — thứ cần canh dung lượng từ khi bỏ cắt tỉa. */
const LOG_TABLES = ['ai_call_logs', 'flow_job_logs', 'shopee_ingests'];

/**
 * Dung lượng các bảng log, để tab /logs hiện ngay đầu trang.
 *
 * Vì sao cần hiện: log không còn tự cắt tỉa nên bảng chỉ tăng. Không có chỗ nào nhìn thấy số này
 * thì "bảng phình" sẽ chỉ lộ ra lúc query bắt đầu chậm — muộn hơn nhiều so với lúc còn dễ xử lý.
 *
 * Đọc information_schema (tức thì) chứ KHÔNG COUNT(*): đếm thật trên bảng vài trăm nghìn dòng là
 * quét toàn bảng mỗi lần mở tab — đúng thứ trang này sinh ra để tránh.
 *
 * Đánh đổi: `TABLE_ROWS` của InnoDB là ƯỚC LƯỢNG (có thể lệch vài chục %). UI PHẢI nói rõ điều đó,
 * nếu không Mr.D thấy số nhảy giữa hai lần tải và tưởng có gì hỏng.
 */
export async function GET() {
  if (!DB_ENABLED) return NextResponse.json({ tables: [], estimated: true });

  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name, TABLE_ROWS AS rows, DATA_LENGTH AS dataLength,
            INDEX_LENGTH AS indexLength
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?)`,
    LOG_TABLES
  );

  const tables = rows.map((r) => ({
    name: String(r.name),
    rows: Number(r.rows ?? 0),
    bytes: Number(r.dataLength ?? 0) + Number(r.indexLength ?? 0),
  }));

  return NextResponse.json({ tables, estimated: true });
}
