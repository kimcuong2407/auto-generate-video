// Background service worker.
//
// 2 nhiệm vụ:
//  A. Session (cookie + at token từ WIZ_global_data): định kỳ ~5 phút POST /api/flow-auth/session.
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

// ---------- A. Session (cookie + at token) ----------

// Chạy trong MAIN world của tab Flow.
// KHÔNG throw: hàm truyền qua executeScript mà reject thì results[0].result = undefined,
// popup chỉ thấy "collect thất bại" và lỗi thật biến mất. Luôn trả object, kèm `error`.
function collectSessionInMainWorld() {
  // Google đã gỡ hẳn kiến trúc cũ (/fx/api/auth/session → Bearer ya29 → aisandbox-pa
  // .googleapis.com): HAR ngày 2026-09-04 không còn MỘT request nào tới các endpoint đó.
  // Flow giờ chạy hoàn toàn qua BatchExecute trên chính flow.google.com, auth = cookie +
  // `at` token. Cả 3 tham số bắt buộc đều nằm trong window.WIZ_global_data mà trang tự
  // nhúng vào HTML:
  //   SNlM0e → `at`    (XSRF token, đi trong body form; thiếu nó Google trả 400/401)
  //   FdrFJe → `f.sid` (session id của phiên BOQ)
  //   cfb2h  → `bl`    (build label, Google đổi vài ngày/lần)
  //   Im6cmf → base path RPC, vd "/_/AiSandboxAngularFrontend"
  // Đọc thẳng từ biến này thay vì fetch endpoint nào đó — không có request mạng nào để
  // hỏng, và nó chính là nguồn mà trang thật đang dùng.
  const w = window.WIZ_global_data;
  if (!w || typeof w !== 'object') {
    return {
      error:
        'Không thấy window.WIZ_global_data trên ' +
        location.href +
        '. Trang có thể chưa load xong hoặc đây không phải trang Flow đã đăng nhập. ' +
        'Mở https://flow.google.com/project/<id> (đã đăng nhập), đợi trang hiện xong rồi thử lại.',
    };
  }

  const at = w.SNlM0e;
  const fsid = w.FdrFJe;
  const bl = w.cfb2h;
  const rpcPath = w.Im6cmf;

  // `at` là thứ duy nhất không thể thiếu — vắng nó nghĩa là chưa đăng nhập.
  if (!at) {
    return {
      error:
        'WIZ_global_data có mặt nhưng thiếu SNlM0e (at token) — thường là do chưa đăng nhập ' +
        'Google trên tab này. Đăng nhập lại tại https://flow.google.com rồi thử lại.',
    };
  }

  const missing = [];
  if (!fsid) missing.push('FdrFJe (f.sid)');
  if (!bl) missing.push('cfb2h (bl)');
  if (!rpcPath) missing.push('Im6cmf (rpc path)');

  return {
    label: document.title || location.hostname,
    origin: location.origin,
    at,
    fsid: fsid || null,
    bl: bl || null,
    rpcPath: rpcPath || '/_/AiSandboxAngularFrontend',
    // Không chặn cứng: Google có thể đổi tên key phụ, gửi được gì thì gửi, server sẽ báo
    // rõ nếu thật sự thiếu. Chỉ `at` mới là điều kiện dừng.
    warning: missing.length ? 'Thiếu key phụ trong WIZ_global_data: ' + missing.join(', ') : undefined,
  };
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
  if (!tab) {
    return { ok: false, error: "Không thấy tab Flow nào đang mở. Mở https://flow.google.com (đã đăng nhập) rồi thử lại." };
  }

  let collected;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: collectSessionInMainWorld,
    });
    collected = results && results[0] && results[0].result;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
  if (!collected || !collected.at) {
    return {
      ok: false,
      error: (collected && collected.error) || "collect thất bại (executeScript không trả kết quả)",
    };
  }
  if (collected.warning) console.warn("[flow-grabber]", collected.warning);
  console.log("[flow-grabber] lấy được at token từ", tab.url, "| bl:", collected.bl);

  const cookie = await getCookieHeader();
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: label || collected.label,
        cookie,
        origin: collected.origin,
        at: collected.at,
        fsid: collected.fsid,
        bl: collected.bl,
        rpcPath: collected.rpcPath,
      }),
    });
  } catch (e) {
    return { ok: false, error: "Không gọi được " + endpoint + ": " + (e && e.message) + " (app đang chạy chưa?)" };
  }
  // Server từ chối thì phải lộ nguyên văn — trước đây chỉ trả status trần, popup báo
  // "Gửi thất bại" và nguyên nhân thật (thiếu field, sai origin) biến mất.
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: "App trả HTTP " + res.status + (body ? ": " + body.slice(0, 300) : "") };
  }
  return { ok: true, status: res.status };
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
