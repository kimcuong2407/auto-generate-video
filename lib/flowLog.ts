/**
 * Log dây chuyền gen video ra FILE, song song với console.
 *
 * Vì sao cần file riêng: console của `next dev` bị cuộn mất và trộn lẫn log build/HMR, nên khi
 * điều tra "vì sao dây chuyền đứng" thì không truy lại được. File này chỉ chứa sự kiện của
 * pipeline, đọc bằng `tail -f data/logs/flow.log`.
 *
 * Ghi đồng bộ (appendFileSync) có chủ đích: các điểm log nằm trong mutator updateProject và
 * trong cascade — ghi bất đồng bộ thì thứ tự dòng không còn phản ánh thứ tự sự kiện, mà thứ tự
 * chính là thứ cần đọc khi truy vết dây chuyền.
 */

import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.join(process.cwd(), 'data', 'logs');
const LOG_PATH = path.join(LOG_DIR, 'flow.log');

/** Trần 10MB: pipeline chạy cả ngày thì file phình; xoay 1 vòng là đủ để giữ phiên điều tra gần nhất. */
const MAX_BYTES = 10 * 1024 * 1024;

function rotateIfNeeded(): void {
  try {
    if (fs.statSync(LOG_PATH).size > MAX_BYTES) {
      fs.renameSync(LOG_PATH, `${LOG_PATH}.1`);
    }
  } catch {
    // Chưa có file — lần ghi đầu tiên.
  }
}

/**
 * Ghi 1 dòng log kèm timestamp ISO.
 *
 * `data` là các số liệu quyết định (đã chờ bao lâu, ngưỡng bao nhiêu, Google/MCP trả gì) —
 * log "đã xảy ra" mà thiếu số liệu thì lần sau vẫn phải đoán.
 */
export function flowLog(tag: string, message: string, data?: Record<string, unknown>): void {
  const parts = [new Date().toISOString(), `[${tag}]`, message];
  if (data && Object.keys(data).length > 0) {
    parts.push(
      Object.entries(data)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
    );
  }
  const line = parts.join(' ');
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(LOG_PATH, line + '\n', 'utf-8');
  } catch (err) {
    // Không để lỗi ghi log giết pipeline — log là phụ trợ, gen video mới là việc chính.
    console.error('[flowLog] không ghi được file log:', (err as Error).message);
  }
}

export const FLOW_LOG_PATH = LOG_PATH;
