// Background service worker.
//
// Nhiệm vụ DUY NHẤT: định kỳ ~5 phút đọc cookie chatgpt.com rồi POST về
// /api/chatgpt-auth/session để app biết tài khoản còn đăng nhập hay đã bị đá ra.
//
// KHÁC extension-flow ở chỗ quan trọng: bên Flow, cookie gửi về được server dùng để GỌI API
// thật. Ở đây thì KHÔNG — ChatGPT chặn HTTP thuần bằng Cloudflare Turnstile, cookie không đủ
// dựng lại phiên (xem docs/IMPLEMENTATION_CHATGPT_IMAGE_GEN.md mục 0). Việc gen ảnh vẫn chạy
// bằng Playwright trên profile Chrome riêng; cookie ở đây chỉ để XÁC MINH trạng thái login.
//
// Vì vậy cũng không cần content script: chrome.cookies đọc được cookie HttpOnly từ SW, không
// phải chạy JS trong trang, và không cần tab chatgpt.com nào đang mở.

console.log('[chatgpt-grabber] service worker đã load', new Date().toISOString());

const DEFAULT_ENDPOINT = 'https://video.homebox.vn/api/chatgpt-auth/session';
const ALARM_NAME = 'chatgpt-session-refresh';

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['endpoint', 'label', 'accountId'], (res) => {
      resolve({
        endpoint: res.endpoint || DEFAULT_ENDPOINT,
        label: res.label || 'Tài khoản ChatGPT',
        accountId: res.accountId || '',
      });
    });
  });
}

/**
 * Cookie header của chatgpt.com.
 *
 * Lấy theo domain chứ không theo url: cookie phiên nằm rải trên chatgpt.com và các subdomain,
 * getAll({url}) chỉ trả cookie khớp path/secure của đúng URL đó nên dễ sót cookie session.
 */
function getCookieHeader() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: 'chatgpt.com' }, (cookies) => {
      resolve((cookies || []).map((c) => `${c.name}=${c.value}`).join('; '));
    });
  });
}

async function pushSessionOnce() {
  const { endpoint, label, accountId } = await getConfig();
  const cookie = await getCookieHeader();

  if (!cookie) return { ok: false, error: 'Chưa có cookie chatgpt.com — hãy đăng nhập trong Chrome' };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: accountId || undefined, label, cookie }),
    });
  } catch (err) {
    return { ok: false, error: 'Không gọi được app: ' + (err && err.message ? err.message : err) };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || 'HTTP ' + res.status };

  // Server tự tạo account lần đầu — nhớ id lại để lần sau cập nhật đúng account đó thay vì
  // đẻ thêm account mới mỗi lần đổi nhãn.
  if (data.accountId && data.accountId !== accountId) {
    chrome.storage.local.set({ accountId: data.accountId });
  }

  if (!data.loggedIn) return { ok: false, error: 'Chưa đăng nhập ChatGPT trong Chrome' };
  if (!data.hasProfile) {
    return { ok: true, warn: 'Đã đăng nhập, nhưng app chưa có profile automation cho account này' };
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PUSH_NOW') {
    pushSessionOnce()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pushSessionOnce().catch((err) => console.error('[chatgpt-grabber]', err));
  }
});

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();
