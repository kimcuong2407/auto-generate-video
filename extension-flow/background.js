// Background service worker.
//
// 2 nhiệm vụ:
//  A. Session (cookie + access_token): định kỳ ~5 phút POST /api/flow-auth/session.
//  B. reCAPTCHA token on-demand: khi content.js gửi 'POLL_TOKENS' (mỗi ~1.5s), fetch
//     GET /api/flow-auth/token-request; với mỗi pending → mint token trong MAIN world
//     của tab Flow (executeScript) → POST token về /api/flow-auth/token-request.
//
// Vì sao mọi fetch + mint đều ở SW (không ở content script): CSP của trang Flow chặn
// content script fetch cross-origin tới localhost và chặn inject <script> từ
// chrome-extension://. SW không bị CSP của trang ràng buộc và có host_permissions.

console.log('[flow-grabber] service worker đã load', new Date().toISOString());

const DEFAULT_SESSION_ENDPOINT = 'http://localhost:3000/api/flow-auth/session';
const ALARM_NAME = 'flow-session-refresh';
const POLL_ALARM_NAME = 'flow-poll-keepalive';

const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

// Google đã đổi domain Flow từ labs.google sang flow.google.com. Giữ cả hai vì tài khoản
// cũ vẫn còn phiên trên labs.google — mọi chỗ tìm tab / đọc cookie đều dùng list này.
const FLOW_TAB_PATTERNS = ['https://labs.google/*', 'https://flow.google.com/*'];
const FLOW_COOKIE_URLS = ['https://labs.google', 'https://flow.google.com'];
const MINT_GAP_MS = 200;

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['endpoint', 'label'], (res) => {
      resolve({
        endpoint: res.endpoint || DEFAULT_SESSION_ENDPOINT,
        label: res.label || '',
      });
    });
  });
}

/** Base origin của app (suy ra từ endpoint đã cấu hình). */
async function getBase() {
  const { endpoint } = await getConfig();
  try {
    return new URL(endpoint).origin;
  } catch (_e) {
    return 'http://localhost:3000';
  }
}

/**
 * Tìm tab Flow đang mở. Ưu tiên flow.google.com (domain mới) vì tab labs.google cũ còn
 * mở thường đã hết phiên — vớ phải nó là collect/mint fail dù tab mới vẫn đăng nhập tốt.
 */
async function findLabsTab() {
  const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
  return tabs.find((t) => (t.url || '').startsWith('https://flow.google.com')) || tabs[0] || null;
}

// ---------- A. Session (cookie + access_token) ----------

// Chạy trong MAIN world của tab Flow.
// KHÔNG throw: hàm truyền qua executeScript mà reject thì results[0].result = undefined,
// popup chỉ thấy "collect thất bại" và lỗi thật (404/401/path đổi) biến mất. Luôn trả object,
// kèm `error` để popup hiển thị nguyên văn.
function collectSessionInMainWorld() {
  // flow.google.com đổi base path so với labs.google (mọi path đoán sẵn đều trả HTML), nên
  // không hardcode: DÒ từ chính trang. Trang Flow tự gọi endpoint session khi load, nên URL
  // thật nằm trong performance entries; danh sách tĩnh chỉ là fallback khi entries đã bị xoá.
  const STATIC_PATHS = ['/fx/api/auth/session', '/api/auth/session', '/auth/session'];

  function discoverSessionUrls() {
    let entries = [];
    try {
      entries = performance.getEntries().map((e) => e.name);
    } catch (_e) {
      /* performance API bị chặn — bỏ qua, dùng fallback tĩnh */
    }
    const found = entries.filter(
      (u) => typeof u === 'string' && /\/session(\?|$)/.test(u) && u.startsWith(location.origin)
    );
    // Dò trước, fallback sau; dedupe giữ nguyên thứ tự ưu tiên.
    return [...new Set([...found, ...STATIC_PATHS])];
  }

  async function run() {
    const candidates = discoverSessionUrls();
    const tried = [];
    for (const url of candidates) {
      let res;
      try {
        res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      } catch (e) {
        tried.push(url + ' → fetch lỗi: ' + (e && e.message));
        continue;
      }
      if (!res.ok) {
        tried.push(url + ' → HTTP ' + res.status);
        continue;
      }
      let data;
      try {
        data = await res.json();
      } catch (_e) {
        tried.push(url + ' → không phải JSON');
        continue;
      }
      const accessToken = data && (data.access_token || data.accessToken);
      if (!accessToken) {
        tried.push(url + ' → JSON thiếu access_token (keys: ' + Object.keys(data || {}).join(',') + ')');
        continue;
      }
      return { label: document.title || location.hostname, accessToken, path: url };
    }
    return {
      error:
        'Không lấy được access_token trên ' +
        location.origin +
        '. Đã thử: ' +
        tried.join(' | ') +
        '. Mở DevTools tab Flow → Network, lọc "session", tìm request trả JSON có access_token rồi gửi URL đó cho dev.',
    };
  }
  return run();
}

function getCookieHeader() {
  // Gộp cookie của cả 2 domain, dedupe theo tên (domain mới thắng vì xét sau).
  return Promise.all(
    FLOW_COOKIE_URLS.map(
      (url) =>
        new Promise((resolve) => {
          chrome.cookies.getAll({ url }, (cookies) => resolve(cookies || []));
        })
    )
  ).then((lists) => {
    const byName = new Map();
    for (const c of lists.flat()) byName.set(c.name, c.value);
    return [...byName].map(([name, value]) => `${name}=${value}`).join('; ');
  });
}

