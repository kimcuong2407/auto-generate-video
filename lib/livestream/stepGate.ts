/**
 * Cổng dừng-chờ giữa các bước AI trong MỘT lượt sinh script (chế độ debug).
 *
 * Vì sao cần: 5 bước AI (product_visual → product_lock → stage_bible → script → shorten →
 * script_qa) chạy ngầm bên trong CÙNG một request SSE. Muốn Mr.D duyệt từng bước thì phải cho
 * stream đứng lại giữa chừng — SSE là một chiều nên câu trả lời "duyệt" đi đường khác:
 * POST /script/generate/confirm-step, rồi resolve promise mà stream đang await.
 *
 * Vì sao Map trong RAM chứ không lưu DB: phiên chờ chỉ sống đúng bằng đời request đang mở. Server
 * restart giữa chừng thì request đó đã đứt, phiên có lưu cũng vô nghĩa.
 *
 * ponytail: single-process Map. Chạy nhiều instance (PM2 cluster) thì confirm có thể rơi vào
 * instance không giữ request — chuyển sang Redis pub/sub nếu sau này scale ngang.
 */

/** Bước đang chờ duyệt + prompt thật sắp gửi, để UI hiện đúng thứ server sắp làm. */
export interface PendingStep {
  gateId: string;
  stepKey: string;
  label: string;
  /** Chuỗi thật sắp gửi cho AI. Rỗng = bước này không dựng được preview (đã ghi ở `note`). */
  prompt: string;
  note?: string;
}

interface Waiter {
  resolve: (decision: 'run' | 'skip') => void;
  step: PendingStep;
}

const WAITERS = new Map<string, Waiter>();

/** Bỏ chờ sau 10 phút — không ai duyệt thì đừng giữ request mở vô hạn. */
const GATE_TIMEOUT_MS = 10 * 60 * 1000;

let seq = 0;

/**
 * Dừng stream lại chờ Mr.D duyệt. Trả 'run' = chạy bước, 'skip' = bỏ qua bước này.
 * Hết giờ chờ coi như 'skip' để request tự thoát thay vì treo.
 */
export function waitForConfirm(step: Omit<PendingStep, 'gateId'>): {
  gateId: string;
  promise: Promise<'run' | 'skip'>;
} {
  seq += 1;
  const gateId = `gate-${seq}-${process.pid}`;
  const full: PendingStep = { ...step, gateId };
  const promise = new Promise<'run' | 'skip'>((resolve) => {
    const timer = setTimeout(() => {
      WAITERS.delete(gateId);
      resolve('skip');
    }, GATE_TIMEOUT_MS);
    WAITERS.set(gateId, {
      step: full,
      resolve: (decision) => {
        clearTimeout(timer);
        WAITERS.delete(gateId);
        resolve(decision);
      },
    });
  });
  return { gateId, promise };
}

/** Trả lời một cổng đang chờ. false = gateId không tồn tại (hết giờ, hoặc request đã đứt). */
export function resolveGate(gateId: string, decision: 'run' | 'skip'): boolean {
  const waiter = WAITERS.get(gateId);
  if (!waiter) return false;
  waiter.resolve(decision);
  return true;
}

/** Huỷ mọi cổng còn chờ của một request đang đóng — tránh rò waiter khi client ngắt kết nối. */
export function abandonGates(gateIds: string[]): void {
  for (const id of gateIds) {
    const waiter = WAITERS.get(id);
    if (waiter) waiter.resolve('skip');
  }
}
