// Content script trên tab chatgpt.com (isolated world). Sống theo vòng đời tab.
//
// Nó KHÔNG tự gen ảnh và không tự fetch: mọi việc nặng nằm ở service worker (fetch job về,
// executeScript vào MAIN world). Content script chỉ giữ NHỊP — mỗi 1.5s gửi 'POLL_JOBS' cho SW.
//
// Vì sao cần: service worker MV3 bị Chrome kill sau ~30s idle, mà chrome.runtime.sendMessage
// từ content script thì đánh thức nó dậy. Không có nhịp này thì job nằm chờ tới nhịp alarm
// keepalive (1 phút) mới được ngó tới.
//
// Cùng khuôn với extension-flow/content.js, kể cả các bài học đã trả giá ở đó.

(function () {
  const POLL_INTERVAL_MS = 1500;

  // background.js có thể nạp lại file này vào tab đang mở mỗi lần SW load. Instance cũ còn timer
  // sống → phải dọn, tránh 2 vòng tick chồng nhau spam SW.
  //
  // KHÔNG dùng biến trên `window`: content script chạy trong isolated world, mỗi lần inject lại
  // là một world SẠCH — instance mới không nhìn thấy biến của instance cũ, nên đoạn dọn dẹp kiểu
  // đó thực tế chưa từng chạy. Kênh duy nhất cả hai instance cùng thấy là DOM của trang.
  const STOP_EVENT = '__chatgptImageGrabberStop';
  document.dispatchEvent(new CustomEvent(STOP_EVENT));

  let n = 0;
  let timerId = null;

  // Content script "orphan": sau khi reload extension ở chrome://extensions, instance cũ trên
  // tab đang mở mất kết nối với extension context mới → mọi chrome.runtime.* throw
  // "Extension context invalidated". Lúc này chỉ F5 tab mới cứu được → dừng vòng lặp thay vì
  // spam lỗi mỗi 1.5s.
  function stopWithOrphanNotice() {
    if (timerId != null) clearInterval(timerId);
    timerId = null;
    console.warn(
      '[chatgpt-image] Extension context invalidated — instance này đã orphan và vừa tự dừng. ' +
        'Đây là log BÌNH THƯỜNG sau khi reload extension. Service worker mới sẽ nạp lại content ' +
        'script trong vòng ~60s (alarm keepalive). Chỉ cần F5 tab nếu quá lâu vẫn im lặng.'
    );
  }

  function tick() {
    n += 1;
    if (!chrome.runtime || !chrome.runtime.id) {
      stopWithOrphanNotice();
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'POLL_JOBS' }, () => {
        const err = chrome.runtime.lastError;
        if (err && /context invalidated/i.test(err.message || '')) stopWithOrphanNotice();
        // Lỗi khác (SW đang khởi động lại) là bình thường, không log để khỏi nhiễu console.
      });
    } catch (e) {
      if (/context invalidated/i.test((e && e.message) || '')) stopWithOrphanNotice();
    }
  }

  // ---------- Cầu nối kết quả gen ảnh: MAIN world → SW ----------
  //
  // Script gen ảnh chạy ở MAIN world (cần đụng DOM/React của ChatGPT) nên KHÔNG có chrome.runtime.
  // Nó cũng KHÔNG tự fetch về app được: CSP của chatgpt.com chỉ cho connect-src tới domain của
  // họ. Content script thì ngược lại — isolated world, có chrome.runtime, nhưng cũng bị CSP chặn
  // fetch. Chỉ service worker fetch được về app.
  //
  // Nên chuỗi bàn giao là: MAIN world --postMessage--> content script --sendMessage--> SW --fetch--> app.
  window.addEventListener('message', function (ev) {
    // Chỉ nhận message do chính trang này gửi, đúng loại của mình.
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__chatgptImageResult !== true || !d.payload) return;

    if (!chrome.runtime || !chrome.runtime.id) {
      console.warn('[chatgpt-image] có kết quả nhưng extension context đã mất — F5 tab rồi gen lại');
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'JOB_RESULT', payload: d.payload }, () => {
        const err = chrome.runtime.lastError;
        if (err) console.warn('[chatgpt-image] không chuyển được kết quả cho SW:', err.message);
      });
    } catch (e) {
      console.warn('[chatgpt-image] lỗi chuyển kết quả:', e && e.message);
    }
  });

  // Instance sau sẽ dispatch STOP_EVENT → instance này tự tắt, nhường chỗ.
  document.addEventListener(STOP_EVENT, function onStop() {
    document.removeEventListener(STOP_EVENT, onStop);
    if (timerId != null) clearInterval(timerId);
    timerId = null;
    console.log('[chatgpt-image] instance cũ nhường chỗ cho instance mới');
  });

  timerId = setInterval(tick, POLL_INTERVAL_MS);
  tick();
  console.log('[chatgpt-image] content script tick loop đã khởi động');
})();
