/**
 * Định danh 11 bước gọi AI của module livestream + mô tả để UI vẽ danh sách.
 *
 * Module THUẦN (chỉ import promptDefaults — cũng thuần): client component import trực tiếp được.
 * Import qua module có `node:` sẽ vỡ bundle client, xem cảnh báo ở promptParams.ts.
 *
 * `key` là KHOÁ LƯU TRONG DB (bảng ai_prompts) — đổi tên key sau này = phải migrate dữ liệu, nên
 * đặt một lần cho đúng. Nhãn hiển thị đổi thoải mái.
 */
import {
  EXTRACT_SYSTEM_PROMPT,
  VISION_SYSTEM_PROMPT,
  PRODUCT_VISUAL_SYSTEM_PROMPT,
  PRODUCT_LOCK_SYSTEM_PROMPT,
  STAGE_BIBLE_SYSTEM_PROMPT,
  SCRIPT_QA_SYSTEM_PROMPT,
  SHORTEN_SYSTEM_PROMPT,
  BACKGROUND_SYSTEM_PROMPT,
  LIVESTREAM_DEFAULT_NEGATIVE_PROMPT,
  LIVESTREAM_SYSTEM_PROMPT,
  VEO_PROMPT_EVAL_SYSTEM_PROMPT,
  STORYBOARD_PROMPT_SYSTEM_PROMPT,
  REVIEW_SCRIPT_SYSTEM_PROMPT,
  REVIEW_PRODUCT_VISION_SYSTEM_PROMPT,
  REVIEW_BACKGROUND_PROMPT_SYSTEM_PROMPT,
} from './promptDefaults';
import { LIVESTREAM_V2_SYSTEM_PROMPT, V2_FIELD_EXTRACT_SYSTEM_PROMPT } from './promptDefaultsV2';

export interface PromptStepDef {
  key: PromptStepKey;
  /** Nhãn ngắn hiện trên UI. */
  label: string;
  /** Một câu giải thích bước này chạy lúc nào — người dùng cần biết trước khi sửa. */
  hint: string;
  /** Prompt mặc định trong code, tầng cuối cùng khi không có override nào. */
  fallback: string;
  /**
   * false = bước chạy TRƯỚC khi job tồn tại (lúc ingest / form tạo mới) nên không có job để
   * override — chỉ sửa được bản mặc định toàn hệ thống ở /settings/prompts.
   */
  perJob: boolean;
  /** Bộ params gợi ý: 'script' = đủ 11, 'visual' = chỉ thứ tả được bằng hình, 'none' = không gợi ý. */
  params: 'script' | 'visual' | 'none';
}

