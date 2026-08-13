// Background service worker.
//
// 2 nhiệm vụ:
//  A. Session (cookie + access_token): định kỳ ~5 phút POST /api/flow-auth/session.
//  B. reCAPTCHA token on-demand: khi content.js gửi 'POLL_TOKENS' (mỗi ~1.5s), fetch
//     GET /api/flow-auth/token-request; với mỗi pending → mint token trong MAIN world
//     của tab labs.google (executeScript) → POST token về /api/flow-auth/token-request.
//
// Vì sao mọi fetch + mint đều ở SW (không ở content script): CSP của labs.google chặn
// content script fetch cross-origin tới localhost và chặn inject <script> từ
// chrome-extension://. SW không bị CSP của trang ràng buộc và có host_permissions.

console.log('[flow-grabber] service worker đã load', new Date().toISOString());

const DEFAULT_SESSION_ENDPOINT = 'http://localhost:3000/api/flow-auth/session';
const ALARM_NAME = 'flow-session-refresh';

const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
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

/** Tìm tab labs.google đang mở. */
async function findLabsTab() {
  const tabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
  return tabs.find((t) => t.url && t.url.startsWith('https://labs.google')) || null;
}

// ---------- A. Session (cookie + access_token) ----------

function collectSessionInMainWorld() {
  async function run() {
    const res = await fetch('/fx/api/auth/session', { credentials: 'include' });
    if (!res.ok) throw new Error('GET session HTTP ' + res.status);
    const data = await res.json();
    if (!data.access_token) throw new Error('Không có access_token trong session');
    return { label: document.title || 'labs.google', accessToken: data.access_token };
  }
  return run();
}

function getCookieHeader() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ url: 'https://labs.google' }, (cookies) => {
      resolve((cookies || []).map((c) => `${c.name}=${c.value}`).join('; '));
    });
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
    return { ok: false, error: (collected && collected.error) || 'collect thất bại' };
  }

  const cookie = await getCookieHeader();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: label || collected.label, cookie, accessToken: collected.accessToken }),
  });
  return { ok: res.ok, status: res.status };
}

// ---------- B. reCAPTCHA token on-demand ----------

/** Mint 1 token trong MAIN world của tab labs.google. */
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

    // Chỉ cần tab labs.google khi thực sự phải mint.
    const tab = await findLabsTab();
    if (!tab) {
      console.warn('[flow-grabber] có pending nhưng không thấy tab labs.google để mint');
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
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
});
chrome.alarms.get(ALARM_NAME, (a) => {
  if (!a) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
});
