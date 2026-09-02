// Background service worker. HAI nhiệm vụ:
//
// A. SESSION (~5 phút/lần): đọc cookie chatgpt.com rồi POST về /api/chatgpt-auth/session để app
//    biết tài khoản còn đăng nhập hay đã bị đá ra.
//
//    Cookie ở đây CHỈ để xác minh trạng thái login, KHÔNG dùng dựng lại phiên phía server:
//    ChatGPT chặn HTTP thuần bằng Cloudflare Turnstile và token còn nằm ở localStorage/
//    IndexedDB (xem docs/IMPLEMENTATION_CHATGPT_IMAGE_GEN.md mục 0).
//
// B. GEN ẢNH (nhịp ~1.5s do content.js đánh thức): poll /api/chatgpt-image/worker lấy job, chạy
//    automation NGAY TRONG tab chatgpt.com của người dùng, rồi POST ảnh base64 về app.
//
//    Đây là cách đi vòng qua đúng ba rào đã chặn hướng Playwright-trên-server: không phải copy
//    profile (Keychain macOS mã hoá cookie), không phải dựng lại phiên từ cookie, không lệch
//    fingerprint/IP — vì automation chạy trong chính trình duyệt thật đã đăng nhập.
//
//    Đánh đổi: Chrome phải mở và có tab chatgpt.com thì job mới chạy.

// Nạp logic DOM gen ảnh (runImageJobInPage). Tách file vì nó dài ~230 dòng và là bản port của
// lib/chatgptImage/{runner,domScript}.ts — để lẫn vào đây thì không ai soi được cái nào lệch
// khi ChatGPT đổi giao diện. importScripts chạy được vì SW này là classic script (manifest
// không khai báo "type": "module").
importScripts('imageJob.js');

console.log('[chatgpt-grabber] service worker đã load', new Date().toISOString());

const DEFAULT_ENDPOINT = 'https://video.homebox.vn/api/chatgpt-auth/session';
const ALARM_NAME = 'chatgpt-session-refresh';
/** Đánh thức SW định kỳ kể cả khi không có tab chatgpt.com nào tick — SW MV3 hay bị kill. */
const KEEPALIVE_ALARM = 'chatgpt-image-keepalive';
const WORKER_PATH = '/api/chatgpt-image/worker';

/**
 * Suy base URL của app từ endpoint session đã cấu hình, để route gen ảnh dùng chung một chỗ
 * cài đặt. Giữ nguyên ô "endpoint" cũ trong popup thay vì bắt nhập thêm URL thứ hai — người
 * dùng đã cấu hình rồi thì không có lý do bắt làm lại.
 */
function baseFromEndpoint(endpoint) {
  try {
    return new URL(endpoint).origin;
  } catch (e) {
    return new URL(DEFAULT_ENDPOINT).origin;
  }
}

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

// ---------- B. Poll job gen ảnh ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let polling = false; // chặn chồng lượt khi tick dồn (content.js tick 1.5s)

/**
 * Job đã bàn giao cho tab và chưa biết kết quả. Vì SW không còn await tới lúc xong, nếu không
 * có cờ này thì lượt tick kế (1.5s sau) sẽ claim thêm job trong khi tab vẫn đang gen job cũ —
 * hai job tranh nhau cùng một ô nhập ChatGPT.
 *
 * Có deadline vì SW có thể bị kill rồi hồi sinh với cờ đã mất, hoặc tab bị đóng giữa chừng:
 * quá hạn thì coi như xong để không kẹt vĩnh viễn. Dài hơn timeout 10 phút của script trong
 * trang một chút.
 */
let inFlightUntil = 0;
let inFlightJobId = '';
// Dài hơn trần cứng 20 phút của script trong trang, để cờ không nhả sớm khi job còn chạy.
const IN_FLIGHT_MS = 21 * 60 * 1000;

/** Trạng thái cho popup đọc — không persist, mất khi SW bị kill là chấp nhận được. */
let lastJobStatus = { state: 'idle', at: Date.now(), detail: '' };

function setStatus(state, detail) {
  lastJobStatus = { state, at: Date.now(), detail: detail || '' };
}

async function findChatgptTab() {
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
  return tabs && tabs.length > 0 ? tabs[0] : null;
}

