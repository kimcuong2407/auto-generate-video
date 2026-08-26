/**
 * Background poller server-side: quét mọi job có segment 'generating' và đồng bộ với
 * Google Flow theo chu kỳ — KHÔNG phụ thuộc tab UI mở.
 *
 * Đây là fix gốc cho bug "video đã SUCCESSFUL bên Flow nhưng app kẹt generating rồi
 * timeout": trước đây server chỉ poll khi có tab gọi /status (client-pull), đóng tab lúc
 * gen là mất reconcile. Poller này reconcile done/download độc lập với UI.
 *
 * Ràng buộc: reconcile done + download KHÔNG cần reCAPTCHA (chỉ cần accessToken refresh
 * qua cookie). Nhưng cascade trigger đoạn kế (runChainingForJustDone → generateVideo) cần
 * extension mint reCAPTCHA trên tab labs.google; nếu extension offline thì đoạn kế giữ idle
 * (đã log), đoạn vừa done không bị ảnh hưởng.
 *
 * Singleton qua globalThis để hot-reload (next dev) / gọi register() nhiều lần không tạo
 * nhiều interval — cùng pattern lib/googleFlow/recaptchaState.ts.
 */

import { listJobs, readJob } from './jobStore';
import { syncGeneratingSegments, runChainingForJustDone, resumeStalledJob } from './segmentSync';
import { FLOW_POLL_INTERVAL_MS } from '../constants';
import type { LivestreamJobSummary } from './types';

interface PollerState {
  timer: ReturnType<typeof setInterval> | null;
  /** Chống chồng vòng: bỏ qua nếu vòng trước chưa xong. */
  running: boolean;
}

const globalForPoller = globalThis as unknown as {
  __livestreamPoller?: PollerState;
};

const state: PollerState = globalForPoller.__livestreamPoller ?? {
  timer: null,
  running: false,
};

if (!globalForPoller.__livestreamPoller) {
  globalForPoller.__livestreamPoller = state;
}

/**
 * Job có việc dở dang cần poller ngó tới hay không.
 *
 * Không chỉ 'generating': job mà dây chuyền vừa ĐỨT (đoạn cuối cùng đang chạy bị failed) không còn
 * đoạn generating nào, nhưng vẫn còn hàng loạt đoạn chờ phía sau — bỏ qua thì nó nằm chết vĩnh
 * viễn. `attempts > 0` giới hạn phạm vi vào job người dùng ĐÃ bấm gen (xem resumeStalledJob).
 */
async function jobNeedsAttention(summary: LivestreamJobSummary): Promise<boolean> {
  // listJobs() chỉ trả summary; đọc lại từng job để biết job nào ĐÁNG sync. readJob nhẹ
  // (1 file JSON), số job livestream nhỏ nên chấp nhận được.
  try {
    const job = await readJob(summary.id);
    const segments = job.products.flatMap((p) => p.segments);
    if (segments.some((s) => s.status === 'generating' && s.jobId)) return true;
    const started = segments.some((s) => s.attempts > 0);
    return started && segments.some((s) => s.status === 'idle' || s.status === 'failed');
  } catch {
    return false;
  }
}

async function tick(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const summaries = await listJobs();
    for (const summary of summaries) {
      try {
        if (!(await jobNeedsAttention(summary))) continue;
        const { justDoneSegmentIds } = await syncGeneratingSegments(summary.id);
        if (justDoneSegmentIds.length > 0) {
          console.log(
            `[livestream poller] job ${summary.id}: ${justDoneSegmentIds.length} đoạn vừa done`
          );
          await runChainingForJustDone(summary.id, justDoneSegmentIds);
        }
        // Dây chuyền đứt (không đoạn nào đang chạy mà vẫn còn việc) → nối lại. No-op khi đang chạy.
        await resumeStalledJob(summary.id);
      } catch (err) {
        console.error(`[livestream poller] lỗi khi sync job ${summary.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[livestream poller] lỗi vòng poll:', err);
  } finally {
    state.running = false;
  }
}

/** Khởi động poller (idempotent). Gọi từ instrumentation.ts khi runtime là nodejs. */
export function startBackgroundPoller(): void {
  if (state.timer) return; // đã chạy
  console.log(`[livestream poller] khởi động, chu kỳ ${FLOW_POLL_INTERVAL_MS}ms`);
  state.timer = setInterval(() => {
    void tick();
  }, FLOW_POLL_INTERVAL_MS);
  // Không giữ event loop sống chỉ vì interval này (không chặn process thoát).
  if (typeof state.timer.unref === 'function') state.timer.unref();
}
