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

import { listProjects, readProject } from './projectStore';
import { syncGeneratingScenes, runChainingForJustDone, resumeStalledProject } from './sceneSync';
import type { ProjectSummary } from '../types';
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

/**
 * Project này có đáng sync vòng này không.
 *
 * KHÔNG chỉ dựa `hasGeneratingScene`: project mà dây chuyền vừa ĐỨT (cảnh đang chạy bị failed)
 * không còn cảnh generating nào, nhưng vẫn còn hàng loạt cảnh chờ phía sau — bỏ qua thì nó nằm
 * chết vĩnh viễn và resumeStalledProject không bao giờ được gọi. `attempts > 0` giới hạn phạm vi
 * vào project người dùng ĐÃ bấm gen, tránh poller tự khởi động mọi project nháp.
 *
 * Port từ lib/livestream/backgroundPoller.ts:jobNeedsAttention.
 */
async function projectNeedsAttention(summary: ProjectSummary): Promise<boolean> {
  // listProjects() chỉ trả summary; đọc lại project để biết cái nào ĐÁNG sync.
  if (summary.hasGeneratingScene) return true;
  try {
    const scenes = (await readProject(summary.id)).script.scenes;
    const started = scenes.some((s) => s.attempts > 0);
    return started && scenes.some((s) => s.status === 'idle' || s.status === 'failed');
  } catch {
    return false;
  }
}

async function tick(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const summaries = await listProjects();
    for (const summary of summaries) {
      if (!(await projectNeedsAttention(summary))) continue;
      try {
        const { justDoneSceneIds } = await syncGeneratingScenes(summary.id);
        if (justDoneSceneIds.length > 0) {
          console.log(
            `[project poller] project ${summary.id}: ${justDoneSceneIds.length} cảnh vừa done`
          );
          await runChainingForJustDone(summary.id, justDoneSceneIds);
        }
        // Nối lại dây chuyền nếu nó đứt — không phụ thuộc có cảnh vừa done hay không.
        await resumeStalledProject(summary.id);
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