/**
 * Một lượt: hỏi server có job không → chạy trong tab → nộp kết quả.
 *
 * GET luôn được gọi kể cả khi chưa có tab chatgpt.com, vì nó đồng thời là NHỊP TIM báo cho
 * server biết extension còn sống (markExtensionPolled). Bỏ qua GET lúc không có tab thì server
 * tưởng extension chết và từ chối luôn lệnh gen tiếp theo.
 */
async function pollJobsOnce() {
  if (polling) return;
  polling = true;
  try {
    const { endpoint } = await getConfig();
    const base = baseFromEndpoint(endpoint);

    // Còn job đang gen trong tab → CHỈ gửi nhịp tim, không claim thêm.
    // Vẫn phải gọi GET: đó là cách server biết extension còn sống. Bỏ hẳn thì trong suốt vài
    // phút gen ảnh server sẽ tưởng extension chết và từ chối lệnh gen kế tiếp.
    if (Date.now() < inFlightUntil) {
      // Hỏi server job còn chạy không — trang POST xong thì server biết trước SW. Nhờ đó nhả cờ
      // ngay khi job kết thúc thay vì chờ hết 11 phút, và người dùng gen ảnh tiếp được luôn.
      try {
        const res = await fetch(base + WORKER_PATH + '?probe=' + encodeURIComponent(inFlightJobId));
        const info = await res.json();
        if (info && info.jobDone) {
          inFlightUntil = 0;
          setStatus(info.jobFailed ? 'error' : 'done', inFlightJobId);
        }
      } catch (e) {
        /* mạng lỗi — giữ cờ, lượt sau hỏi lại */
      }
      return;
    }

    let data;
    try {
      const res = await fetch(base + WORKER_PATH, { method: 'GET' });
      if (!res.ok) return;
      data = await res.json();
    } catch (e) {
      return; // app chưa chạy / mạng lỗi — im lặng, lượt sau thử lại
    }

    const job = data && data.job;
    if (!job) {
      if (lastJobStatus.state === 'running') setStatus('idle');
      return;
    }

    console.log('[chatgpt-image] nhận job', job.id);
    setStatus('running', job.id);

    const tab = await findChatgptTab();
    // Có job mà không có tab: phải báo FAIL về server, không được im lặng. Im lặng thì job nằm
    // 'running' tới khi reapStaleJobs dọn sau 15 phút, còn người dùng thì ngồi chờ vô ích.
    if (!tab) {
      await postResult(base, { jobId: job.id, error: 'Không tìm thấy tab chatgpt.com đang mở' });
      setStatus('error', 'chưa mở tab chatgpt.com');
      return;
    }

    // CHỈ KHỞI ĐỘNG rồi buông. Script trong trang tự POST kết quả về app khi xong.
    //
    // Vì sao không await tới lúc có ảnh: service worker MV3 bị Chrome kill sau 30 giây idle, và
    // mọi lời gọi API đơn lẻ bị cắt ở mốc 5 phút. Await ở đây thì SW không gọi API nào trong
    // suốt lúc chờ → timer idle không được reset → SW chết giữa chừng, ảnh lấy được cũng không
    // còn ai nhận, job kẹt 'running' vĩnh viễn (đã gặp đúng lỗi này với job cgimg-66caf914d5f1).
    // Trang web không có giới hạn đó nên để nó tự nộp.
    let started;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: runImageJobInPage,
        args: [job],
      });
      started = results && results[0] && results[0].result;
    } catch (err) {
      const msg = 'Chạy script trong tab thất bại: ' + (err && err.message ? err.message : err);
      await postResult(base, { jobId: job.id, error: msg });
      setStatus('error', msg);
      return;
    }

    // Không khởi động được (tab đang chạy job khác) → trả job về bằng cách báo lỗi, để lượt sau
    // hoặc extension khác nhận. Im lặng thì job kẹt 'running' tới lúc reap.
    if (!started || !started.started) {
      const msg = (started && started.reason) || 'Không khởi động được job trong tab';
      await postResult(base, { jobId: job.id, error: msg });
      setStatus('error', msg);
      return;
    }

    // Từ đây SW hết việc. Trang tự POST kết quả; SW có bị kill cũng không ảnh hưởng.
    inFlightUntil = Date.now() + IN_FLIGHT_MS;
    inFlightJobId = job.id;
    console.log('[chatgpt-image] đã bàn giao job cho tab', job.id);
    setStatus('running', job.id + ' (đang gen trong tab)');
  } finally {
    polling = false;
  }
}