async function refreshSessionOnce() {
  const { endpoint, label } = await getConfig();
  const tab = await findLabsTab();
  if (!tab) return { ok: false, error: 'no-tab' };

  let collected;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: collectSessionInMainWorld,
    });
    collected = results && results[0] && results[0].result;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
  if (!collected || !collected.accessToken) {
    return { ok: false, error: (collected && collected.error) || 'collect thất bại (executeScript không trả kết quả)' };
  }
  console.log('[flow-grabber] lấy được access_token từ', tab.url, 'qua path', collected.path);

  const cookie = await getCookieHeader();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: label || collected.label, cookie, accessToken: collected.accessToken }),
  });
  return { ok: res.ok, status: res.status };
}

// ---------- B. reCAPTCHA token on-demand ----------

/** Mint 1 token trong MAIN world của tab Flow. */
function mintInMainWorld(siteKey, action) {
  const READY_TIMEOUT_MS = 20000;
  function ensureEnterprise() {
    return new Promise((resolve, reject) => {
      if (window.grecaptcha && window.grecaptcha.enterprise) {
        resolve(window.grecaptcha.enterprise);
        return;
      }
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.grecaptcha && window.grecaptcha.enterprise) {
          clearInterval(timer);
          resolve(window.grecaptcha.enterprise);
        } else if (Date.now() - started > READY_TIMEOUT_MS) {
          clearInterval(timer);
          reject(new Error('grecaptcha.enterprise chưa sẵn sàng'));
        }
      }, 250);
    });
  }
  return ensureEnterprise().then(
    (enterprise) =>
      new Promise((resolve, reject) => {
        enterprise
          .execute(siteKey, { action })
          .then(resolve)
          .catch(() => reject(new Error('Mint token ' + action + ' thất bại')));
      })
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let polling = false; // tránh chồng lần poll khi tick dồn

async function pollTokensOnce() {
  if (polling) return;
  polling = true;
  try {
    const base = await getBase();
    console.log('[flow-grabber] poll GET', base + '/api/flow-auth/token-request');

    // GET trước (đánh dấu lastPollAt phía server) — KHÔNG phụ thuộc việc tìm tab.
    let data;
    try {
      const res = await fetch(base + '/api/flow-auth/token-request', { method: 'GET' });
      console.log('[flow-grabber] poll GET status', res.status);
      if (!res.ok) return;
      data = await res.json();
    } catch (e) {
      console.warn('[flow-grabber] poll GET fetch lỗi:', e && e.message);
      return; // app chưa chạy / mạng lỗi
    }

    const requests = (data && data.requests) || [];
    if (requests.length === 0) return;

    // Chỉ cần tab Flow khi thực sự phải mint.
    const tab = await findLabsTab();
    if (!tab) {
      console.warn('[flow-grabber] có pending nhưng không thấy tab Flow để mint');
      return;
    }

    for (const item of requests) {
      const { requestId, action, accountId } = item;
      let token = null;
      let mintError = null;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: mintInMainWorld,
          args: [SITE_KEY, action],
        });
        token = results && results[0] && results[0].result;
      } catch (err) {
        mintError = String(err && err.message ? err.message : err);
      }

      const body = token
        ? { accountId, requestId, action, token }
        : { accountId, requestId, action, error: mintError || 'mint null' };
      await fetch(base + '/api/flow-auth/token-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});

      if (token) console.log('[flow-grabber] minted token', action, requestId);
      else console.warn('[flow-grabber] mint thất bại', action, requestId, mintError);

      await sleep(MINT_GAP_MS);
    }
  } finally {
    polling = false;
  }
}

// ---------- Listeners ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'POLL_TOKENS') {
    console.log('[flow-grabber] SW nhận POLL_TOKENS');
    pollTokensOnce().catch((err) => console.error('[flow-grabber] poll', err));
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'REFRESH_NOW') {
    refreshSessionOnce()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    refreshSessionOnce().catch((err) => console.error('[flow-grabber]', err));
  }
  // Alarm đánh thức SW kể cả khi tab Flow ở nền (content script bị Chrome
  // throttle xuống >=60s/tick). Poll ở đây giữ lastPollAt phía server luôn tươi,
  // nên lệnh gen không bị fail-fast oan vì "không thấy poll".
  if (alarm.name === POLL_ALARM_NAME) {
    pollTokensOnce().catch((err) => console.error('[flow-grabber] poll alarm', err));
    reinjectContentScript();
  }
});

/**
 * Nạp lại content.js vào mọi tab Flow đang mở.
 *
 * Vì sao cần: reload extension ở chrome://extensions làm content script CŨ trên tab đang mở
 * bị orphan ("Extension context invalidated") — nó tự dừng vòng tick vĩnh viễn và trước đây
 * chỉ F5 tab thủ công mới cứu được. Vòng tick chết = server không thấy poll = mọi lệnh gen
 * ảnh/video fail với "Extension Google Flow không hoạt động". Tự inject lại ở đây để extension
 * tự hồi phục, không bắt người dùng nhớ thao tác F5 đúng thứ tự.
 */
async function reinjectContentScript() {
  try {
    const tabs = await chrome.tabs.query({ url: FLOW_TAB_PATTERNS });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        console.log('[flow-grabber] đã nạp lại content.js vào tab', tab.id);
      } catch (e) {
        console.warn('[flow-grabber] không nạp được content.js vào tab', tab.id, e && e.message);
      }
    }
  } catch (e) {
    console.warn('[flow-grabber] reinjectContentScript lỗi:', e && e.message);
  }
}

function ensureAlarms() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
  // 1 phút là chu kỳ nhỏ nhất Chrome cho phép với MV3 alarm.
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms();
  reinjectContentScript();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  reinjectContentScript();
});
// SW vừa load (reload extension / SW bị kill rồi hồi sinh) → cứu tab đang mở luôn.
reinjectContentScript();
ensureAlarms();
