/**
 * Next.js instrumentation hook — chạy 1 lần khi server khởi động.
 * Dùng để bật background poller đồng bộ trạng thái video livestream với Google Flow,
 * không phụ thuộc tab UI mở (xem lib/livestream/backgroundPoller.ts).
 */
export async function register() {
  // Chỉ chạy trong Node.js runtime (bỏ qua edge runtime).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackgroundPoller } = await import('./lib/livestream/backgroundPoller');
    startBackgroundPoller();
  }
}