/**
 * Nạp lại content.js vào mọi tab chatgpt.com đang mở.
 *
 * Vì sao cần: reload extension ở chrome://extensions làm content script CŨ trên tab đang mở bị
 * orphan ("Extension context invalidated") — nó tự dừng vòng tick vĩnh viễn, và trước đây chỉ F5
 * tab thủ công mới cứu được. Vòng tick chết = SW không được đánh thức = job nằm chờ, mà triệu
 * chứng nhìn từ ngoài giống hệt "extension hỏng". extension-flow đã trả giá đúng bài này
 * (xem reinjectContentScript bên đó) nên làm y vậy: tự hồi phục, không bắt người dùng nhớ F5.
 */
async function reinjectContentScript() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (e) {
        // Tab chưa load xong / trang lỗi — lượt alarm sau thử lại.
      }
    }
  } catch (e) {
    console.warn('[chatgpt-image] reinjectContentScript lỗi:', e && e.message);
  }
}

async function postResult(base, body) {
  try {
    await fetch(base + WORKER_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn('[chatgpt-image] không nộp được kết quả:', e && e.message);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PUSH_NOW') {
    pushSessionOnce()
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  // content.js tick — đây là thứ đánh thức SW dậy đều đặn.
  if (msg?.type === 'POLL_JOBS') {
    void pollJobsOnce();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'GET_JOB_STATUS') {
    sendResponse(lastJobStatus);
    return false;
  }
  // Kết quả gen ảnh từ MAIN world, đi qua content script. SW là bên DUY NHẤT fetch được về app
  // (CSP của chatgpt.com chặn cả trang lẫn content script).
  if (msg?.type === 'JOB_RESULT' && msg.payload) {
    void handleJobResult(msg.payload);
    sendResponse({ ok: true });
    return false;
  }
});

/** Nộp kết quả về app rồi nhả cờ để nhận job tiếp. */
async function handleJobResult(payload) {
  const { endpoint } = await getConfig();
  const base = baseFromEndpoint(endpoint);

  let body = payload;
  // Trang chỉ đưa URL → SW tải ảnh về (nó có host_permissions chatgpt.com nên request tự mang
  // cookie phiên, và không bị CSP của trang ràng buộc).
  if (payload.imageUrl) {
    try {
      const res = await fetch(payload.imageUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      const type = res.headers.get('content-type') || '';
      const ext = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
      // Chuyển sang base64 theo từng khối, tránh tràn stack với ảnh vài MB.
      let binary = '';
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      body = { jobId: payload.jobId, imageBase64: btoa(binary), ext };
      console.log('[chatgpt-image] đã tải ảnh', Math.round(bytes.length / 1024), 'KB');
    } catch (e) {
      body = { jobId: payload.jobId, error: 'Tải ảnh từ ChatGPT thất bại: ' + (e && e.message ? e.message : e) };
    }
  }

  await postResult(base, body);

  // Nhả cờ NGAY: job đã xong, không việc gì phải chờ hết deadline 11 phút mới nhận job kế.
  if (payload.jobId === inFlightJobId) {
    inFlightUntil = 0;
  }
  if (body.error) {
    setStatus('error', body.error);
    console.warn('[chatgpt-image] job lỗi', payload.jobId, body.error);
  } else {
    setStatus('done', payload.jobId);
    console.log('[chatgpt-image] đã nộp ảnh cho app', payload.jobId);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    pushSessionOnce().catch((err) => console.error('[chatgpt-grabber]', err));
  }
  // Keepalive: giữ nhịp poll job kể cả khi không tab chatgpt.com nào tick (tab bị throttle,
  // hoặc người dùng đóng tab). Vẫn gửi được nhịp tim để server biết extension còn sống.
  if (alarm.name === KEEPALIVE_ALARM) {
    pollJobsOnce().catch((err) => console.error('[chatgpt-image]', err));
    // Nạp lại content script cho tab mở sẵn — cứu trường hợp orphan sau khi reload extension.
    reinjectContentScript();
  }
});

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
  // 1 phút là chu kỳ nhỏ nhất Chrome cho phép với alarm.
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

// Nạp lại ngay khi SW load, không đợi nhịp alarm đầu tiên (tới 1 phút) — đây là lúc vừa reload
// extension, đúng thời điểm content script cũ vừa chết.
reinjectContentScript();
