/**
 * Chuyển đổi timestamp giữa 2 định dạng ở ranh giới DB:
 * - App/boundary object: ISO8601 UTC có hậu tố Z, vd "2026-08-17T10:00:00.000Z".
 * - Cột MariaDB DATETIME(3): "YYYY-MM-DD HH:MM:SS.mmm" (không timezone, KHÔNG có T/Z).
 *
 * Pool bật dateStrings:true nên mysql2 KHÔNG tự parse Date — đọc/ghi đều là string thô. Nếu
 * ghi thẳng ISO có Z, MariaDB bỏ Z và diễn giải theo giờ session → lệch. Nên ta CHUẨN HÓA:
 * ghi = UTC "YYYY-MM-DD HH:MM:SS.mmm"; đọc = gắn lại 'Z' để về ISO UTC. Nhất quán bất kể
 * timezone của server MariaDB.
 */

/** ISO (…Z) → chuỗi DATETIME(3) UTC cho MariaDB. null/undefined giữ nguyên null. */
export function isoToSql(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Đầu vào không parse được (dữ liệu cũ lạ) — giữ nguyên để không mất mát, cắt Z/T nếu có.
    return iso.replace('T', ' ').replace('Z', '');
  }
  // Lấy các thành phần UTC → "YYYY-MM-DD HH:MM:SS.mmm".
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}`
  );
}

/** Chuỗi DATETIME MariaDB (UTC, không Z) → ISO UTC (…Z). null giữ nguyên null. */
export function sqlToIso(sqlValue: string | null | undefined): string | null {
  if (!sqlValue) return null;
  // mysql2 trả "YYYY-MM-DD HH:MM:SS" hoặc có ".mmm". Ghép 'T' + 'Z' để thành ISO UTC.
  const withT = sqlValue.includes('T') ? sqlValue : sqlValue.replace(' ', 'T');
  const iso = withT.endsWith('Z') ? withT : `${withT}Z`;
  // Chuẩn hóa qua Date để đảm bảo có .mmm đồng nhất; nếu lỗi thì trả chuỗi đã ghép.
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString();
}
