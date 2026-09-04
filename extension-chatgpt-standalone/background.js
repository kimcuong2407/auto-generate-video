// Service worker (MV3) — bản STANDALONE, không dính app review pipeline.
//
// Việc duy nhất: poll server nhỏ (scripts/chatgpt-image-server.mjs) lấy job gen ảnh, chạy
// automation NGAY trong tab chatgpt.com của người dùng, rồi POST ảnh base64 về server. Đồng thời
// lưu ảnh gần nhất vào storage để popup xem trước + tải xuống.
//
// Kiến trúc bàn giao kết quả giữ nguyên như extension-chatgpt gốc (đã trả giá bằng lỗi thật):
//   MAIN world --postMessage--> content.js --sendMessage--> service worker --fetch--> server
// Vì CSP chatgpt.com chặn cả trang lẫn content script fetch ra ngoài; chỉ SW fetch được.

importScripts('imageJob.js');

console.log('[cgimg-standalone] service worker load', new Date().toISOString());

const DEFAULT_SERVER = 'http://localhost:4123';
/** Đánh thức SW định kỳ kể cả khi không tab chatgpt.com nào tick — SW MV3 hay bị Chrome kill. */
const KEEPALIVE_ALARM = 'cgimg-standalone-keepalive';

/** Base URL server (bỏ dấu "/" cuối). Người dùng nhập trong popup, lưu ở storage.local. */
function getServerBase() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl'], (res) => {
      const base = (res.serverUrl || DEFAULT_SERVER).replace(/\/+$/, '');
      resolve(base);
    });
  });
}

let polling = false; // chặn chồng lượt khi content.js tick dồn (1.5s)

// Job đã bàn giao cho tab và chưa biết kết quả. Vì SW không await tới lúc xong (Chrome kill SW
// sau 30s idle), cần cờ này để lượt tick kế không claim thêm job trong khi tab đang gen job cũ.
let inFlightUntil = 0;
let inFlightJobId = '';
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

async function pollJobsOnce() {
  if (polling) return;
  polling = true;
  try {
    // Còn job đang gen trong tab → chưa nhận job mới.
    if (Date.now() < inFlightUntil) return;

    const base = await getServerBase();

    let data;
    try {
      const res = await fetch(base + '/jobs/next');
      if (!res.ok) return;
      data = await res.json();
    } catch (e) {
      return; // server chưa chạy / mạng lỗi — im lặng, lượt sau thử lại
    }

    const job = data && data.job;
    if (!job) {
      if (lastJobStatus.state === 'running') setStatus('idle');
      return;
    }

    console.log('[cgimg-standalone] nhận job', job.id);
    setStatus('running', job.id);

    const tab = await findChatgptTab();
    if (!tab) {
      await postResult(base, { jobId: job.id, error: 'Không tìm thấy tab chatgpt.com đang mở' });
      setStatus('error', 'chưa mở tab chatgpt.com');
      return;
    }

    // CHỈ KHỞI ĐỘNG rồi buông — script trong trang tự POST kết quả về khi xong (xem imageJob.js).
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

    if (!started || !started.started) {
      const msg = (started && started.reason) || 'Không khởi động được job trong tab';
      await postResult(base, { jobId: job.id, error: msg });
      setStatus('error', msg);
      return;
    }

    inFlightUntil = Date.now() + IN_FLIGHT_MS;
    inFlightJobId = job.id;
    console.log('[cgimg-standalone] đã bàn giao job cho tab', job.id);
    setStatus('running', job.id + ' (đang gen trong tab)');
  } finally {
    polling = false;
  }
}

async function postResult(base, body) {
  try {
    await fetch(base + '/jobs/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn('[cgimg-standalone] không nộp được kết quả:', e && e.message);
  }
}

/** Nộp kết quả về server + lưu ảnh gần nhất cho popup. */
async function handleJobResult(payload) {
  const base = await getServerBase();

  let body = payload;
  // Trang chỉ đưa URL → SW tự tải (có host_permissions chatgpt.com nên request tự mang cookie).
  if (payload.imageUrl) {
    try {
      const res = await fetch(payload.imageUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      const type = res.headers.get('content-type') || '';
      const ext = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
      let binary = '';
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      body = { jobId: payload.jobId, imageBase64: btoa(binary), ext };
      console.log('[cgimg-standalone] đã tải ảnh', Math.round(bytes.length / 1024), 'KB');
    } catch (e) {
      body = { jobId: payload.jobId, error: 'Tải ảnh từ ChatGPT thất bại: ' + (e && e.message ? e.message : e) };
    }
  }

  await postResult(base, body);

  // Lưu để popup xem trước + tải (kể cả khi popup đang đóng lúc job xong).
  try {
    chrome.storage.local.set({
      lastResult: {
        jobId: body.jobId,
        imageBase64: body.imageBase64 || null,
        ext: body.ext || null,
        error: body.error || null,
        at: Date.now(),
      },
    });
  } catch (e) {
    /* ảnh quá lớn cho storage — bỏ qua, server vẫn có bản chuẩn */
  }

  if (payload.jobId === inFlightJobId) inFlightUntil = 0;
  if (body.error) {
    setStatus('error', body.error);
    console.warn('[cgimg-standalone] job lỗi', payload.jobId, body.error);
  } else {
    setStatus('done', payload.jobId);
    console.log('[cgimg-standalone] xong job', payload.jobId);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'POLL_JOBS') {
    void pollJobsOnce();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'GET_JOB_STATUS') {
    sendResponse(lastJobStatus);
    return false;
  }
  if (msg?.type === 'JOB_RESULT' && msg.payload) {
    void handleJobResult(msg.payload);
    sendResponse({ ok: true });
    return false;
  }
});

/** Nạp lại content.js vào tab chatgpt.com đang mở — cứu trường hợp orphan sau khi reload extension. */
async function reinjectContentScript() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (e) {
        /* tab chưa load xong — lượt alarm sau thử lại */
      }
    }
  } catch (e) {
    console.warn('[cgimg-standalone] reinjectContentScript lỗi:', e && e.message);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    pollJobsOnce().catch((err) => console.error('[cgimg-standalone]', err));
    reinjectContentScript();
  }
});

function ensureAlarm() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

reinjectContentScript();
