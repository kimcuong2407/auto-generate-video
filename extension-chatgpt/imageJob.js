// Logic DOM chạy TRONG trang chatgpt.com (MAIN world) để gen 1 ảnh.
//
// HAI RÀNG BUỘC ĐỐI NGHỊCH quyết định kiến trúc ở đây, đều đã trả giá bằng lỗi thật:
//
// 1. Service worker KHÔNG được ngồi chờ job xong — Chrome kill SW sau 30s idle và cắt mọi
//    lời gọi API quá 5 phút. Nên hàm này trả về NGAY, phần việc chạy nền trong trang.
// 2. Trang KHÔNG được fetch về app — CSP của chatgpt.com chỉ cho connect-src tới domain của
//    họ. Nên kết quả phải đi đường vòng:
//       MAIN world --postMessage--> content.js --sendMessage--> service worker --fetch--> app
//    (content.js cũng bị CSP chặn fetch; chỉ SW là không.)
//
// Đây là bản port của lib/chatgptImage/runner.ts + domScript.ts sang môi trường extension.
// Vì sao phải copy thay vì import: chrome.scripting.executeScript chỉ nhận được MỘT hàm
// tự-chứa — nó được serialize sang trang, nên mọi thứ hàm dùng phải nằm gọn bên trong nó.
// Không có bundler ở đây, và thêm bundler chỉ vì một file là không đáng.
//
// Selector và ngưỡng phải khớp domScript.ts. Đổi bên đó thì đổi cả bên này.

/* global chrome */

/**
 * Chạy trọn một job gen ảnh trong trang RỒI TỰ POST kết quả về app.
 *
 * Vì sao tự POST thay vì trả giá trị cho service worker: SW của MV3 bị Chrome kill sau 30 giây
 * idle, và mọi lời gọi API đơn lẻ bị cắt ở mốc 5 phút. Trong lúc SW `await executeScript` nó
 * không gọi API nào nên timer idle không được reset — gen ảnh mất 1-3 phút là SW chết giữa
 * chừng, script trong trang vẫn lấy được ảnh nhưng KHÔNG CÒN AI NHẬN, job kẹt 'running' mãi.
 * Trang web thì không có giới hạn đó: nó sống theo tab, tự fetch về app được.
 *
 * Vì vậy hàm này trả về NGAY sau khi khởi động (không await xong việc), phần còn lại chạy nền
 * trong trang. Kết quả duy nhất SW nhận được là "đã bắt đầu hay chưa".
 *
 * KHÔNG throw: executeScript nuốt stack trace, nên lỗi phải đi qua đường POST.
 */
