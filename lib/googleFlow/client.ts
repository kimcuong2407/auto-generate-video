/**
 * HTTP client thuần cho Google Flow API (reverse-engineered).
 *
 * LỊCH SỬ QUAN TRỌNG (2026-09): Google đã gỡ hẳn kiến trúc cũ. HAR ghi ngày 2026-09-04
 * (docs/flow.google.com.har) không còn MỘT request nào tới aisandbox-pa.googleapis.com,
 * không còn header Bearer, không còn /fx/api/auth/session. Toàn bộ Flow giờ chạy qua
 * BatchExecute trên chính flow.google.com:
 *
 *   POST https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute
 *        ?rpcids=<id>&source-path=<path>&bl=<build>&f.sid=<sid>&hl=vi&_reqid=<n>&rt=c
 *   Content-Type: application/x-www-form-urlencoded;charset=UTF-8
 *   Cookie: <cookie phiên Google>
 *   body: f.req=[[["<rpcid>","<payload JSON đã stringify>",null,"generic"]]]&at=<SNlM0e>
 *
 * Auth = cookie + `at` (XSRF token). Cả hai do extension thu từ tab Flow thật.
 *
 * API_BASE/apiRequest bên dưới giữ lại CHỈ để code gen ảnh/video cũ còn compile; chúng
 * gọi vào host đã chết và sẽ fail. Việc port gen sang batchexecute cần HAR có thao tác
 * generate thật (HAR hiện tại chỉ có các RPC lúc mở trang).
 */

import { FlowApiError } from './errors';

export const LABS_BASE = 'https://labs.google';
export const API_BASE = 'https://aisandbox-pa.googleapis.com';

export const RECAPTCHA_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

export const RECAPTCHA_ACTION_IMAGE = 'IMAGE_GENERATION';
export const RECAPTCHA_ACTION_VIDEO = 'VIDEO_GENERATION';

const DEFAULT_TIMEOUT_MS = 60_000;

function buildErrorMessage(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 400);
  return `Google Flow HTTP ${status}${snippet ? `: ${snippet}` : ''}`;
}

/**
 * Retry 1 lần khi fetch() ném lỗi mạng "fetch failed" thuần (undici) — thường do socket
 * keep-alive bị phía server đóng âm thầm sau khi idle lâu (dev server chạy nhiều giờ). Không
 * retry lỗi abort (timeout) hay các lỗi khác — chỉ lỗi kết nối cấp thấp này mới đáng thử lại.
 */
export async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof TypeError && err.message === 'fetch failed') {
      return await fetch(url, init);
    }
    throw err;
  }
}

