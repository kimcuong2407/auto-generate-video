/**
 * Tách 1 khối text lớn (từ file .txt/.csv hoặc nhập tay) thành các đoạn riêng cho từng
 * sản phẩm — quy ước đơn giản (không cần thư viện parse phức tạp): phân cách bằng dòng
 * chứa duy nhất "---" hoặc từ 2 dòng trống liên tiếp trở lên (>= 3 dấu xuống dòng liền
 * nhau) — CỐ Ý không tách theo 1 dòng trống đơn vì đó là cách xuống dòng bình thường
 * giữa các đoạn văn trong mô tả 1 sản phẩm. Nếu không có ranh giới nào, coi cả text là
 * 1 sản phẩm.
 */
export function splitProductBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n[ \t]*-{3,}[ \t]*\n|\n{3,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.length > 0 ? blocks : [normalized];
}
