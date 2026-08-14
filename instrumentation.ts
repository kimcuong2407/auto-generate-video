/**
 * Next.js instrumentation hook — chạy 1 lần khi server khởi động.
 * Bật các background poller đồng bộ trạng thái video với Google Flow, không phụ thuộc tab
 * UI mở:
 * - livestream (xem lib/livestream/backgroundPoller.ts)
 * - project video review (xem lib/data/backgroundPoller.ts)
 */
export async function register() {
  // Chỉ chạy trong Node.js runtime (bỏ qua edge runtime).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackgroundPoller } = await import('./lib/livestream/backgroundPoller');
    startBackgroundPoller();

    const { startProjectPoller } = await import('./lib/data/backgroundPoller');
    startProjectPoller();
  }
}
