import { computeSegmentDurations } from './segmentSanitize';
import type { PromptParamKey } from './promptParamsDefs';
import type { LivestreamJob, LivestreamProduct, LivestreamV2Input } from './types';

/**
 * Params dùng được trong prompt, viết dạng `${ten_param}`.
 *
 * Vì sao cần: system prompt và user prompt gửi TÁCH RIÊNG cho AI — dữ liệu sản phẩm nằm ở user
 * prompt, nên khi Mr.D sửa system prompt thì không có cách nào nhắc tới tên/mô tả sản phẩm cụ
 * thể. Params lấp đúng khoảng đó: viết `${mota_sanpham}`, server thay bằng giá trị thật của sản
 * phẩm ĐANG sinh.
 */
// Re-export module thuần để call-site server chỉ cần import 1 chỗ. Client component PHẢI import
// thẳng từ promptParamsDefs — qua file này sẽ kéo segmentSanitize → constants → node:path vào
// bundle và webpack fail lúc build.
export { PROMPT_PARAMS, paramsForStep, fillPromptParams } from './promptParamsDefs';
export type { PromptParamKey } from './promptParamsDefs';


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

