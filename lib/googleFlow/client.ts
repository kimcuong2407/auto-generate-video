/**
 * HTTP client thuần cho Google Flow API (reverse-engineered — xem
 * GoogleFlow.postman_collection.json).
 *
 * 2 host:
 * - LABS_BASE  = https://labs.google — session/auth, tRPC project/entity, upload,
 *   resolve media URL. Auth = session cookie.
 * - API_BASE   = https://aisandbox-pa.googleapis.com — generate/media API.
 *   Auth = Bearer accessToken.
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
    return await fetch(`${LABS_BASE}${path}`, {
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
    return await fetch(`${API_BASE}${path}`, {
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
