#!/usr/bin/env node
/**
 * Máy chủ hàng đợi gen ảnh ChatGPT — bản TỐI GIẢN, tách rời khỏi Next.js + MySQL.
 *
 * Mục đích: cấp prompt cho `extension-chatgpt-standalone/` theo dạng JSON qua API, rồi nhận ảnh
 * base64 về — KHÔNG cần dựng app review pipeline, KHÔNG cần MySQL, KHÔNG cần SSH tunnel.
 * Hàng đợi nằm trong bộ nhớ (mất khi tắt process) — đúng nhu cầu "đẩy prompt → lấy ảnh".
 *
 * Zero-dependency: chỉ dùng `node:http`. Chạy: `node scripts/chatgpt-image-server.mjs`
 * (đổi cổng bằng biến môi trường PORT, mặc định 4123).
 *
 * ===== HỢP ĐỒNG JSON =====
 *
 *   POST /jobs
 *     body: { "prompt": "...", "refImages"?: [ { "url": "https://..." } | { "dataUrl": "data:image/...;base64,..." , "name"?: "ref.jpg" } ] }
 *     → 201 { "id": "img-..." }
 *     (refImages có "url" sẽ được server tự tải + chuyển sang dataUrl để extension đính thẳng.)
 *
 *   GET /jobs/next        (extension poll — lấy job cũ nhất đang chờ, đánh dấu running)
 *     → { "job": { "id", "prompt", "refImages": [ { "dataUrl", "name" } ] } }  hoặc  {}
 *
 *   POST /jobs/result     (extension nộp kết quả)
 *     body: { "jobId", "imageBase64", "ext" }  hoặc  { "jobId", "error" }
 *     → { "ok": true }
 *
 *   GET /jobs/:id         (bên gọi poll lấy ảnh)
 *     → { "status": "queued"|"running"|"done"|"error", "imageBase64"?, "ext"?, "error"? }
 *
 *   GET /jobs             (debug — danh sách, không kèm base64)
 *   GET /health           → { "ok": true, ...thống kê }
 *
 * Logic hàng đợi tách thành `createQueue()` (export) để `scripts/check-image-server-queue.mjs`
 * assert được mà không cần mở cổng mạng.
 */

import http from 'node:http';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Trần thời gian một job được phép 'running' trước khi coi là hỏng (extension không trả về). */
const DEFAULT_STALE_MS = 25 * 60 * 1000;
/** Chặn body quá lớn — refImages base64 có thể vài MB, cho tối đa ~40MB. */
const MAX_BODY_BYTES = 40 * 1024 * 1024;

/**
 * Hàng đợi thuần trong bộ nhớ. Mọi hàm nhận `now` để test được thời gian mà không cần chờ thật.
 */
