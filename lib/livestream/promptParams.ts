import { computeSegmentDurations } from './segmentSanitize';
import type { LivestreamJob, LivestreamProduct, LivestreamV2Input } from './types';

/**
 * Params dùng được trong system prompt sinh kịch bản, viết dạng `${ten_param}`.
 *
 * Vì sao cần: system prompt và user prompt gửi TÁCH RIÊNG cho AI — dữ liệu sản phẩm nằm ở user
 * prompt, nên khi Mr.D sửa system prompt thì không có cách nào nhắc tới tên/mô tả sản phẩm cụ
 * thể. Params lấp đúng khoảng đó: viết `${mota_sanpham}` trong system prompt, server thay bằng
 * giá trị thật của sản phẩm ĐANG sinh.
 *
 * Danh sách này là nguồn sự thật duy nhất: UI đọc nó để vẽ bảng gợi ý, server đọc nó để thay.
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

/**
 * Params gợi ý cho 1 bước. Bước gen ảnh chỉ hiện thứ tả được bằng HÌNH (tên/mô tả/ưu điểm/kênh) —
 * ${so_doan} hay ${cta} trong prompt vẽ ảnh chỉ làm nhiễu.
 *
 * Đây chỉ là bộ lọc HIỂN THỊ: fillPromptParams vẫn thay MỌI param ở mọi bước, nên prompt cũ có
 * ${cta} không đột nhiên hỏng sau thay đổi này.
 */
export function paramsForStep(step: 'script' | 'background') {
  return step === 'script' ? PROMPT_PARAMS : PROMPT_PARAMS.filter((p) => !('scriptOnly' in p));
}

export type PromptParamKey = (typeof PROMPT_PARAMS)[number]['key'];

/** Giá trị thật của từng param cho MỘT sản phẩm đang sinh kịch bản. */
export function buildPromptParamValues(args: {
  job: Pick<LivestreamJob, 'products'>;
  product: Pick<LivestreamProduct, 'id' | 'name' | 'description' | 'targetDurationSec'>;
  /** Thời lượng từng đoạn. Bỏ trống thì tự tính từ targetDurationSec — bước gen background không
   *  có sẵn mảng này nhưng ${so_doan} vẫn phải ra số thật, không phải 0. */
  durations?: number[];
  v2Input?: LivestreamV2Input | null;
}): Record<PromptParamKey, string> {
  const { job, product, v2Input } = args;
  const durations = args.durations ?? computeSegmentDurations(product.targetDurationSec);
  const index = job.products.findIndex((p) => p.id === product.id);
  return {
    ten_sanpham: product.name,
    mota_sanpham: product.description,
    thoiluong: String(product.targetDurationSec),
    so_doan: String(durations.length),
    uu_diem: (v2Input?.advantages ?? []).join('\n'),
    nen_tang: v2Input?.platform ?? '',
    ten_kenh: v2Input?.channelName ?? '',
    khuyen_mai: v2Input?.promotion ?? '',
    cta: v2Input?.cta ?? '',
    so_sanpham: String(job.products.length),
    vi_tri_sanpham: String(index >= 0 ? index + 1 : 1),
  };
}

/**
 * Thay mọi `${param}` trong prompt bằng giá trị thật.
 *
 * Param lạ (gõ sai tên) được GIỮ NGUYÊN thay vì xoá thành chuỗi rỗng: im lặng nuốt mất một dòng
 * chỉ dẫn thì Mr.D không biết mình gõ sai, còn để nguyên `${mota_san_pham}` thì nhìn preview là
 * thấy ngay. Cũng tránh phá cú pháp `${...}` mà prompt cố ý muốn AI in ra.
 */
export function fillPromptParams(
  prompt: string,
  values: Record<string, string>
): string {
  return prompt.replace(/\$\{\s*([a-zA-Z0-9_]+)\s*\}/g, (whole, key: string) =>
    key in values ? values[key] : whole
  );
}
