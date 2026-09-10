import path from 'node:path';

export const DATA_ROOT =
  process.env.PROJECTS_DIR && process.env.PROJECTS_DIR.trim() !== ''
    ? process.env.PROJECTS_DIR
    : path.join(process.cwd(), 'data', 'projects');

export const FLOW_MAX_CONCURRENT_JOBS = Number(process.env.FLOW_MAX_CONCURRENT_JOBS || 2);

export const FLOW_JOB_TIMEOUT_MS = Number(process.env.FLOW_JOB_TIMEOUT_MS || 15 * 60 * 1000);

/**
 * Trần TUYỆT ĐỐI cho 1 job Flow: bỏ cuộc kể cả khi Google vẫn báo 'running'.
 *
 * Khác FLOW_JOB_TIMEOUT_MS (timeout mềm, chỉ áp khi KHÔNG biết Flow đang ra sao — nhánh poll
 * lỗi): trần này áp cho job mà Flow khẳng định vẫn đang chạy. Cần nó vì 'running' có thể là
 * trạng thái vĩnh viễn khi job kẹt phía Google; không có trần thì đoạn nằm 'generating' mãi.
 *
 * XÁC MINH 2026-09-09: Veo tier low_priority render lâu hơn 15 phút là bình thường, nên timeout
 * mềm KHÔNG được dùng để giết job đang chạy (xem ghi chú tại segmentSync.syncOneSegment).
 *
 * 30 phút = gấp đôi timeout mềm cũ (mốc đã chứng minh là giết oan). CHƯA có số đo thời gian
 * render thật của tier low_priority để chọn chính xác hơn — log '[flow poll]' ở segmentSync ghi
 * lại tuổi job mỗi vòng poll, đủ vài job done là chỉnh lại con số này theo dữ liệu thật thay
 * vì phỏng đoán.
 */
export const FLOW_JOB_HARD_TIMEOUT_MS = Number(
  process.env.FLOW_JOB_HARD_TIMEOUT_MS || 30 * 60 * 1000
);
/**
 * Số lần tự động thử lại tối đa cho 1 đoạn video bị lỗi, tính theo `segment.attempts`.
 *
 * Vì sao cần: cascade chỉ trigger đoạn kế khi nó 'idle' nên 1 đoạn 'failed' vì lỗi TẠM THỜI
 * (mint reCAPTCHA token timeout, Flow 5xx, mạng chập chờn) làm đứt dây chuyền vĩnh viễn — các
 * đoạn sau nằm im dù người dùng đã bấm gen cả block. Cho retry tự động, nhưng có trần để lỗi
 * THẬT (prompt sai, quota hết) không quay vòng vô hạn đốt quota Veo.
 */
export const MAX_SEGMENT_AUTO_RETRIES = 3;

/**
 * Khoảng lùi tối thiểu trước khi tự thử lại 1 đoạn vừa lỗi (ms). Poller chạy mỗi
 * FLOW_POLL_INTERVAL_MS (15s) — không có backoff thì đoạn lỗi vì hết quota Veo sẽ bị đập lại 240
 * lần/giờ, đốt log và dập vào API Google suốt thời gian chờ quota reset.
 */
export const SEGMENT_RETRY_BACKOFF_MS = Number(process.env.SEGMENT_RETRY_BACKOFF_MS || 5 * 60 * 1000);


// Chu kỳ background poller quét các job có segment 'generating' và đồng bộ với Google Flow —
// không phụ thuộc tab UI mở. Đủ thưa để không spam Flow, đủ dày để bắt 'done' sớm.
export const FLOW_POLL_INTERVAL_MS = Number(process.env.FLOW_POLL_INTERVAL_MS || 15_000);

export const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB / ảnh
export const MAX_IMAGE_COUNT = 10;

export const PROJECT_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Re-export từ lib/imageModels.ts (file tách riêng, không import 'node:path') để mọi call-site
// server hiện có (`from '@/lib/constants'` / `'../constants'`) không phải sửa import.
export { DEFAULT_STORYBOARD_MODEL, IMAGE_MODEL_OPTIONS } from './imageModels';

// Số ảnh storyboard gen song song tối đa khi bấm "Gen tất cả"
export const STORYBOARD_MAX_CONCURRENT = Number(process.env.STORYBOARD_MAX_CONCURRENT || 2);

/**
 * Số lần thử tối đa cho MỘT ảnh trong loạt gen tuần tự (lần đầu + các lần retry).
 *
 * Vì sao cần retry tự động: lỗi hay gặp nhất của flow_generate_image là lỗi tạm thời (timeout,
 * 429, token hết hạn giữa chừng) — thử lại thường ăn ngay. Không retry thì cả loạt 8 ảnh chỉ cần
 * 1 ảnh vấp mạng là Mr.D phải ngồi bấm Retry tay từng cái.
 *
 * Vì sao chặn ở 3 chứ không thử mãi: lỗi do prompt bị chặn nội dung thì thử bao nhiêu lần cũng
 * hỏng, mỗi lần vẫn tốn một lượt gọi Flow thật.
 */
export const STORYBOARD_MAX_ATTEMPTS = Number(process.env.STORYBOARD_MAX_ATTEMPTS || 3);

/**
 * Nghỉ giữa 2 lần thử của cùng 1 ảnh (ms), tăng dần theo số lần đã thử (1x, 2x...).
 * Retry ngay lập tức vào một API vừa trả 429 gần như chắc chắn lại 429.
 */
export const STORYBOARD_RETRY_DELAY_MS = Number(process.env.STORYBOARD_RETRY_DELAY_MS || 3000);

// Thời gian tối đa (ms) chờ 1 ảnh storyboard sinh xong qua Google Flow
export const STORYBOARD_IMAGE_TIMEOUT_MS = Number(process.env.STORYBOARD_IMAGE_TIMEOUT_MS || 120_000);

// Cloudflare R2 — lưu video online. Bật khi đủ 5 biến, thiếu bất kỳ biến nào = tắt (no-op,
// fallback về route stream file local, xem lib/r2/client.ts).
export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
export const R2_BUCKET = process.env.R2_BUCKET || '';
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
export const R2_ENABLED = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_URL);
