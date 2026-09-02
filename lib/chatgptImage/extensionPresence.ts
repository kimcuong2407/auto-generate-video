/**
 * Theo dõi extension gen ảnh (extension-chatgpt/) còn sống hay không.
 *
 * Vì sao cần: job `source='extension'` chỉ chạy được khi Chrome của người dùng đang mở kèm
 * extension. Không biết điều đó thì `generateChatgptImage()` cứ enqueue rồi ngồi chờ hết 11
 * phút timeout mới báo lỗi — trong khi nguyên nhân (chưa mở Chrome) biết ngay từ giây đầu.
 *
 * In-memory, không persist: đây là trạng thái "ngay lúc này", restart server thì coi như chưa
 * biết gì và chờ nhịp poll kế — đúng ngữ nghĩa mong muốn. Cùng cách làm với
 * lib/googleFlow/recaptchaState.ts.
 */

interface PresenceState {
  lastPollAt: number;
}

// Singleton qua globalThis: next dev hot-reload tạo module instance mới, mất mốc thời gian thì
// UI báo offline oan dù extension vẫn đang poll đều.
const globalForPresence = globalThis as unknown as { __chatgptExtPresence?: PresenceState };
const state: PresenceState = globalForPresence.__chatgptExtPresence ?? { lastPollAt: 0 };
if (!globalForPresence.__chatgptExtPresence) globalForPresence.__chatgptExtPresence = state;

/**
 * Ngưỡng coi extension là offline — 3 phút, lấy đúng con số đã đúc kết ở
 * lib/googleFlow/recaptcha.ts (POLLER_STALE_MS).
 *
 * KHÔNG được đặt gần nhịp tick (1.5s) của content script: Chrome throttle setInterval trong
 * tab nền xuống >=60s/lần, và service worker MV3 bị kill sau ~30s idle. Ngưỡng ngắn thì chỉ
 * cần chuyển tab vài phút là báo offline oan dù extension vẫn khoẻ. Alarm keepalive poll mỗi
 * 1 phút → 3 phút cho phép lỡ 2 nhịp liên tiếp trước khi kết luận là chết.
 */
export const EXTENSION_STALE_MS = 180_000;

/** Extension vừa gọi GET /api/chatgpt-image/worker — đánh dấu còn sống. */
export function markExtensionPolled(): void {
  state.lastPollAt = Date.now();
}

/**
 * Extension có đang online không.
 *
 * `lastPollAt === 0` (server vừa khởi động, chưa nhận nhịp nào) → false. Không "cho qua" ở
 * trường hợp này: nói offline thì người dùng mở Chrome ra là xong, còn nói online rồi để job
 * treo 11 phút mới lộ ra là tệ hơn hẳn.
 */
export function isExtensionOnline(now: number = Date.now()): boolean {
  if (state.lastPollAt === 0) return false;
  return now - state.lastPollAt < EXTENSION_STALE_MS;
}

/** Mốc poll gần nhất (ms epoch), 0 = chưa bao giờ. Dùng để hiện "x giây trước" trên UI. */
export function lastExtensionPollAt(): number {
  return state.lastPollAt;
}

/** Chỉ dùng cho self-check — đặt lại mốc để test được các ngưỡng. */
export const __testables = {
  setLastPollAt(ms: number): void {
    state.lastPollAt = ms;
  },
};
