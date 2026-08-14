import path from 'node:path';

export const DATA_ROOT =
  process.env.PROJECTS_DIR && process.env.PROJECTS_DIR.trim() !== ''
    ? process.env.PROJECTS_DIR
    : path.join(process.cwd(), 'data', 'projects');

export const FLOW_MAX_CONCURRENT_JOBS = Number(process.env.FLOW_MAX_CONCURRENT_JOBS || 2);

export const FLOW_JOB_TIMEOUT_MS = Number(process.env.FLOW_JOB_TIMEOUT_MS || 15 * 60 * 1000);

// Chu kỳ background poller quét các job có segment 'generating' và đồng bộ với Google Flow —
// không phụ thuộc tab UI mở. Đủ thưa để không spam Flow, đủ dày để bắt 'done' sớm.
export const FLOW_POLL_INTERVAL_MS = Number(process.env.FLOW_POLL_INTERVAL_MS || 15_000);

export const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB / ảnh
export const MAX_IMAGE_COUNT = 10;

export const PROJECT_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Model ảnh mặc định cho bước Storyboard — sinh qua Orino Flow (flow_generate_image),
// dùng phiên tài khoản Google Flow đã đăng nhập trong app Orino Flow, không cần API key.
export const DEFAULT_STORYBOARD_MODEL = 'flow-image';

// Số ảnh storyboard gen song song tối đa khi bấm "Gen tất cả"
export const STORYBOARD_MAX_CONCURRENT = Number(process.env.STORYBOARD_MAX_CONCURRENT || 2);

// Thời gian tối đa (ms) chờ 1 ảnh storyboard sinh xong qua Orino Flow
export const STORYBOARD_IMAGE_TIMEOUT_MS = Number(process.env.STORYBOARD_IMAGE_TIMEOUT_MS || 120_000);

// Cloudflare R2 — lưu video online. Bật khi đủ 5 biến, thiếu bất kỳ biến nào = tắt (no-op,
// fallback về route stream file local, xem lib/r2/client.ts).
export const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
export const R2_BUCKET = process.env.R2_BUCKET || '';
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
export const R2_ENABLED = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_URL);
