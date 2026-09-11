/**
 * Format thời gian cho HIỂN THỊ, cố định múi giờ UTC+7.
 *
 * Vì sao cố định thay vì để trình duyệt tự chọn: VPS production chạy UTC, máy Mr.D chạy UTC+7.
 * `toLocaleString('vi-VN')` KHÔNG có `timeZone` sẽ lấy múi giờ của nơi render — cùng một dòng log
 * hiện hai giờ khác nhau tuỳ mở ở đâu, và bằng chứng đối chiếu kiểu đó thì vô dụng.
 *
 * Vì sao KHÔNG nhét vào lib/db/datetime.ts: file đó là chuyển đổi ở RANH GIỚI DB (server-only,
 * import từ drizzle). Client component import thẳng module này, trộn vào file kia sẽ kéo cả tầng
 * DB ra bundle trình duyệt.
 *
 * Vì sao KHÔNG cộng tay 7 giờ: `Intl` có sẵn ở cả Node lẫn trình duyệt và xử lý đúng mọi ca
 * (vắt ngày, vắt tháng, năm nhuận). Cộng tay là bug im lặng nếu sau này cần múi khác.
 */

/** Múi giờ hiển thị của toàn app. Đổi ở đây là đổi mọi nơi. */
export const DISPLAY_TZ = 'Asia/Ho_Chi_Minh';

/**
 * Chuẩn hoá đầu vào về ISO UTC.
 *
 * Cột DATETIME của MariaDB đọc qua mysql2 (dateStrings:true) ra "YYYY-MM-DD HH:MM:SS.mmm" —
 * KHÔNG có 'T', KHÔNG có 'Z', nhưng nội dung LÀ UTC (xem lib/db/datetime.ts). `new Date()` trên
 * chuỗi đó diễn giải theo giờ LOCAL → lệch 7 tiếng trên máy Mr.D, đúng 0 trên VPS: sai lệch chỉ
 * lộ ở một trong hai nơi nên rất dễ lọt.
 *
 * Lặp lại 3 dòng logic của sqlToIso() thay vì import — CHỦ Ý, không phải quên: import sẽ kéo
 * lib/db/datetime.ts (và cả nhánh drizzle) vào bundle client.
 */
function toUtcDate(dbOrIso: string): Date | null {
  if (!dbOrIso) return null;
  const withT = dbOrIso.includes('T') ? dbOrIso : dbOrIso.replace(' ', 'T');
  const iso = /[Zz]$|[+-]\d{2}:\d{2}$/.test(withT) ? withT : `${withT}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Lấy các thành phần ngày/giờ THEO múi UTC+7 (không phải múi của máy đang chạy). */
function partsVn(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  // en-GB trả giờ 24h nhưng nửa đêm có thể ra "24" thay vì "00" ở một số phiên bản ICU.
  if (out.hour === '24') out.hour = '00';
  return out;
}

/**
 * "21:32:07 03/09" — dùng cho bảng/dropdown, nơi năm là thừa và chỗ thì hẹp.
 * Đầu vào hỏng thì trả nguyên văn, không ném: một chuỗi lạ không đáng làm vỡ cả bảng log.
 */
export function shortTimeVn(dbOrIso: string): string {
  const d = toUtcDate(dbOrIso);
  if (!d) return dbOrIso;
  const p = partsVn(d);
  return `${p.hour}:${p.minute}:${p.second} ${p.day}/${p.month}`;
}

/** "03/09/2026 21:32:07" — dùng cho chi tiết/tiêu đề, nơi cần đủ năm. */
export function fullTimeVn(dbOrIso: string): string {
  const d = toUtcDate(dbOrIso);
  if (!d) return dbOrIso;
  const p = partsVn(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * "YYYY-MM-DD" người dùng nhập (HIỂU LÀ ngày theo giờ VN) → mốc DATETIME UTC để đưa vào WHERE.
 *
 * Vì sao cần: cột created_at lưu UTC. Mr.D lọc "từ ngày 03/09" nghĩa là 00:00 giờ VN ngày 03/09,
 * tức 17:00 UTC ngày 02/09. So thẳng chuỗi "2026-09-03" với cột UTC sẽ lệch 7 tiếng và âm thầm
 * bỏ sót/thừa các dòng nằm trong khoảng đó.
 *
 * endOfDay=true → 23:59:59.999 giờ VN (dùng cho `to`, để bao trọn ngày cuối).
 * Trả null nếu chuỗi không đúng dạng — caller bỏ qua filter thay vì dựng WHERE rác.
 */
export function vnDayToUtcSql(day: string, endOfDay = false): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // +07:00 là offset CỐ ĐỊNH của Asia/Ho_Chi_Minh (Việt Nam không có DST) nên ghi thẳng vào chuỗi
  // ISO là đúng và không cần dò offset động.
  const iso = endOfDay ? `${day}T23:59:59.999+07:00` : `${day}T00:00:00.000+07:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
