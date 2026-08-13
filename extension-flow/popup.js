const DEFAULT_ENDPOINT = 'http://localhost:3000/api/flow-auth/session';

const endpointInput = document.getElementById('endpoint');
const labelInput = document.getElementById('label');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

chrome.storage.local.get(['endpoint', 'label'], (res) => {
  endpointInput.value = res.endpoint || DEFAULT_ENDPOINT;
  labelInput.value = res.label || '';
});

function saveConfig() {
  chrome.storage.local.set({
    endpoint: endpointInput.value.trim(),
    label: labelInput.value.trim(),
  });
}

endpointInput.addEventListener('change', saveConfig);
labelInput.addEventListener('change', saveConfig);

sendBtn.addEventListener('click', async () => {
  const endpoint = endpointInput.value.trim() || DEFAULT_ENDPOINT;
  saveConfig();

  sendBtn.disabled = true;
  setStatus('Đang mint token + lấy session...', '');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/labs\.google\//i.test(tab.url || '')) {
      setStatus('Tab hiện tại không phải labs.google. Hãy mở https://labs.google (đã đăng nhập) rồi thử lại.', 'err');
      return;
    }

    // Nhờ background refreshOnce (đảm bảo inject content.js + gửi về endpoint).
    const result = await chrome.runtime.sendMessage({ type: 'REFRESH_NOW' });
    if (!result || !result.ok) {
      setStatus('❌ ' + (result?.error || 'Gửi thất bại'), 'err');
      return;
    }
    setStatus('✅ Đã gửi session về app.', 'ok');
  } catch (err) {
    setStatus('❌ Lỗi: ' + String(err && err.message ? err.message : err), 'err');
  } finally {
    sendBtn.disabled = false;
  }
});