export const PROMPT_STEPS = [
  {
    key: 'extract',
    label: 'Chuẩn hoá mô tả sản phẩm',
    hint: 'Chạy tự động khi tạo job: đọc text thô (Shopee/nhập tay) → chuẩn hoá tên + mô tả.',
    fallback: EXTRACT_SYSTEM_PROMPT,
    perJob: false,
    params: 'none',
  },
  {
    key: 'vision_screenshot',
    label: 'Đọc ảnh chụp màn hình sản phẩm',
    hint: 'Chạy khi bạn tải ảnh chụp màn hình trang bán (VD link Shopee bị chặn): AI đọc ảnh → điền tên + mô tả.',
    fallback: VISION_SYSTEM_PROMPT,
    perJob: false,
    params: 'none',
  },
  {
    key: 'v2_field_extract',
    label: 'Bóc tách form Shopee (V2)',
    hint: 'Chạy ở form tạo job V2: tách text sản phẩm thô → điền sẵn các ô của form.',
    fallback: V2_FIELD_EXTRACT_SYSTEM_PROMPT,
    perJob: false,
    params: 'none',
  },
  {
    key: 'product_visual',
    label: 'Mô tả ngoại hình sản phẩm (từ ảnh thật)',
    hint: 'Chạy trước khi sinh kịch bản nếu job có ảnh sản phẩm đã chọn: đọc ảnh → tả ngoại hình vật lý để script viết cảnh cầm/thao tác chân thực.',
    fallback: PRODUCT_VISUAL_SYSTEM_PROMPT,
    perJob: true,
    params: 'visual',
  },
  {
    key: 'product_lock',
    label: 'Khoá ngoại hình sản phẩm',
    hint: 'Chỉ job V2. Chốt 1 lần từ ảnh thật rồi ép MỌI cảnh tả đúng món hàng đó (hình dáng, màu, chất liệu, kích thước).',
    fallback: PRODUCT_LOCK_SYSTEM_PROMPT,
    perJob: true,
    params: 'visual',
  },
  {
    key: 'stage_bible',
    label: 'Chốt sân khấu buổi live',
    hint: 'Chốt 1 lần/job: người dẫn, bối cảnh, góc máy, giọng đọc — rồi ép dùng lại cho MỌI sản phẩm. Đây là bước quyết định toàn bộ video trông như thế nào.',
    fallback: STAGE_BIBLE_SYSTEM_PROMPT,
    perJob: true,
    params: 'visual',
  },
  {
    key: 'script',
    label: 'Sinh kịch bản',
    hint: 'Prompt cốt lõi: viết lời thoại + mô tả video (veoPrompt) cho từng đoạn ~8s.',
    // Job V2 dùng bộ prompt AIDA Shopee — resolvePromptForStep nhận fallback riêng, xem ở đó.
    fallback: LIVESTREAM_SYSTEM_PROMPT,
    perJob: true,
    params: 'script',
  },
  {
    key: 'script_qa',
    label: 'Kiểm duyệt kịch bản',
    hint: 'Chỉ job V2. Chạy SAU khi sinh script: soi lỗi vật lý + lời quảng cáo quá đà, chỉ cảnh báo chứ không tự sửa.',
    fallback: SCRIPT_QA_SYSTEM_PROMPT,
    perJob: true,
    params: 'script',
  },
  {
    key: 'shorten',
    label: 'Rút gọn lời thoại quá dài',
    hint: 'Chạy tự động sau khi sinh script: đoạn nào vượt giới hạn số từ thì viết lại ngắn hơn (tối đa 2 vòng).',
    fallback: SHORTEN_SYSTEM_PROMPT,
    perJob: true,
    params: 'none',
  },
  {
    key: 'background',
    label: 'Gen ảnh background',
    hint: 'Dựng 1 khung hình livestream hoàn chỉnh (người dẫn + bối cảnh + sản phẩm) để làm ảnh nền tham chiếu.',
    fallback: BACKGROUND_SYSTEM_PROMPT,
    perJob: true,
    params: 'visual',
  },
  {
    key: 'storyboard_prompt',
    label: 'Viết prompt ảnh storyboard (luồng review)',
    hint: 'Chạy ở Bước 3 luồng Video Review: đọc ảnh sản phẩm + cảnh đã duyệt rồi viết prompt cho model sinh ảnh key frame. Đây là lượt gọi AI TEXT (ra chữ), khác bước "Gen ảnh background" của livestream (ra ảnh).',
    fallback: STORYBOARD_PROMPT_SYSTEM_PROMPT,
    perJob: false,
    params: 'none',
  },
  {
    key: 'veo_prompt_eval',
    label: 'Chấm điểm veoPrompt (luồng review)',
    hint: 'Chạy sau khi sinh kịch bản ở luồng Video Review: soi bộ veoPrompt theo 4 chiều rồi cảnh báo TRƯỚC khi tốn lượt Veo. Không tự sửa prompt.',
    fallback: VEO_PROMPT_EVAL_SYSTEM_PROMPT,
    // Luồng review dùng projectId chứ không phải job slug livestream — không có bản riêng theo job.
    perJob: false,
    params: 'none',
  },
  {
    key: 'review_script',
    label: 'Sinh kịch bản (luồng review)',
    hint: 'Chạy ở Bước 2 luồng Video Review: đọc mô tả sản phẩm + góc kịch bản → viết toàn bộ cảnh (lời thoại + veoPrompt). Đây là prompt quyết định cả video. Phần "Góc kịch bản được chọn" được hệ thống nối thêm vào cuối lúc chạy, không cần viết vào đây.',
    fallback: REVIEW_SCRIPT_SYSTEM_PROMPT,
    // Luồng review dùng projectId, không phải job slug livestream — không có tầng riêng theo job.
    perJob: false,
    params: 'none',
  },
  {
    key: 'review_product_vision',
    label: 'Đọc ảnh sản phẩm thật (luồng review)',
    hint: 'Chạy ở Bước 1 luồng Video Review khi có ảnh sản phẩm: AI vision đọc ảnh → tả màu/chất liệu/hình dáng THẬT, dùng làm nguồn tin cậy cho mọi bước sau.',
    fallback: REVIEW_PRODUCT_VISION_SYSTEM_PROMPT,
    perJob: false,
    params: 'none',
  },
  {
    key: 'review_background_prompt',
    label: 'Viết prompt ảnh bối cảnh (luồng review)',
    hint: 'Chạy ở Bước 3 luồng Video Review: viết prompt cho ảnh nền THUẦN bối cảnh (cấm sản phẩm/người trong khung). Là lượt gọi AI TEXT, khác bước gen ảnh.',
    fallback: REVIEW_BACKGROUND_PROMPT_SYSTEM_PROMPT,
    perJob: false,
    params: 'none',
  },
  {
    key: 'negative_video',
    label: 'Negative prompt (gen video)',
    hint: 'Danh sách thứ CẤM xuất hiện trong video, gửi kèm mỗi lượt gen. Xoá sạch ô = tắt hẳn negative prompt.',
    fallback: LIVESTREAM_DEFAULT_NEGATIVE_PROMPT,
    perJob: true,
    params: 'none',
  },
] as const satisfies readonly PromptStepDef[];

export type PromptStepKey =
  | 'extract'
  | 'vision_screenshot'
  | 'v2_field_extract'
  | 'product_visual'
  | 'product_lock'
  | 'stage_bible'
  | 'script'
  | 'script_qa'
  | 'shorten'
  | 'background'
  | 'negative_video'
  | 'veo_prompt_eval'
  | 'storyboard_prompt'
  | 'review_script'
  | 'review_product_vision'
  | 'review_background_prompt';

const BY_KEY = new Map(PROMPT_STEPS.map((s) => [s.key, s]));

export function getPromptStep(key: PromptStepKey): PromptStepDef {
  const step = BY_KEY.get(key);
  if (!step) throw new Error(`Bước prompt không tồn tại: ${key}`);
  return step;
}

/** true nếu chuỗi là step key hợp lệ — dùng để validate input từ route/query string. */
export function isPromptStepKey(v: unknown): v is PromptStepKey {
  return typeof v === 'string' && BY_KEY.has(v as PromptStepKey);
}

/**
 * Prompt mặc định thực dùng của 1 bước. Riêng bước sinh kịch bản có HAI bản mặc định (V1 và V2
 * AIDA Shopee) — chọn sai bản thì nút "khôi phục mặc định" trả về prompt của phiên bản kia.
 */
export function fallbackFor(key: PromptStepKey, isV2 = false): string {
  if (key === 'script' && isV2) return LIVESTREAM_V2_SYSTEM_PROMPT;
  return getPromptStep(key).fallback;
}
