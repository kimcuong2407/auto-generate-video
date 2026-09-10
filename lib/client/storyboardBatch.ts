/**
 * Đọc SSE tiến độ của loạt gen ảnh storyboard/background (Bước 3 luồng Video Review).
 *
 * Tách khỏi runScriptGenerateSSE dù cùng cơ chế parse: loạt gen ảnh phát NHIỀU event tiến độ và
 * caller cần từng cái để vẽ realtime, còn hàm kia chỉ chờ 1 kết quả cuối rồi trả về.
 */
import type { BatchEvent } from '@/lib/data/storyboardBatch';

/** Event thêm ở tầng route khi chính vòng lặp chết (không phải lỗi của 1 ảnh). */
export type BatchStreamEvent = BatchEvent | { type: 'fatal'; message: string };

export async function runStoryboardBatchSSE(
  url: string,
  onEvent: (event: BatchStreamEvent) => void
): Promise<void> {
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  let fatal: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = rawEvent.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let event: BatchStreamEvent;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        // Mảnh JSON vỡ giữa chừng — bỏ qua chứ không làm chết cả loạt đang chạy trên server.
        continue;
      }
      if (event.type === 'done') sawDone = true;
      else if (event.type === 'fatal') fatal = event.message;
      onEvent(event);
    }
  }

  if (fatal) throw new Error(fatal);
  // Mất kết nối giữa chừng KHÔNG có nghĩa loạt gen đã dừng: server vẫn chạy tiếp tới hết (xem
  // runStoryboardBatch). Nói rõ điều đó thay vì để Mr.D tưởng phải bấm lại từ đầu.
  if (!sawDone) {
    throw new Error(
      'Mất kết nối tới server giữa chừng. Loạt gen VẪN đang chạy tiếp ở server — chờ vài phút rồi tải lại trang để xem kết quả, đừng bấm gen lại ngay.'
    );
  }
}
