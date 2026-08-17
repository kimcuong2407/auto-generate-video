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
    // Warm-up pool MariaDB trước khi start poller (poller đọc/ghi qua DB). Bọc try/catch để
    // không chặn boot nếu DB tạm chưa sẵn sàng — getDb() sẽ tự tạo lại pool ở lần gọi sau.
    try {
      const { DB_ENABLED } = await import('./lib/db/config');
      if (DB_ENABLED) {
        const { getDb } = await import('./lib/db/client');
        getDb();
      }
    } catch (err) {
      console.error('[instrumentation] Không warm-up được pool DB:', err);
    }

    const { startBackgroundPoller } = await import('./lib/livestream/backgroundPoller');
    startBackgroundPoller();

    const { startProjectPoller } = await import('./lib/data/backgroundPoller');
    startProjectPoller();
  }
}
