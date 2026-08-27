/**
 * Dựng URL phát/tải video final của job — module THUẦN (client component dùng trực tiếp).
 *
 * Vì sao cần: key trên R2 CỐ ĐỊNH (`final.mp4`) và bị ghi đè mỗi lần ghép lại, nên URL không bao
 * giờ đổi. Trình duyệt cache thẻ <video> rất dai, người dùng ghép lại xong vẫn xem bản cũ dù R2
 * đã đúng — đã xác minh: md5 local == etag R2, chỉ client là cũ.
 *
 * Cách chữa: gắn tham số `v` = thời điểm ghép xong. Cùng một bản ghép thì URL ổn định (cache vẫn
 * phát huy tác dụng), ghép lại là `v` đổi → trình duyệt buộc phải tải bản mới. Đây là lớp phòng
 * thủ thứ hai, độc lập với header cache-control gửi lúc upload (xem lib/r2/client.ts) — cần cả
 * hai vì header chỉ áp cho object upload TỪ NAY, còn file đã nằm sẵn trên R2 thì không có nó.
 */

/** Rút gọn timestamp ISO thành token ngắn, an toàn cho query string. */
function versionToken(finishedAt: string | null): string | null {
  if (!finishedAt) return null;
  const ms = new Date(finishedAt).getTime();
  return Number.isFinite(ms) ? String(ms) : null;
}

/**
 * @param url URL gốc (R2 hoặc route media local), null nếu chưa có.
 * @param finishedAt thời điểm ghép xong (concat.finishedAt) — mốc phiên bản.
 */
export function withVersion(url: string | null | undefined, finishedAt: string | null): string | null {
  if (!url) return null;
  const token = versionToken(finishedAt);
  if (!token) return url;
  // Giữ nguyên query sẵn có (route media local có thể đã mang tham số).
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${token}`;
}
