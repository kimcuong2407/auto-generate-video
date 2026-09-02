/**
 * Danh sách params `${...}` dùng được trong prompt — module THUẦN, không import gì.
 *
 * Vì sao tách khỏi promptParams.ts: client component (PromptParamsHint) cần danh sách này để vẽ
 * bảng gợi ý, mà promptParams.ts import segmentSanitize → constants → `node:path`, kéo module
 * Node vào bundle client và webpack fail ngay lúc build. Cùng lý do promptDefaults.ts được tách
 * khỏi scriptPrompt.ts. Đây là NGUỒN SỰ THẬT DUY NHẤT: server đọc để thay, UI đọc để gợi ý.
 */
export const PROMPT_PARAMS = [
  { key: 'ten_sanpham', label: 'Tên sản phẩm' },
  { key: 'mota_sanpham', label: 'Mô tả sản phẩm' },
  { key: 'thoiluong', label: 'Tổng thời lượng mong muốn (giây)', scriptOnly: true },
  { key: 'so_doan', label: 'Số đoạn sẽ viết', scriptOnly: true },
  { key: 'uu_diem', label: 'Ưu điểm sản phẩm (job V2), mỗi ý 1 dòng' },
  { key: 'nen_tang', label: 'Nền tảng live (job V2), VD Shopee Live' },
  { key: 'ten_kenh', label: 'Tên kênh (job V2)' },
  { key: 'khuyen_mai', label: 'Khuyến mãi (job V2)', scriptOnly: true },
  { key: 'cta', label: 'Lời kêu gọi hành động (job V2)', scriptOnly: true },
  { key: 'so_sanpham', label: 'Tổng số sản phẩm trong buổi live', scriptOnly: true },
  { key: 'vi_tri_sanpham', label: 'Sản phẩm này là thứ mấy (1-based)', scriptOnly: true },
] as const;

export type PromptParamKey = (typeof PROMPT_PARAMS)[number]['key'];

/**
 * Params gợi ý cho 1 bước. Bước gen ảnh chỉ hiện thứ tả được bằng HÌNH (tên/mô tả/ưu điểm/kênh) —
 * ${so_doan} hay ${cta} trong prompt vẽ ảnh chỉ làm nhiễu.
 *
 * Đây chỉ là bộ lọc HIỂN THỊ: fillPromptParams vẫn thay MỌI param ở mọi bước, nên prompt cũ có
 * ${cta} không đột nhiên hỏng.
 */
export function paramsForStep(step: 'script' | 'background') {
  return step === 'script' ? PROMPT_PARAMS : PROMPT_PARAMS.filter((p) => !('scriptOnly' in p));
}

/**
 * Thay mọi `${param}` trong prompt bằng giá trị thật.
 *
 * Param lạ (gõ sai tên) được GIỮ NGUYÊN thay vì xoá thành chuỗi rỗng: im lặng nuốt mất một dòng
 * chỉ dẫn thì Mr.D không biết mình gõ sai, còn để nguyên `${mota_san_pham}` thì nhìn preview là
 * thấy ngay. Cũng tránh phá cú pháp `${...}` mà prompt cố ý muốn AI in ra.
 */
export function fillPromptParams(prompt: string, values: Record<string, string>): string {
  return prompt.replace(/\$\{\s*([a-zA-Z0-9_]+)\s*\}/g, (whole, key: string) =>
    key in values ? values[key] : whole
  );
}
