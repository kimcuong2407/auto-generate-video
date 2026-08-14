/**
 * Background poller server-side cho PROJECT VIDEO: quét mọi project có scene 'generating' và
 * đồng bộ với Google Flow theo chu kỳ — KHÔNG phụ thuộc tab UI mở.
 *
 * Đây là fix gốc cho bug "video đã SUCCESSFUL bên Flow nhưng app kẹt generating / không lưu":
 * trước đây server chỉ poll khi có tab gọi /status (client-pull), đóng tab lúc gen là mất
 * reconcile. Poller này reconcile done/download/upload-R2 độc lập với UI.
 *
 * Ràng buộc: reconcile done + download + upload R2 KHÔNG cần reCAPTCHA (chỉ cần accessToken
 * refresh qua cookie). Cascade trigger scene kế (runChainingForJustDone → generateVideo) cần
 * extension mint reCAPTCHA trên tab labs.google; nếu extension offline thì scene kế giữ idle
 * (đã log), scene vừa done không bị ảnh hưởng.
 *
 * Singleton qua globalThis để hot-reload (next dev) / gọi register() nhiều lần không tạo
 * nhiều interval — cùng pattern lib/livestream/backgroundPoller.ts.
 */

import { listProjects } from './projectStore';
import { syncGeneratingScenes, runChainingForJustDone } from './sceneSync';
import { FLOW_POLL_INTERVAL_MS } from '../constants';

interface PollerState {
  timer: ReturnType<typeof setInterval> | null;
  /** Chống chồng vòng: bỏ qua nếu vòng trước chưa xong. */
  running: boolean;
}

const globalForPoller = globalThis as unknown as {
  __projectPoller?: PollerState;
};

const state: PollerState = globalForPoller.__projectPoller ?? {
  timer: null,
  running: false,
};

if (!globalForPoller.__projectPoller) {
  globalForPoller.__projectPoller = state;
}

async function tick(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const summaries = await listProjects();
    for (const summary of summaries) {
      // listProjects() đã tính sẵn hasGeneratingScene → chỉ sync project thật sự cần.
      if (!summary.hasGeneratingScene) continue;
      try {
        const { justDoneSceneIds } = await syncGeneratingScenes(summary.id);
        if (justDoneSceneIds.length > 0) {
          console.log(
            `[project poller] project ${summary.id}: ${justDoneSceneIds.length} cảnh vừa done`
          );
          await runChainingForJustDone(summary.id, justDoneSceneIds);
        }
      } catch (err) {
        console.error(`[project poller] lỗi khi sync project ${summary.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[project poller] lỗi vòng poll:', err);
  } finally {
    state.running = false;
  }
}

/** Khởi động poller (idempotent). Gọi từ instrumentation.ts khi runtime là nodejs. */
export function startProjectPoller(): void {
  if (state.timer) return; // đã chạy
  console.log(`[project poller] khởi động, chu kỳ ${FLOW_POLL_INTERVAL_MS}ms`);
  state.timer = setInterval(() => {
    void tick();
  }, FLOW_POLL_INTERVAL_MS);
  // Không giữ event loop sống chỉ vì interval này (không chặn process thoát).
  if (typeof state.timer.unref === 'function') state.timer.unref();
}