export function createQueue({ staleMs = DEFAULT_STALE_MS } = {}) {
  /** @type {Map<string, any>} */
  const jobs = new Map();
  let seq = 0;

  function enqueue({ prompt, refImages }) {
    const id = 'img-' + Date.now().toString(36) + '-' + (++seq).toString(36);
    const job = {
      id,
      prompt,
      refImages: Array.isArray(refImages) ? refImages : [],
      status: 'queued',
      imageBase64: null,
      ext: null,
      file: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    jobs.set(id, job);
    return job;
  }

  /** Đưa mọi job 'running' quá hạn về 'error' — extension đã chết/đóng tab giữa chừng. */
  function reap(now = Date.now()) {
    for (const j of jobs.values()) {
      if (j.status === 'running' && j.startedAt != null && now - j.startedAt > staleMs) {
        j.status = 'error';
        j.error = 'timeout: extension không trả kết quả trong ' + Math.round(staleMs / 60000) + ' phút';
        j.finishedAt = now;
      }
    }
  }

  /** Lấy job 'queued' cũ nhất, đánh dấu 'running'. Trả null nếu không còn. */
  function claimNext(now = Date.now()) {
    reap(now);
    let oldest = null;
    for (const j of jobs.values()) {
      if (j.status === 'queued' && (oldest === null || j.createdAt < oldest.createdAt)) oldest = j;
    }
    if (!oldest) return null;
    oldest.status = 'running';
    oldest.startedAt = now;
    return oldest;
  }

  function complete(id, { imageBase64, ext, error, file } = {}) {
    const j = jobs.get(id);
    if (!j) return null;
    j.finishedAt = Date.now();
    if (error) {
      j.status = 'error';
      j.error = String(error);
    } else {
      j.status = 'done';
      j.imageBase64 = imageBase64 || null;
      j.ext = ext || 'png';
      j.file = file || null;
    }
    return j;
  }

  function get(id) {
    return jobs.get(id) || null;
  }

  function list() {
    return [...jobs.values()].map((j) => ({
      id: j.id,
      status: j.status,
      promptPreview: (j.prompt || '').slice(0, 80),
      refCount: j.refImages.length,
      hasImage: Boolean(j.imageBase64),
      error: j.error,
      createdAt: j.createdAt,
    }));
  }

  function stats(now = Date.now()) {
    reap(now);
    let queued = 0, running = 0, done = 0, error = 0;
    for (const j of jobs.values()) {
      if (j.status === 'queued') queued++;
      else if (j.status === 'running') running++;
      else if (j.status === 'done') done++;
      else if (j.status === 'error') error++;
    }
    return { total: jobs.size, queued, running, done, error };
  }

  return { enqueue, claimNext, complete, get, list, reap, stats, _jobs: jobs };
}

/**
 * Chuẩn hoá refImages về dạng { dataUrl, name } mà extension đính thẳng được.
 * Ảnh dạng { url } sẽ được TẢI Ở SERVER (Node có global fetch từ v18) rồi mã hoá base64 —
 * để extension khỏi phải xin quyền host cho từng domain ảnh lạ.
 */
async function normalizeRefImages(refImages) {
  if (!Array.isArray(refImages)) return [];
  const out = [];
  for (const r of refImages) {
    if (r && typeof r.dataUrl === 'string' && r.dataUrl.startsWith('data:')) {
      out.push({ dataUrl: r.dataUrl, name: r.name || 'ref.jpg' });
      continue;
    }
    if (r && typeof r.url === 'string') {
      const res = await fetch(r.url);
      if (!res.ok) throw new Error('Tải ref image thất bại (' + r.url + '): HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') || 'image/jpeg';
      const name = r.name || (r.url.split('/').pop() || 'ref').split('?')[0] || 'ref.jpg';
      out.push({ dataUrl: `data:${type};base64,${buf.toString('base64')}`, name });
      continue;
    }
    throw new Error('refImages phần tử phải có "url" hoặc "dataUrl"');
  }
  return out;
}

/**
 * Ghi ảnh base64 ra file trong `dir`, tên theo jobId. Tạo thư mục nếu chưa có. Trả về đường dẫn.
 * jobId được làm sạch để không thoát khỏi thư mục hay dính ký tự lạ.
 */
export function saveImageFile(dir, jobId, base64, ext = 'png') {
  mkdirSync(dir, { recursive: true });
  // Bỏ cả dấu chấm khỏi phần jobId để không sinh ".." trong tên (jobId thật không có dấu chấm);
  // dấu chấm duy nhất là của phần mở rộng ta tự nối bên dưới.
  const safe = String(jobId).replace(/[^a-zA-Z0-9_-]/g, '_') || 'img';
  const file = path.join(dir, safe + '.' + (ext || 'png'));
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

// ---------- Lớp HTTP ----------

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body quá lớn (> ' + Math.round(MAX_BODY_BYTES / 1024 / 1024) + 'MB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('JSON không hợp lệ: ' + (e && e.message)));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(queue, { outputDir } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';

    if (method === 'OPTIONS') return sendJson(res, 204, {});

    try {
      // Đẩy job mới.
      if (method === 'POST' && path === '/jobs') {
        const body = await readJsonBody(req);
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (!prompt) return sendJson(res, 400, { error: 'Thiếu "prompt"' });
        let refImages;
        try {
          refImages = await normalizeRefImages(body.refImages);
        } catch (e) {
          return sendJson(res, 400, { error: String(e && e.message ? e.message : e) });
        }
        const job = queue.enqueue({ prompt, refImages });
        console.log('[image-server] + job', job.id, '| ref:', refImages.length, '| prompt:', prompt.slice(0, 60));
        return sendJson(res, 201, { id: job.id });
      }

      // Extension poll lấy job.
      if (method === 'GET' && path === '/jobs/next') {
        const job = queue.claimNext();
        if (!job) return sendJson(res, 200, {});
        console.log('[image-server] → giao job', job.id, 'cho extension');
        return sendJson(res, 200, {
          job: { id: job.id, prompt: job.prompt, refImages: job.refImages },
        });
      }

      // Extension nộp kết quả.
      if (method === 'POST' && path === '/jobs/result') {
        const body = await readJsonBody(req);
        const jobId = body.jobId;
        if (!jobId) return sendJson(res, 400, { error: 'Thiếu "jobId"' });

        // Ảnh xong + có thư mục output → ghi thẳng ra file cho pipeline đọc, khỏi giải base64.
        let file;
        if (!body.error && body.imageBase64 && outputDir) {
          try {
            file = saveImageFile(outputDir, jobId, body.imageBase64, body.ext);
          } catch (e) {
            console.warn('[image-server] ghi file ảnh thất bại:', e && e.message);
          }
        }

        const j = queue.complete(jobId, { ...body, file });
        if (!j) return sendJson(res, 404, { error: 'Không thấy job ' + jobId });
        console.log(
          '[image-server] ✓ job', jobId,
          j.status === 'done' ? '→ ' + (file || '(chỉ base64, chưa cấu hình output)') : '(lỗi: ' + j.error + ')'
        );
        return sendJson(res, 200, { ok: true, file });
      }

      // Debug: danh sách job.
      if (method === 'GET' && path === '/jobs') {
        return sendJson(res, 200, { jobs: queue.list() });
      }

      // Poll kết quả 1 job.
      if (method === 'GET' && path.startsWith('/jobs/')) {
        const id = decodeURIComponent(path.slice('/jobs/'.length));
        const j = queue.get(id);
        if (!j) return sendJson(res, 404, { error: 'Không thấy job ' + id });
        return sendJson(res, 200, {
          id: j.id,
          status: j.status,
          file: j.status === 'done' ? j.file || undefined : undefined,
          imageBase64: j.status === 'done' ? j.imageBase64 : undefined,
          ext: j.status === 'done' ? j.ext : undefined,
          error: j.error || undefined,
        });
      }

      if (method === 'GET' && (path === '/health' || path === '/')) {
        return sendJson(res, 200, { ok: true, ...queue.stats() });
      }

      return sendJson(res, 404, { error: 'Không có route ' + method + ' ' + path });
    } catch (e) {
      return sendJson(res, 500, { error: String(e && e.message ? e.message : e) });
    }
  });
}

// Chỉ mở cổng khi chạy trực tiếp (không phải khi bị import bởi check script).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 4123);
  const outputDir = path.resolve(process.env.IMAGE_OUTPUT_DIR || path.join(process.cwd(), 'output'));
  const queue = createQueue();
  createServer(queue, { outputDir }).listen(port, () => {
    console.log('[image-server] đang chạy tại http://localhost:' + port);
    console.log('  Ảnh xong tự lưu vào: ' + outputDir + '  (đổi bằng biến IMAGE_OUTPUT_DIR)');
    console.log('  Đẩy job:   curl -X POST http://localhost:' + port + '/jobs -H "Content-Type: application/json" -d \'{"prompt":"..."}\'');
    console.log('  Lấy ảnh:   curl http://localhost:' + port + '/jobs/<id>   (trả cả "file" lẫn "imageBase64")');
    console.log('  Extension trỏ Server URL về: http://localhost:' + port);
  });
}
