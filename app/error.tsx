'use client';

import { useEffect } from 'react';

// Sau mỗi lần deploy, tab đang mở vẫn xin chunk của build cũ (đã bị thay thế)
// → ChunkLoadError. Reload một lần để lấy HTML/JS của build mới.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError =
    error.name === 'ChunkLoadError' || /Loading chunk .* failed/i.test(error.message);

  useEffect(() => {
    if (!isChunkError) {
      // Build hiện tại tải được → cho phép lần reload sau trong cùng tab.
      sessionStorage.removeItem('chunk-reloaded');
      return;
    }
    // ponytail: cờ chống lặp vô hạn nếu build mới cũng lỗi; sessionStorage đủ cho 1 tab.
    if (sessionStorage.getItem('chunk-reloaded')) return;
    sessionStorage.setItem('chunk-reloaded', '1');
    location.reload();
  }, [isChunkError]);

  if (isChunkError) {
    return <p style={{ padding: 24 }}>Đang tải lại phiên bản mới…</p>;
  }


  return (
    <div style={{ padding: 24 }}>
      <h2>Đã xảy ra lỗi</h2>
      <p style={{ color: '#666' }}>{error.message}</p>
      <button onClick={reset} style={{ marginTop: 12 }}>
        Thử lại
      </button>
    </div>
  );
}
