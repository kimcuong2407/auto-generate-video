/**
 * Chạy MỘT LOẠT gen ảnh (storyboard hoặc background) TUẦN TỰ, có retry, phát sự kiện tiến độ.
 *
 * Vì sao tuần tự thay vì song song như trước (runWithConcurrency, 2 luồng): Google Flow tính hạn
 * mức theo tài khoản, hai lượt gen cùng lúc dễ ăn 429 rồi cả hai cùng hỏng — retry lúc đó lại
 * càng dồn thêm tải. Chạy một ảnh một lúc thì mỗi lỗi là lỗi riêng của ảnh đó, retry sạch sẽ, và
 * tiến độ đọc được đúng thứ tự.
 *
 * Vì sao phát sự kiện (callback) thay vì trả về mảng kết quả ở cuối: loạt 8 ảnh chạy vài phút,
 * trả một cục ở cuối nghĩa là UI đứng im suốt thời gian đó. Route bọc callback này thành SSE để
 * Mr.D thấy từng ảnh xong ngay lúc nó xong.
 *
 * KHÔNG tự viết lại phần gọi Flow: dùng đúng triggerStoryboardGeneration/triggerBackgroundGeneration
 * mà nút "Gen" của từng ảnh vẫn dùng — hai đường phải cho ra cùng một kết quả, tách ra là sớm muộn
 * lệch nhau (một bên có ảnh ref, một bên quên).
 */
import { STORYBOARD_MAX_ATTEMPTS, STORYBOARD_RETRY_DELAY_MS } from '../constants';
import type { TriggerStoryboardResult } from './storyboardGenerate';

export type BatchEvent =
  /** Bắt đầu cả loạt — UI biết tổng số để vẽ thanh tiến độ. */
  | { type: 'start'; total: number; sceneIds: string[] }
  /** Bắt đầu MỘT ảnh (kể cả lần thử lại). `attempt` đếm từ 1. */
  | { type: 'image-start'; sceneId: string; index: number; attempt: number; maxAttempts: number }
  /** Một lần thử hỏng nhưng CÒN lượt thử — nêu rõ lỗi và thời gian chờ trước khi thử lại. */
  | { type: 'image-retry'; sceneId: string; index: number; attempt: number; error: string; waitMs: number }
  /** Ảnh xong hẳn: ok=false nghĩa là đã hết lượt thử. */
  | { type: 'image-done'; sceneId: string; index: number; ok: boolean; attempts: number; error?: string }
  /** Cả loạt kết thúc. */
  | { type: 'done'; total: number; succeeded: number; failed: number };

export interface BatchTarget {
  sceneId: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Chạy loạt gen tuần tự.
 *
 * @param trigger Hàm gen 1 ảnh — nhận sceneId, trả về ok/error. Đã tự cập nhật project.json.
 * @param onEvent Nhận sự kiện tiến độ. Lỗi ném ra từ đây bị NUỐT: client đóng tab giữa chừng thì
 *                controller.enqueue ném, mà loạt gen đang chạy dở không nên chết theo — ảnh đang
 *                gen vẫn phải được ghi kết quả vào project.json để lần mở lại còn thấy.
 */
export async function runStoryboardBatch(
  targets: BatchTarget[],
  trigger: (sceneId: string) => Promise<TriggerStoryboardResult>,
  onEvent: (event: BatchEvent) => void
): Promise<{ succeeded: string[]; failed: { sceneId: string; error: string }[] }> {
  const emit = (event: BatchEvent) => {
    try {
      onEvent(event);
    } catch {
      // Client đã ngắt kết nối — vẫn chạy tiếp cho hết loạt, xem doc-comment tham số.
    }
  };

  const succeeded: string[] = [];
  const failed: { sceneId: string; error: string }[] = [];

  emit({ type: 'start', total: targets.length, sceneIds: targets.map((t) => t.sceneId) });

  for (let index = 0; index < targets.length; index++) {
    const { sceneId } = targets[index];
    let lastError = 'Lỗi không xác định';
    let attempt = 0;

    while (attempt < STORYBOARD_MAX_ATTEMPTS) {
      attempt += 1;
      emit({
        type: 'image-start',
        sceneId,
        index,
        attempt,
        maxAttempts: STORYBOARD_MAX_ATTEMPTS,
      });

      const result = await trigger(sceneId);
      if (result.ok) {
        succeeded.push(sceneId);
        emit({ type: 'image-done', sceneId, index, ok: true, attempts: attempt });
        break;
      }

      lastError = result.error || 'Lỗi không xác định';

      // Người dùng bấm Dừng → tôn trọng ngay, retry lúc này là chống lại chính lệnh vừa bấm.
      // Cùng lý do với ảnh đang chạy sẵn: nó thuộc một lượt gen khác, không phải việc của loạt này.
      const abortNow =
        lastError.includes('Đã dừng theo yêu cầu') || lastError === 'Ảnh đang generating';

      if (abortNow || attempt >= STORYBOARD_MAX_ATTEMPTS) {
        failed.push({ sceneId, error: lastError });
        emit({
          type: 'image-done',
          sceneId,
          index,
          ok: false,
          attempts: attempt,
          error: lastError,
        });
        break;
      }

      // Backoff tăng dần: lần chờ thứ n dài gấp n lần. Đập lại ngay vào API vừa trả 429 thì
      // gần như chắc chắn lại 429, tốn thêm một lượt thử vô ích.
      const waitMs = STORYBOARD_RETRY_DELAY_MS * attempt;
      emit({ type: 'image-retry', sceneId, index, attempt, error: lastError, waitMs });
      console.warn(
        `[storyboard-batch] ${sceneId} thử ${attempt}/${STORYBOARD_MAX_ATTEMPTS} lỗi: ${lastError} — chờ ${waitMs}ms rồi thử lại`
      );
      await sleep(waitMs);
    }
  }

  emit({ type: 'done', total: targets.length, succeeded: succeeded.length, failed: failed.length });
  return { succeeded, failed };
}
