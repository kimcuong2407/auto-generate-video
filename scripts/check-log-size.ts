/**
 * Báo cáo dung lượng các bảng log — thứ THAY CHỖ cơ chế cắt tỉa đã bỏ.
 *
 * Vì sao cần: từ khi log giữ vĩnh viễn (xem recordAiCall ở lib/ai/callLog.ts), không còn gì tự thu
 * dọn. Bảng phình là chuyện sẽ xảy ra, chỉ là sớm hay muộn; script này để phát hiện lúc còn dễ xử
 * lý thay vì lúc query đã chậm.
 *
 * KHÔNG tự xoá gì: xoá là quyết định của Mr.D, qua nút "Xoá theo bộ lọc" ở tab /logs (có xác nhận).
 * Script chỉ báo và exit 1 khi vượt ngưỡng, để cắm được vào CI nếu sau này cần.
 *
 * Dùng information_schema thay vì COUNT(*) — nhanh, không quét bảng. Đổi lại TABLE_ROWS là ƯỚC
 * LƯỢNG của InnoDB, nên in kèm chữ "~" để không ai đọc nhầm thành số chính xác.
 *
 * Chạy: npm run check:log-size   (cần DB; không cấu hình thì bỏ qua để CI không đỏ vì thiếu secret)
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../lib/db/client';
import { DB_ENABLED, DB_NAME } from '../lib/db/config';

const LOG_TABLES = ['ai_call_logs', 'flow_job_logs', 'shopee_ingests'];
/** Ngưỡng cảnh báo tổng dung lượng (MB). Chỉnh qua env khi cần, không sửa code. */
const WARN_MB = Number(process.env.LOG_SIZE_WARN_MB || 2048);

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

async function main() {
  if (!DB_ENABLED) {
    console.log('⏭  check-log-size: DB chưa cấu hình — bỏ qua.');
    return;
  }

  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS nrows, DATA_LENGTH AS dlen, INDEX_LENGTH AS ilen
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?)
        ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC`,
      LOG_TABLES
    );

    if (rows.length === 0) {
      console.log(`⚠️  check-log-size: không thấy bảng log nào trong "${DB_NAME}" — migration 0025 đã chạy chưa?`);
      return;
    }

    let total = 0;
    console.log(`Dung lượng bảng log trong "${DB_NAME}" (số dòng là ƯỚC LƯỢNG của InnoDB):`);
    for (const r of rows) {
      const bytes = Number(r.dlen ?? 0) + Number(r.ilen ?? 0);
      total += bytes;
      console.log(`  ${String(r.name).padEnd(16)} ~${String(r.nrows ?? 0).padStart(9)} dòng  ${mb(bytes).padStart(8)} MB`);
    }

    const missing = LOG_TABLES.filter((t) => !rows.some((r) => String(r.name) === t));
    if (missing.length > 0) {
      console.log(`  (chưa có bảng: ${missing.join(', ')})`);
    }

    console.log(`  ${'TỔNG'.padEnd(16)} ${' '.repeat(16)}${mb(total).padStart(8)} MB / ngưỡng ${WARN_MB} MB`);

    if (total / 1024 / 1024 > WARN_MB) {
      console.error(
        `\n❌ Log vượt ngưỡng ${WARN_MB} MB. Log KHÔNG tự cắt tỉa (cố ý — xem recordAiCall).\n` +
          `   Dọn bằng nút "Xoá theo bộ lọc" ở tab /logs, hoặc nâng LOG_SIZE_WARN_MB nếu mức này chấp nhận được.`
      );
      process.exitCode = 1;
      return;
    }
    console.log('\n✅ check-log-size: OK');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('check-log-size lỗi:', err);
  process.exitCode = 1;
});
