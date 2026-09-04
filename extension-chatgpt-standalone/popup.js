const $ = (id) => document.getElementById(id);
const DEFAULT_SERVER = 'http://localhost:4123';

chrome.storage.local.get(['serverUrl'], (res) => {
  $('server').value = res.serverUrl || DEFAULT_SERVER;
});

function serverBase() {
  return ($('server').value.trim() || DEFAULT_SERVER).replace(/\/+$/, '');
}

function show(text, cls) {
  const el = $('msg');
  el.textContent = text;
  el.className = cls || '';
}

$('save').addEventListener('click', () => {
  chrome.storage.local.set({ serverUrl: serverBase() }, () => show('Đã lưu Server URL', 'ok'));
});

// ---------- Trạng thái worker ----------
const JOB_LABEL = {
  idle: 'Đang chờ job...',
  running: 'Đang gen ảnh',
  done: 'Job gần nhất: xong',
  error: 'Job gần nhất: lỗi',
};

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'GET_JOB_STATUS' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      $('status').textContent = 'Worker: chưa rõ (service worker đang ngủ — mở tab chatgpt.com là nó tỉnh)';
      return;
    }
    const base = JOB_LABEL[res.state] || res.state;
    $('status').textContent = res.detail ? base + ' — ' + res.detail : base;
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- Ảnh gần nhất: preview + tải ----------
function refreshPreview() {
  chrome.storage.local.get(['lastResult'], (res) => {
    const r = res.lastResult;
    const box = $('preview');
    if (!r) {
      box.innerHTML = '<div class="muted">Chưa có ảnh nào.</div>';
      return;
    }
    if (r.error) {
      box.innerHTML = '<div class="err">Ảnh gần nhất lỗi: ' + escapeHtml(r.error) + '</div>';
      return;
    }
    if (r.imageBase64) {
      const mime = 'image/' + (r.ext === 'jpg' ? 'jpeg' : r.ext || 'png');
      const url = 'data:' + mime + ';base64,' + r.imageBase64;
      box.innerHTML = '';
      const img = document.createElement('img');
      img.src = url;
      img.className = 'thumb';
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chatgpt-' + (r.jobId || 'img') + '.' + (r.ext || 'png');
      a.textContent = '⬇ Tải ảnh xuống';
      a.className = 'dl';
      box.appendChild(img);
      box.appendChild(a);
    }
  });
}

refreshStatus();
refreshPreview();
setInterval(refreshStatus, 2000);
setInterval(refreshPreview, 2000);

// ---------- Test nhanh: đẩy 1 prompt vào server ----------
function readFilesAsDataUrls(files) {
  return Promise.all(
    [...files].map(
      (f) =>
        new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve({ dataUrl: fr.result, name: f.name });
          fr.onerror = reject;
          fr.readAsDataURL(f);
        })
    )
  );
}

$('gen').addEventListener('click', async () => {
  const prompt = $('prompt').value.trim();
  if (!prompt) {
    show('Nhập prompt đã', 'err');
    return;
  }
  $('gen').disabled = true;
  show('Đang đẩy job vào server...');
  try {
    const refImages = $('refs').files.length ? await readFilesAsDataUrls($('refs').files) : [];
    const res = await fetch(serverBase() + '/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, refImages }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      show('Lỗi server: ' + (data.error || 'HTTP ' + res.status), 'err');
    } else {
      show('✓ Đã đẩy job ' + data.id + '.\nMở sẵn tab chatgpt.com — ảnh sẽ hiện bên dưới khi xong (1-3 phút).', 'ok');
    }
  } catch (e) {
    show('Không gọi được server: ' + (e && e.message ? e.message : e), 'err');
  } finally {
    $('gen').disabled = false;
  }
});
