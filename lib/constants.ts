import path from 'node:path';

export const DATA_ROOT =
  process.env.PROJECTS_DIR && process.env.PROJECTS_DIR.trim() !== ''
    ? process.env.PROJECTS_DIR
    : path.join(process.cwd(), 'data', 'projects');

export const FLOW_MAX_CONCURRENT_JOBS = Number(process.env.FLOW_MAX_CONCURRENT_JOBS || 2);

export const FLOW_JOB_TIMEOUT_MS = Number(process.env.FLOW_JOB_TIMEOUT_MS || 15 * 60 * 1000);
/**
 * Số lần tự động thử lại tối đa cho 1 đoạn video bị lỗi, tính theo `segment.attempts`.
 *
 * Vì sao cần: cascade chỉ trigger đoạn kế khi nó 'idle' nên 1 đoạn 'failed' vì lỗi TẠM THỜI
 * (mint reCAPTCHA token timeout, Flow 5xx, mạng chập chờn) làm đứt dây chuyền vĩnh viễn — các
 * đoạn sau nằm im dù người dùng đã bấm gen cả block. Cho retry tự động, nhưng có trần để lỗi
 * THẬT (prompt sai, quota hết) không quay vòng vô hạn đốt quota Veo.
 */
export const MAX_SEGMENT_AUTO_RETRIES = 3;


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
