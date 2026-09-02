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

// Trạng thái worker gen ảnh — thứ người dùng cần thấy nhất khi mở popup: extension có đang
// nhận job không, job vừa rồi xong hay lỗi.
const JOB_LABEL = {
  idle: 'Đang chờ job gen ảnh...',
  running: 'Đang gen ảnh',
  done: 'Job gần nhất: xong',
  error: 'Job gần nhất: lỗi',
};

function refreshJobStatus() {
  chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      $('job').textContent = 'Worker gen ảnh: chưa rõ (service worker đang ngủ)';
      return;
    }
    const base = JOB_LABEL[res.state] || res.state;
    $('job').textContent = res.detail ? base + ' — ' + res.detail : base;
  });
}

refreshJobStatus();
setInterval(refreshJobStatus, 2000);

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
        // Cảnh báo "chưa có profile automation" chỉ liên quan đường Playwright trên server.
        // Với worker extension thì không cần profile đó, nên nói rõ để khỏi tưởng là hỏng.
        show('✓ Đã đăng nhập.\nGhi chú: ' + res.warn + ' — không sao nếu bạn dùng provider "ChatGPT (qua extension Chrome)".', 'warn');
      } else if (res.ok) {
        show('✓ Đã đăng nhập — app đã ghi nhận', 'ok');
      } else {
        show('✗ ' + (res.error || 'Thất bại'), 'err');
      }
    });
  });
});
