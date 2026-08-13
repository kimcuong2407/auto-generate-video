import path from 'node:path';

export const LIVESTREAM_DATA_ROOT =
  process.env.LIVESTREAM_DIR && process.env.LIVESTREAM_DIR.trim() !== ''
    ? process.env.LIVESTREAM_DIR
    : path.join(process.cwd(), 'data', 'livestream');

export const LIVESTREAM_JOB_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Thời lượng chuẩn của 1 đoạn voiceover/video, theo đúng yêu cầu tính năng (~8 giây/đoạn).
export const SEGMENT_TARGET_DURATION_SEC = 8;

// Phần dư dưới mức này khi chia thời lượng mục tiêu cho SEGMENT_TARGET_DURATION_SEC sẽ được
// gộp vào đoạn áp chót thay vì tạo 1 đoạn riêng quá ngắn (Veo yêu cầu tối thiểu 4s/đoạn).
export const MIN_SEGMENT_DURATION_SEC = 4;

export const LINK_FETCH_TIMEOUT_MS = 8000;

// Ngưỡng độ dài text sau khi strip tag HTML — dưới mức này coi là trang SPA rỗng
// (dấu hiệu điển hình của Shopee/các sàn chặn scraping), cần fallback nhập tay.
export const MIN_FETCHED_TEXT_LENGTH = 500;

export const MAX_TEXT_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB / file text-csv

// Số sản phẩm tối đa tách được từ 1 entry (link/file/manual) — chặn trường hợp file
// quá nhiều dòng gây nổ số lượng lệnh gọi AI ngoài kiểm soát.
export const MAX_PRODUCTS_PER_ENTRY = 30;

export const INGEST_CONCURRENCY = 3;

// Timeout cho tier 2 fetch link (headless browser Playwright) — chậm hơn fetch thô nên
// cần ngưỡng riêng, chỉ dùng khi tier 1 (fetch thô) thất bại.
export const BROWSER_FETCH_TIMEOUT_MS = 15000;
