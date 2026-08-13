// Content script trên tab labs.google (isolated world). Sống theo vòng đời tab.
//
// CSP của labs.google chặn content script fetch cross-origin tới localhost và chặn
// inject <script> từ chrome-extension://. Nên content script KHÔNG tự fetch/mint —
// nó chỉ giữ NHỊP: mỗi 1.5s gửi 'POLL_TOKENS' cho service worker. Service worker
// (không bị CSP của trang ràng buộc, có host_permissions localhost) mới fetch
// /token-request + mint token qua executeScript world:MAIN.
//
// Vai trò của content script: đánh thức service worker đều đặn (SW MV3 hay bị kill,
// nhưng chrome.runtime.sendMessage sẽ wake nó dậy) và neo theo tab labs.google đang mở.

(function () {
  const POLL_INTERVAL_MS = 1500;

  let n = 0;
  let timerId = null;

  // Content script "orphan": sau khi reload extension ở chrome://extensions, content
  // script cũ trên tab đang mở mất kết nối với extension context mới → mọi
  // chrome.runtime.* throw "Extension context invalidated". Lúc này CHỈ F5 tab mới cứu
  // được → dừng vòng lặp (thay vì spam lỗi mỗi 1.5s) và báo user reload trang.
  function stopWithOrphanNotice() {
    if (timerId != null) clearInterval(timerId);
    timerId = null;
    console.warn(
      '[flow-grabber] Extension context invalidated — content script cũ đã orphan. ' +
        'HÃY TẢI LẠI (F5) tab labs.google này để nạp content script mới.'
    );
  }

  function tick() {
    n += 1;
    // chrome.runtime bị vô hiệu khi context invalidated → check trước khi gọi.
    if (!chrome.runtime || !chrome.runtime.id) {
      stopWithOrphanNotice();
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'POLL_TOKENS' }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (/context invalidated/i.test(err.message || '')) {
            stopWithOrphanNotice();
          } else {
            console.warn('[flow-grabber] tick #' + n + ' sendMessage lỗi:', err.message);
          }
        } else {
          console.log('[flow-grabber] tick #' + n + ' SW trả lời:', resp);
        }
      });
    } catch (e) {
      if (/context invalidated/i.test((e && e.message) || '')) {
        stopWithOrphanNotice();
      } else {
        console.warn('[flow-grabber] tick #' + n + ' throw:', e && e.message);
      }
    }
  }

  timerId = setInterval(tick, POLL_INTERVAL_MS);
  tick();
  console.log('[flow-grabber] content script tick loop đã khởi động (SW fetch/mint)');
})();