function runImageJobInPage(job) {
  // Chặn chạy chồng trên cùng tab: SW có thể inject lại khi nó hồi sinh, mà job trước còn đang
  // chạy thì hai vòng poll sẽ tranh nhau DOM và cùng nộp kết quả.
  if (window.__chatgptImageBusy) {
    return { started: false, reason: 'đang chạy một job khác trong tab này' };
  }
  window.__chatgptImageBusy = true;

  // KHÔNG fetch thẳng về app từ đây: CSP của chatgpt.com chỉ cho connect-src tới domain của
  // họ, mọi request tới localhost/video.homebox.vn đều bị chặn ("Refused to connect because it
  // violates the document's Content Security Policy"). Chỉ service worker mới fetch được.
  //
  // Nhưng MAIN world không có chrome.runtime để gọi thẳng SW. Đường duy nhất: postMessage lên
  // window → content script (isolated world, CÓ chrome.runtime) bắt được → chuyển cho SW → SW
  // POST về app.
  const post = (body) => {
    window.postMessage(
      { __chatgptImageResult: true, payload: Object.assign({ jobId: job.id }, body) },
      '*'
    );
  };

  // Chạy nền, KHÔNG await — trả quyền điều khiển lại cho SW ngay.
  runJob(job)
    .then(function (r) {
      if (!r.ok) return post({ error: r.error });
      // imageUrl: SW tự tải (ảnh to, tránh nhồi base64 qua 2 chặng message).
      // imageBase64: ảnh blob:/data: mà SW không với tới được.
      return post(r.imageUrl ? { imageUrl: r.imageUrl } : { imageBase64: r.imageBase64, ext: r.ext });
    })
    .catch(function (e) {
      return post({ error: 'Lỗi không bắt được: ' + (e && e.message ? e.message : e) });
    })
    .finally(function () {
      window.__chatgptImageBusy = false;
    });

  return { started: true };

  /** Toàn bộ việc thật. Phải nằm TRONG hàm được serialize, nếu không trang sẽ không thấy nó. */
  async function runJob(job) {
    const COMPOSER_SELECTOR = '#prompt-textarea, [data-testid="composer-text-input"]';
    const POLL_MS = 2000;
    const TIMEOUT_MS = 10 * 60 * 1000;
    // ChatGPT còn đang tạo ảnh (nút dừng còn hiện) thì gia hạn tới mốc này thay vì bỏ cuộc —
    // prompt nhiều ảnh ref có thể vượt 10 phút, bỏ cuộc lúc đó là phí cả lượt đã chờ.
    const HARD_TIMEOUT_MS = 20 * 60 * 1000;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const log = (...a) => console.log('[chatgpt-image]', ...a);

    // ---------- 0. Trang đã sẵn sàng chưa ----------
    function readPageState() {
      if (document.querySelector(COMPOSER_SELECTOR)) return 'ready';
      const text = document.body?.innerText?.toLowerCase() || '';
      if (text.includes('log in') || text.includes('welcome back') || text.includes('đăng nhập')) {
        return 'login';
      }
      return 'pending';
    }

    const readyDeadline = Date.now() + 45000;
    while (Date.now() < readyDeadline) {
      const st = readPageState();
      if (st === 'ready') break;
      if (st === 'login') return { ok: false, error: 'Phiên ChatGPT đã hết hạn — hãy đăng nhập lại trong tab chatgpt.com' };
      await sleep(1000);
    }
    const composer = document.querySelector(COMPOSER_SELECTOR);
    if (!composer) return { ok: false, error: 'Không tìm thấy ô nhập của ChatGPT (trang chưa sẵn sàng hoặc đổi giao diện)' };

    // ---------- 1. Đính ảnh tham chiếu ----------
    // Chỉ dùng chiến lược input[type=file] (giống runner.ts) — 3 chiến lược fallback còn lại
    // trong doc chỉ cần khi input bị ẩn hoàn toàn, chưa gặp thực tế.
    if (job.refImages && job.refImages.length > 0) {
      const input = document.querySelector('input[type="file"]');
      if (!input) return { ok: false, error: 'Không tìm thấy ô đính kèm ảnh trên trang ChatGPT' };

      const dt = new DataTransfer();
      for (const ref of job.refImages) {
        const [meta, b64] = ref.dataUrl.split(',');
        const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], ref.name, { type: mime }));
      }
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Chờ thumbnail hiện thật rồi mới gửi — dispatch xong không có nghĩa upload xong, gửi sớm
      // là ChatGPT nhận prompt mà thiếu ảnh ref (runner.ts:151-157 cũng chờ đúng chỗ này).
      const upDeadline = Date.now() + 60000;
      let attached = false;
      while (Date.now() < upDeadline) {
        await sleep(500);
        const form = document.querySelector('form') || document.body;
        if (form.querySelectorAll('img').length > 0 || document.querySelector('[data-testid*="attachment"]')) {
          attached = true;
          break;
        }
      }
      if (!attached) return { ok: false, error: 'Đính ảnh tham chiếu không thành công (chờ 60s không thấy thumbnail)' };
      log('đã đính', job.refImages.length, 'ảnh ref');
    }

    // ---------- 2. Gõ prompt ----------
    // Composer là div[contenteditable], không set .value được. Thử paste → execCommand →
    // textContent, mỗi bước clear trước để không nối chồng (doc mục 5.6).
    function composerText() {
      return (composer.innerText || '').trim();
    }
    function clearComposer() {
      composer.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete');
    }

    const want = job.prompt.trim();
    let typed = false;
    for (const strategy of ['paste', 'insertText', 'textContent']) {
      clearComposer();
      try {
        if (strategy === 'paste') {
          const dt = new DataTransfer();
          dt.setData('text/plain', job.prompt);
          composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        } else if (strategy === 'insertText') {
          document.execCommand('insertText', false, job.prompt);
        } else {
          composer.textContent = job.prompt;
          composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        }
      } catch (e) {
        continue;
      }
      for (let i = 0; i < 6; i++) {
        await sleep(100);
        // So khớp lỏng: ChatGPT chuẩn hoá khoảng trắng/xuống dòng trong composer.
        if (composerText().replace(/\s+/g, ' ') === want.replace(/\s+/g, ' ')) { typed = true; break; }
      }
      if (typed) { log('gõ prompt bằng', strategy); break; }
    }
    if (!typed) return { ok: false, error: 'Không gõ được prompt vào ô nhập ChatGPT' };

    // ---------- 3. Baseline TRƯỚC khi gửi ----------
    function captureBaseline() {
      const images = Array.from(document.querySelectorAll('img')).map(
        (img) => `${img.getAttribute('src') || ''}|${img.getAttribute('alt') || ''}`
      );
      return { images, turnCount: document.querySelectorAll('[data-message-author-role]').length };
    }
    const baseline = captureBaseline();

    // ---------- 4. Gửi ----------
    const sendBtn = document.querySelector('[data-testid="send-button"]');
    if (sendBtn) {
      sendBtn.click();
    } else {
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    log('đã gửi prompt');

    // ---------- 5. Poll ảnh kết quả ----------
    function isResultImage(img) {
      const src = img.src;
      if (!src) return false;
      if (/avatar|favicon|profile|emoji|icon|sprite/i.test(src)) return false;
      if (img.naturalWidth <= 256 || img.naturalHeight <= 256) return false;

      const looksLikeResult =
        src.startsWith('blob:') ||
        src.startsWith('data:image/') ||
        /\/backend-api\/(files|estuary|content)/.test(src) ||
        src.includes('oaiusercontent');
      if (!looksLikeResult) return false;

      // Ràng buộc vị trí: ảnh phải thuộc lượt trả lời của assistant, SAU lượt user vừa gửi.
      //
      // Nới ở đây so với bản Playwright: nếu KHÔNG xác định được lượt hội thoại (ảnh nằm ngoài
      // [data-message-author-role], ví dụ ChatGPT bọc ảnh trong container/iframe riêng), vẫn
      // chấp nhận — vì ảnh đã qua bộ lọc URL + kích thước ở trên, và nó KHÔNG có trong baseline
      // chụp trước lúc gửi, nên gần như chắc chắn là ảnh vừa sinh ra.
      // Chặt quá thì đúng ca này bị bỏ sót và job treo tới hết timeout mà không rõ vì sao.
      if (img.turnKnown) return img.inAssistantTurn && img.afterCurrentUserTurn;
      return true;
    }

    const known = new Set(baseline.images);
    let deadline = Date.now() + TIMEOUT_MS;
    // Trần tuyệt đối kể cả khi ChatGPT vẫn đang vẽ — tránh treo vô hạn nếu nút dừng kẹt lại.
    const hardDeadline = Date.now() + HARD_TIMEOUT_MS;
    let lastSeen = null;
    let stableSrc = null;
    let pollCount = 0;
    let lastDiag = null;
    const seenSrcs = new Set();

    while (Date.now() < deadline && Date.now() < hardDeadline) {
      await sleep(POLL_MS);

      const turns = Array.from(document.querySelectorAll('[data-message-author-role]'));
      const userTurns = turns.filter((t) => t.getAttribute('data-message-author-role') === 'user');
      const currentUserTurn = userTurns[userTurns.length - 1] || null;
      const currentIdx = currentUserTurn ? turns.indexOf(currentUserTurn) : -1;

      const candidates = [];
      const rejected = []; // để log lý do khi không tìm ra ảnh nào
      for (const img of Array.from(document.querySelectorAll('img'))) {
        // Dùng img.src (URL đã phân giải) chứ KHÔNG phải getAttribute('src'): với ảnh blob:
        // hai giá trị này khác nhau, và isResultImage kiểm theo dạng URL đầy đủ.
        const src = img.src || img.getAttribute('src') || '';
        if (known.has(`${img.getAttribute('src') || ''}|${img.getAttribute('alt') || ''}`)) continue;
        const turn = img.closest('[data-message-author-role]');
        const ok = isResultImage({
          src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          turnKnown: Boolean(turn),
          inAssistantTurn: turn && turn.getAttribute('data-message-author-role') === 'assistant',
          afterCurrentUserTurn: turn ? turns.indexOf(turn) > currentIdx : false,
        });
        if (ok) candidates.push(src);
        else if (src && !/avatar|favicon|profile|emoji|icon|sprite/i.test(src)) {
          rejected.push({
            src: src.slice(0, 90),
            w: img.naturalWidth,
            h: img.naturalHeight,
            inAssistant: turn && turn.getAttribute('data-message-author-role') === 'assistant',
            afterUser: turn ? turns.indexOf(turn) > currentIdx : false,
          });
        }
      }

      // Log định kỳ để biết vòng poll đang thấy gì — không có cái này thì lúc kẹt chỉ im lặng
      // suốt 10 phút rồi báo timeout, không đủ dữ kiện sửa.
      pollCount += 1;
      // Còn thấy nút dừng = ChatGPT đang vẽ dở. Đẩy deadline ra để không cắt ngang giữa chừng.
      if (document.querySelector('[data-testid="stop-button"]')) {
        deadline = Math.min(Date.now() + TIMEOUT_MS, hardDeadline);
      }
      lastDiag = {
        totalImgs: document.querySelectorAll('img').length,
        turns: turns.length,
        rejected: rejected.length,
        streaming: Boolean(document.querySelector('[data-testid="stop-button"]')),
        sample: rejected.length
          ? JSON.stringify(rejected.slice(0, 2))
          : '',
      };
      if (pollCount % 5 === 0) {
        log('poll #' + pollCount, '| ứng viên:', candidates.length, '| ảnh bị loại:', rejected.length,
          '| tổng img trên trang:', document.querySelectorAll('img').length,
          '| số lượt hội thoại:', turns.length);
        if (rejected.length > 0) log('  ví dụ ảnh bị loại:', JSON.stringify(rejected.slice(0, 3)));
      }

      for (const s of candidates) seenSrcs.add(s);
      const found = candidates[0];

      if (found) {
        // Ổn định = thấy đúng src này 2 vòng liên tiếp. Ảnh preview lúc đang vẽ đổi src liên tục.
        if (found === lastSeen) { stableSrc = found; break; }
        lastSeen = found;
        continue;
      }
      lastSeen = null;

      // Không ảnh, đã ngừng stream, mà assistant có text → ChatGPT từ chối vẽ hoặc hỏi lại.
      const assistants = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
      const last = assistants[assistants.length - 1];
      if (last && !document.querySelector('[data-testid="stop-button"]') && !last.querySelector('img')) {
        const text = (last.innerText || '').trim();
        if (text) return { ok: false, error: 'ChatGPT trả lời bằng text thay vì ảnh: ' + text.slice(0, 300) };
      }
    }

    if (!stableSrc) {
      if (seenSrcs.size > 0) {
        return { ok: false, error: 'Hết thời gian chờ: thấy ảnh nhưng không ổn định được. src: ' + Array.from(seenSrcs).slice(0, 3).join(', ') };
      }
      // Kèm ảnh chụp trạng thái trang lúc bỏ cuộc — nếu không thì thông báo "hết thời gian chờ"
      // không nói được gì và phải mở Console tab chatgpt.com mới chẩn đoán được.
      const diag = lastDiag || {};
      const parts = [
        'Hết thời gian chờ ChatGPT trả ảnh (10 phút)',
        'đã poll ' + pollCount + ' lần',
        'ảnh trên trang: ' + (diag.totalImgs != null ? diag.totalImgs : '?'),
        'lượt hội thoại: ' + (diag.turns != null ? diag.turns : '?'),
        'ảnh bị loại: ' + (diag.rejected != null ? diag.rejected : '?'),
      ];
      if (diag.sample) parts.push('ví dụ ảnh bị loại: ' + diag.sample);
      if (diag.streaming) parts.push('ChatGPT VẪN ĐANG tạo (nút dừng còn hiện) — có thể cần tăng timeout');
      return { ok: false, error: parts.join(' | ') };
    }

    // ---------- 6. Lấy bytes ----------
    //
    // Ảnh là URL http(s) (dạng ChatGPT hay dùng: /backend-api/estuary/content?id=...) → gửi
    // THẲNG URL cho service worker tự tải, không encode base64 ở đây. Lý do: ảnh 2-3MB thành
    // ~4MB chuỗi base64 rồi phải đi qua hai chặng serialize (postMessage → sendMessage), vừa
    // chậm vừa rủi ro. SW có host_permissions chatgpt.com nên fetch được kèm cookie phiên.
    //
    // Chỉ khi ảnh là blob:/data: (URL chỉ sống trong trang, SW không với tới) mới phải encode.
    if (/^https?:/.test(stableSrc)) {
      log('trả URL ảnh cho service worker tải:', stableSrc.slice(0, 80));
      return { ok: true, imageUrl: stableSrc };
    }

    // fetch TRONG trang để đi kèm cookie phiên; fallback canvas khi CORS chặn fetch nhưng ảnh
    // vẫn render được (doc mục 10).
    const toB64 = (buf) => {
      let binary = '';
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000; // tránh tràn stack khi apply mảng lớn
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(binary);
    };

    let b64 = null;
    let ext = 'png';
    try {
      const res = await fetch(stableSrc, { credentials: 'include' });
      if (res.ok) {
        const type = res.headers.get('content-type') || '';
        if (type.includes('jpeg')) ext = 'jpg';
        else if (type.includes('webp')) ext = 'webp';
        b64 = toB64(await res.arrayBuffer());
      }
    } catch (e) {
      /* rơi xuống canvas */
    }

    if (!b64) {
      const img = Array.from(document.querySelectorAll('img')).find((el) => el.getAttribute('src') === stableSrc);
      if (img) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          b64 = canvas.toDataURL('image/png').split(',')[1] || null;
          ext = 'png';
        } catch (e) {
          return { ok: false, error: 'Không lấy được dữ liệu ảnh (canvas bị chặn): ' + (e && e.message) };
        }
      }
    }

    if (!b64) return { ok: false, error: 'Không lấy được dữ liệu ảnh từ trang ChatGPT' };
    log('lấy được ảnh', ext, Math.round(b64.length / 1024), 'KB base64');
    return { ok: true, imageBase64: b64, ext };
  }

}
