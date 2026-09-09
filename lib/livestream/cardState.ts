/**
 * Trạng thái gấp/mở của CollapsibleCard lưu ở localStorage.
 * Phân biệt 3 ca: chưa từng lưu (null → theo mặc định của card), đã lưu mở, đã lưu đóng.
 * Ca "đã lưu đóng" mà rơi về defaultOpen=true là bug hay gặp nhất — Mr.D gấp card, F5 lại bung ra.
 */
export function resolveCardOpen(saved: string | null, defaultOpen: boolean): boolean {
  if (saved === null) return defaultOpen;
  return saved === '1';
}
