const $ = (id) => document.getElementById(id);

chrome.storage.local.get(['endpoint', 'label'], (res) => {
  $('endpoint').value = res.endpoint || 'https://video.homebox.vn/api/chatgpt-auth/session';
  $('label').value = res.label || 'Tài khoản ChatGPT';
});

function show(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = cls || '';
}

$('push').addEventListener('click', () => {
  const endpoint = $('endpoint').value.trim();
  const label = $('label').value.trim() || 'Tài khoản ChatGPT';

  // Lưu TRƯỚC khi gửi: service worker đọc cấu hình từ storage, không nhận qua message.
  chrome.storage.local.set({ endpoint, label }, () => {
    $('push').disabled = true;
    show('Đang gửi...');
    chrome.runtime.sendMessage({ type: 'PUSH_NOW' }, (res) => {
      $('push').disabled = false;
      if (chrome.runtime.lastError) {
        show('Lỗi: ' + chrome.runtime.lastError.message, 'err');
      } else if (!res) {
        show('Không nhận được phản hồi từ service worker', 'err');
      } else if (res.ok && res.warn) {
        show('⚠ ' + res.warn, 'warn');
      } else if (res.ok) {
        show('✓ Đã đăng nhập — app đã ghi nhận', 'ok');
      } else {
        show('✗ ' + (res.error || 'Thất bại'), 'err');
      }
    });
  });
});