/** Gọi request tới labs.google (auth = cookie). `json` nếu có sẽ gửi body JSON. */
export async function labsRequest(
  path: string,
  opts: {
    cookie: string;
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    json?: unknown;
    contentType?: string;
    timeoutMs?: number;
  }
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = { Cookie: opts.cookie };
  let body: string | undefined;

  if (opts.json !== undefined) {
    headers['Content-Type'] = opts.contentType ?? 'application/json';
    body = JSON.stringify(opts.json);
  }

  try {
    return await fetchRetry(`${LABS_BASE}${path}`, {
      method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'),
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Gọi request tới aisandbox-pa.googleapis.com (auth = Bearer accessToken). */
export async function apiRequest(
  path: string,
  opts: {
    accessToken: string;
    json?: unknown;
    contentType?: string;
    timeoutMs?: number;
  }
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.accessToken}` };
  let body: string | undefined;

  if (opts.json !== undefined) {
    headers['Content-Type'] = opts.contentType ?? 'text/plain;charset=UTF-8';
    body = JSON.stringify(opts.json);
  }

  try {
    return await fetchRetry(`${API_BASE}${path}`, {
      method: opts.json !== undefined ? 'POST' : 'GET',
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse response, throw FlowApiError khi không ok. Trả body JSON đã parse. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new FlowApiError(buildErrorMessage(res.status, text), res.status);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FlowApiError('Google Flow trả về body không phải JSON', res.status, text.slice(0, 300));
  }
}

// ---------- BatchExecute (kiến trúc hiện hành) ----------

export const FLOW_BASE = 'https://flow.google.com';

export interface BatchExecuteCreds {
  cookie: string;
  at: string;
  fsid: string | null;
  bl: string | null;
  rpcPath: string;
  origin: string;
}

/**
 * `_reqid` phải tăng dần trong một phiên (trang thật dùng reqid + 100000 mỗi lần gọi).
 * Google không kiểm chặt, nhưng gửi trùng liên tục thì dễ bị coi là replay.
 */
let reqidCounter = Math.floor(Date.now() % 100000);
function nextReqid(): number {
  reqidCounter += 100000;
  return reqidCounter;
}

/**
 * Gọi 1 RPC qua batchexecute.
 *
 * @param rpcid  id RPC, vd 'mrlkwd' (load project), 'o30O0e' (user info).
 * @param payload mảng tham số của RPC — sẽ được JSON.stringify NGUYÊN VẸN vào f.req.
 *                Google lồng JSON trong JSON, nên đây là stringify 2 lớp, không phải lỗi.
 * @param sourcePath giá trị query source-path, vd '/project/<uuid>'.
 */
export async function batchExecute(
  rpcid: string,
  payload: unknown,
  opts: {
    creds: BatchExecuteCreds;
    sourcePath?: string;
    hl?: string;
    timeoutMs?: number;
  }
): Promise<unknown> {
  const { creds } = opts;
  const qs = new URLSearchParams({ rpcids: rpcid, 'source-path': opts.sourcePath ?? '/', hl: opts.hl ?? 'vi' });
  if (creds.bl) qs.set('bl', creds.bl);
  if (creds.fsid) qs.set('f.sid', creds.fsid);
  qs.set('_reqid', String(nextReqid()));
  qs.set('rt', 'c');

  const url = `${creds.origin}${creds.rpcPath}/data/batchexecute?${qs}`;
  const body = new URLSearchParams({
    'f.req': JSON.stringify([[[rpcid, JSON.stringify(payload), null, 'generic']]]),
    at: creds.at,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchRetry(url, {
      method: 'POST',
      headers: {
        Cookie: creds.cookie,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Origin: creds.origin,
        Referer: `${creds.origin}/`,
        // Google từ chối batchexecute thiếu header này (coi là cross-site).
        'X-Same-Domain': '1',
      },
      body: body.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new FlowApiError(buildErrorMessage(res.status, text), res.status);
  }
  return parseBatchExecute(text, rpcid);
}

/**
 * Parse response batchexecute.
 *
 * Format (rt=c): dòng `)]}'` rồi lặp [độ dài] + [JSON chunk]. Mỗi chunk là mảng các
 * envelope; envelope ta cần có dạng ["wrb.fr", "<rpcid>", "<payload JSON>", ...].
 * Payload lại là JSON string lồng bên trong — phải parse lớp thứ hai.
 *
 * Không tự tách theo độ dài mà quét từng dòng: các dòng độ dài là số nguyên đứng riêng,
 * bỏ qua chúng và thử JSON.parse phần còn lại. Cách này miễn nhiễm với việc Google đổi
 * cách chia chunk (đã đổi ít nhất 1 lần trong quá khứ).
 */
export function parseBatchExecute(text: string, rpcid: string): unknown {
  const body = text.replace(/^\)\]\}'\n?/, '');
  for (const line of body.split('\n')) {
    const t = line.trim();
    // Dòng chỉ chứa số = độ dài chunk kế tiếp, không phải dữ liệu.
    if (!t || /^\d+$/.test(t)) continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(t);
    } catch {
      continue;
    }
    if (!Array.isArray(chunk)) continue;
    for (const env of chunk) {
      if (!Array.isArray(env) || env[0] !== 'wrb.fr' || env[1] !== rpcid) continue;
      const inner = env[2];
      if (typeof inner !== 'string') return inner ?? null;
      try {
        return JSON.parse(inner);
      } catch {
        return inner;
      }
    }
  }
  throw new FlowApiError(
    `Không tìm thấy kết quả RPC ${rpcid} trong response batchexecute. ` +
      `Thường là do cookie/at đã hết hạn (Google trả trang đăng nhập). Body: ${text.slice(0, 200)}`
  );
}
