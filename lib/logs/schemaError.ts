/**
 * Đổi lỗi THIẾU SCHEMA của MariaDB thành thông báo nói đúng việc phải làm.
 *
 * Vì sao cần: route log SELECT thẳng các cột Drizzle. Khi DB chưa chạy migration, driver ném
 * ER_BAD_FIELD_ERROR/ER_NO_SUCH_TABLE, Next bắt và trả 500 với body RỖNG 0 byte — màn hình chỉ
 * hiện "HTTP 500", không có một chữ nào về nguyên nhân. Ca đã xảy ra thật (2026-09-13, DB local
 * `video`): bảng ai_call_logs có 51 dòng nhưng thiếu cột `source_kind`, bảng flow_job_logs chưa
 * tồn tại, trong khi __drizzle_migrations đã ghi id=25 là đã áp — tức không thể tin bảng đó để
 * biết schema thật.
 *
 * Chỉ nhận DIỆN hai mã lỗi này, mọi lỗi khác trả null để caller ném tiếp: nuốt lỗi lạ thành một
 * thông báo "chắc là do migration" chính là kiểu bịa nguyên nhân mà log sinh ra để chống lại.
 */

/** Mã lỗi MariaDB: 1054 = không có cột, 1146 = không có bảng. */
const MISSING_COLUMN = 'ER_BAD_FIELD_ERROR';
const MISSING_TABLE = 'ER_NO_SUCH_TABLE';

export interface SchemaErrorInfo {
  /** Thông báo hiển thị thẳng cho người dùng, kèm lệnh cần chạy. */
  message: string;
  /** Nguyên văn lỗi driver — giữ lại để không mất bằng chứng gốc khi đọc log server. */
  raw: string;
}

/**
 * `err` có phải lỗi thiếu schema không. Trả null = không phải, caller PHẢI ném tiếp.
 *
 * `migrationTag` là file migration cấp cho cột/bảng đang thiếu — nói tên file để người đọc chạy
 * được ngay, thay vì phải đi dò xem thiếu cái gì thì chạy cái nào.
 */
export function schemaErrorInfo(err: unknown, migrationTag: string): SchemaErrorInfo | null {
  const found = findSqlError(err);
  if (!found) return null;

  const what = found.code === MISSING_TABLE ? 'Thiếu BẢNG' : 'Thiếu CỘT';
  return {
    message:
      `${what} trong database — migration ${migrationTag} chưa chạy trên DB này. ` +
      `Chạy: mysql -h$DB_HOST -u$DB_USER -p $DB_NAME < lib/db/migrations/${migrationTag}.sql ` +
      `(file dùng IF NOT EXISTS nên chạy lặp không hỏng, không đụng dữ liệu đang có). ` +
      `Lưu ý: bảng __drizzle_migrations có thể đã ghi nhận migration này rồi mà DDL thật vẫn chưa ` +
      `áp — đừng tin bảng đó, kiểm tra bằng SHOW COLUMNS / SHOW TABLES. Lỗi gốc: ${found.raw}`,
    raw: found.raw,
  };
}

/**
 * Dò mã lỗi MariaDB qua chuỗi `cause`, vì Drizzle BỌC lỗi driver.
 *
 * Đã kiểm chứng bằng chạy thật (scratch/probe-schema-err.ts, 2026-09-13): với cột thiếu, Drizzle
 * ném `DrizzleQueryError` có `code === undefined` và mã thật nằm ở `err.cause.code` =
 * 'ER_BAD_FIELD_ERROR'. Bản đầu của hàm này chỉ đọc `err.code` nên không nhận ra lỗi nào — route
 * vẫn trả 500 body rỗng y như trước khi sửa.
 *
 * Đi theo `cause` có TRẦN lặp: chuỗi cause tự trỏ vòng thì vòng lặp không lối thoát sẽ treo
 * request, và treo thì khó chẩn đoán hơn hẳn một lỗi 500.
 */
function findSqlError(err: unknown): { code: string; raw: string } | null {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    const e = cur as { code?: string; sqlMessage?: string; message?: string; cause?: unknown };
    if (e.code === MISSING_COLUMN || e.code === MISSING_TABLE) {
      return { code: e.code, raw: e.sqlMessage ?? e.message ?? String(cur) };
    }
    cur = e.cause;
  }
  return null;
}
