/**
 * Worker xử lý queue gen ảnh ChatGPT.
 *
 * Chạy TUẦN TỰ, 1 job tại 1 thời điểm cho toàn app (không phải per-account như doc mô tả).
 * Lý do: hiện chỉ có 1 profile Chromium thật sự dùng được, và mở nhiều Chromium song song
 * trên VPS vừa tốn RAM vừa tăng nguy cơ ChatGPT thấy bất thường. Khi nào có nhiều account
 * thật thì đổi cờ `busy` thành map theo accountId — chỗ cần sửa gói gọn trong file này.
 *
 * ponytail: khoá toàn cục 1 job/lần; chuyển sang khoá theo account khi có nhiều account.
 */

import { claimNextJob, finishJob, failJob, reapStaleJobs } from './jobStore';
import { getActiveAccount } from './accountStore';
import { generateOneImage, ChatgptLoginRequiredError } from './runner';
import { DB_ENABLED } from '../db/config';

interface WorkerState {
  busy: boolean;
  timer: ReturnType<typeof setInterval> | null;
}

// Singleton qua globalThis để hot-reload (next dev) không sinh nhiều vòng lặp — cùng pattern
// lib/livestream/backgroundPoller.ts.
const globalForWorker = globalThis as unknown as { __chatgptImageWorker?: WorkerState };
const state: WorkerState = globalForWorker.__chatgptImageWorker ?? { busy: false, timer: null };
if (!globalForWorker.__chatgptImageWorker) globalForWorker.__chatgptImageWorker = state;

/** Job 'running' quá ngưỡng này = tàn dư của lần restart giữa chừng, không phải đang chạy thật. */
const STALE_RUNNING_MS = 15 * 60_000;
const POLL_INTERVAL_MS = 5_000;

/**
 * Xử lý tối đa 1 job. Trả true nếu có làm việc gì đó.
 * An toàn khi gọi chồng: cờ `busy` chặn 2 lượt cùng mở browser trên 1 profile (Chromium khoá
 * userDataDir, lượt thứ 2 sẽ chết ngay).
 */
export async function runQueueOnce(): Promise<boolean> {
  if (state.busy || !DB_ENABLED) return false;
  const account = getActiveAccount();
  if (!account) return false;

  state.busy = true;
  try {
    const job = await claimNextJob(account.id);
    if (!job) return false;

    try {
      const imagePath = await generateOneImage({
        accountId: account.id,
        prompt: job.prompt,
        aspect: job.aspect,
        refImagePaths: job.refImagePaths,
      });
      await finishJob(job.id, imagePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Phiên chết là lỗi fatal (doc mục 6): account đã bị markNeedsLogin trong runner, retry
      // chỉ mở lại browser để gặp đúng màn hình login. Fail thẳng để người dùng thấy lý do.
      if (err instanceof ChatgptLoginRequiredError) await failJob(job.id, msg);
      else await failJob(job.id, msg);
    }
    return true;
  } finally {
    state.busy = false;
  }
}

/** Khởi động vòng poll nền — gọi từ instrumentation.ts. */
export function startChatgptImageWorker(): void {
  if (state.timer || !DB_ENABLED) return;
  void reapStaleJobs(STALE_RUNNING_MS).catch(() => {});
  state.timer = setInterval(() => {
    void runQueueOnce().catch((err) => console.error('[chatgpt-image-worker]', err));
  }, POLL_INTERVAL_MS);
  // Không giữ process sống chỉ vì vòng poll này.
  state.timer.unref?.();
}
