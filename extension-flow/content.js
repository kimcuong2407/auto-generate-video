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

  // background.js nạp lại file này vào tab đang mở mỗi lần SW load (xem reinjectContentScript).
  // Instance cũ có thể vẫn còn timer sống → phải dọn, tránh 2 vòng tick chồng nhau spam SW.
  //
  // KHÔNG dùng `window.__flowGrabberTimerId`: content script chạy trong isolated world,
  // mỗi lần inject lại là một world SẠCH — instance mới không bao giờ nhìn thấy biến của
  // instance cũ, nên đoạn dọn dẹp cũ thực tế chưa từng chạy. Kênh duy nhất cả hai instance
  // cùng thấy là DOM của trang, nên phát tín hiệu "dừng" qua một CustomEvent.
  const STOP_EVENT = '__flowGrabberStop';
  document.dispatchEvent(new CustomEvent(STOP_EVENT));

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
      '[flow-grabber] Extension context invalidated — instance này đã orphan và vừa tự dừng. ' +
        'Đây là log BÌNH THƯỜNG sau khi reload extension, không phải lỗi. ' +
        'Service worker mới sẽ nạp lại content script (ngay khi load, và lặp lại mỗi 1 phút ' +
        'qua alarm keepalive) → sẽ thấy "tick loop đã khởi động" trong vòng ~60s. ' +
        'Chỉ cần F5 tab nếu quá 60s vẫn im lặng.'
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

  // Instance sau sẽ dispatch STOP_EVENT → instance này tự tắt, nhường chỗ.
  document.addEventListener(STOP_EVENT, function onStop() {
    document.removeEventListener(STOP_EVENT, onStop);
    if (timerId != null) clearInterval(timerId);
    timerId = null;
    console.log('[flow-grabber] instance cũ nhường chỗ cho instance mới');
  });

  timerId = setInterval(tick, POLL_INTERVAL_MS);
  tick();
  console.log('[flow-grabber] content script tick loop đã khởi động (SW fetch/mint)');
})();
