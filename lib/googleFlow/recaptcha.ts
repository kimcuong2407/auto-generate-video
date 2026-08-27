/**
 * On-demand mint reCAPTCHA Enterprise token.
 *
 * reCAPTCHA token chỉ mint được trong browser thật trên labs.google (window.grecaptcha
 * .enterprise), sống ~2 phút và one-time-use. Thay vì mint sẵn định kỳ (dễ hết hạn/đã
 * dùng), ta mint THEO YÊU CẦU: khi cần token, tạo 1 pending request rồi `await`; extension
 * (content script trên tab labs.google) short-poll thấy pending → mint token tươi → POST
 * về /api/flow-auth/token-request → resolve promise đang chờ.
 *
 * State (pending registry) nằm trong recaptchaState (globalThis) để sống sót hot-reload.
 * KHÔNG ghi token ra đĩa.
 */

import { getActiveAccount, updateAccessToken } from './authStore';
import { labsRequest, readJson } from './client';
import { FlowApiError } from './errors';
import { recaptchaState } from './recaptchaState';
import type { FlowAccount } from './authStore';

/** Chờ extension mint token tối đa 20s khi poller đang khoẻ. */
const MINT_TIMEOUT_MS = 20_000;

/**
 * Khi poller có vẻ đang ngủ, phải chờ đủ lâu để alarm keepalive (chu kỳ 1 phút) kịp
 * đánh thức service worker và mint. 20s là quá ngắn — sẽ timeout oan ngay trước khi
 * extension kịp tỉnh.
 */
const MINT_TIMEOUT_ASLEEP_MS = 90_000;

/**
 * Ngưỡng coi poller là offline.
 *
 * KHÔNG được đặt gần nhịp tick (1.5s) của content script: Chrome throttle setInterval
 * trong tab nền xuống >=60s/lần, và service worker MV3 bị kill sau ~30s idle. Với
 * ngưỡng 10s cũ, chỉ cần Mr.D chuyển tab vài phút là mọi lệnh gen bị reject oan dù
 * session vẫn tốt. Alarm keepalive phía extension poll mỗi 1 phút → 3 phút cho phép
 * lỡ 2 nhịp alarm liên tiếp trước khi kết luận extension thật sự chết.
 */
const POLLER_STALE_MS = 180_000;

/**
 * Nhận token từ content script (qua route POST). Tìm pending khớp requestId rồi resolve
 * promise đang chờ. Token về sau timeout / không match requestId sẽ bị bỏ qua (thuần
 * on-demand, không có pool để nạp). Trả về true nếu resolve được 1 request.
 */
export function storeRecaptchaToken(
  _accountId: string,
  _action: string,
  token: string,
  requestId?: string
): boolean {
  if (!token || !requestId) return false;
  const pending = recaptchaState.pending.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  recaptchaState.pending.delete(requestId);
  pending.resolve(token);
  return true;
}

/**
 * Dựng recaptchaContext cho body gọi generate — mint token on-demand.
 * Ném FlowApiError khi hết thời gian chờ (extension không mint kịp / tab labs.google đóng).
 */
export async function acquireRecaptchaContext(accountId: string, action: string) {
  const token = await requestFreshToken(accountId, action);
  return {
    recaptchaContext: {
      token,
      applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
    },
  };
}

/** Tạo pending request + chờ token về (hoặc timeout). */
function requestFreshToken(accountId: string, action: string): Promise<string> {
  // Trước đây chỗ này reject NGAY khi lastPollAt cũ — sinh ra deadlock một chiều:
  // service worker ngủ → không poll → gen fail → không có pending nào để poll về →
  // SW vẫn ngủ. Chỉ thao tác tay (mở popup) mới phá được vòng lặp, nên triệu chứng
  // trông như "phải gửi lại session mỗi lần gen".
  //
  // Giờ luôn TẠO pending trước rồi mới chờ: extension có alarm keepalive 1 phút, khi
  // tỉnh dậy sẽ thấy pending và mint. Chỉ báo lỗi nếu chờ hết giờ mà vẫn im lặng.
  const lastPoll = recaptchaState.lastPollAt;
  const staleForMs = lastPoll > 0 ? Date.now() - lastPoll : 0;
  const pollerLikelyAsleep = staleForMs > POLLER_STALE_MS;

  const requestId = `rq-${Date.now()}-${recaptchaState.seq++}`;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      recaptchaState.pending.delete(requestId);
      reject(
        new FlowApiError(
          pollerLikelyAsleep
            ? `Extension Google Flow không phản hồi (lần poll cuối cách đây ${Math.round(
                staleForMs / 1000
              )}s, đã chờ thêm ${MINT_TIMEOUT_ASLEEP_MS / 1000}s). Mở tab https://labs.google ` +
              `(đã đăng nhập) và kiểm tra extension còn bật không.`
            : `Hết thời gian chờ mint reCAPTCHA token (action ${action}). ` +
              `Mở tab https://labs.google (đã đăng nhập) và cài/bật extension Google Flow.`
        )
      );
    }, pollerLikelyAsleep ? MINT_TIMEOUT_ASLEEP_MS : MINT_TIMEOUT_MS);
    // Không giữ event loop sống chỉ vì timer này.
    if (typeof timer.unref === 'function') timer.unref();

    recaptchaState.pending.set(requestId, {
      accountId,
      action,
      createdAt: Date.now(),
      resolve,
      reject,
      timer,
    });
  });
}

/** Số request đang chờ token (debug/status). */
export function pendingTokenCount(): number {
  return recaptchaState.pending.size;
}

/** Timestamp lần cuối content script poll (debug/status). */
export function lastPollAt(): number {
  return recaptchaState.lastPollAt;
}

/** Đánh dấu content script vừa poll — gọi từ route GET /token-request. */
export function markPolled(): void {
  recaptchaState.lastPollAt = Date.now();
}

/** Danh sách pending cho content script mint (không lộ resolver). */
export function listPendingRequests(accountId?: string): Array<{
  requestId: string;
  accountId: string;
  action: string;
}> {
  const out: Array<{ requestId: string; accountId: string; action: string }> = [];
  for (const [requestId, entry] of recaptchaState.pending) {
    if (accountId && entry.accountId !== accountId) continue;
    out.push({ requestId, accountId: entry.accountId, action: entry.action });
  }
  return out;
}

/**
 * access_token của Google (ya29.*) sống ~1 giờ. Refresh sớm ở mốc 45 phút để không bao giờ
 * gửi token đã hết hạn — trước đây token được cache vĩnh viễn, nên chỉ lượt gen đầu chạy
 * được, các lượt sau nhận 401 và trông như "hết session Google Labs".
 */
const ACCESS_TOKEN_TTL_MS = 45 * 60_000;

/** Trả access_token dùng cho API_BASE, tự refresh khi chưa có hoặc đã quá hạn TTL. */
export async function resolveAccessToken(account: FlowAccount): Promise<string> {
  const age = account.accessTokenAt ? Date.now() - account.accessTokenAt : Infinity;
  if (account.accessToken && age < ACCESS_TOKEN_TTL_MS) return account.accessToken;
  return refreshAccessToken(account);
}

/** Gọi GET /fx/api/auth/session với cookie để lấy access_token mới, lưu lại account. */
export async function refreshAccessToken(account: FlowAccount): Promise<string> {
  const res = await labsRequest('/fx/api/auth/session', { cookie: account.cookie });
  const data = await readJson<{ access_token?: string }>(res);
  const token = data.access_token;
  if (!token) {
    throw new FlowApiError('Không lấy được access_token từ /fx/api/auth/session (cookie hết hạn?).');
  }
  updateAccessToken(account.id, token);
  account.accessToken = token;
  return token;
}

/** Lấy account đang dùng, throw nếu chưa cấu hình tài khoản nào. */
export function resolveActiveAccount(): FlowAccount {
  const account = getActiveAccount();
  if (!account) {
    throw new FlowApiError('Chưa cấu hình tài khoản Google Flow — vào Cài đặt → Tài khoản Veo.');
  }
  return account;
}

/**
 * Chạy `fn` với access_token hiện tại; nếu Google trả 401 (UNAUTHENTICATED) thì refresh
 * token rồi chạy lại ĐÚNG 1 LẦN.
 *
 * Vì sao cần: `resolveAccessToken` chỉ refresh theo TTL 45 phút. Khi Google thu hồi token
 * sớm hơn hạn đó (đổi cookie ở tab khác, revoke, lệch giờ máy), mọi lượt gọi ăn 401 liên
 * tục cho tới khi TTL trôi hết — nhìn từ UI là đoạn video "poll lỗi tạm thời" mãi không
 * xong. Bắt đúng 401 để refresh là cách sửa ở gốc, dùng chung cho gen video/ảnh và poll.
 */
export async function withTokenRetry<T>(
  account: FlowAccount,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  return runWithTokenRetry(fn, {
    resolve: () => resolveAccessToken(account),
    refresh: () => refreshAccessToken(account),
  });
}

/** Chỉ nhận token 401 của Google — 401 từ nơi khác (nếu có) vẫn ném lên như cũ. */
export function isUnauthenticated(err: unknown): boolean {
  return err instanceof FlowApiError && err.code === 401;
}

/**
 * Phần thuần logic của `withTokenRetry` — tách ra để self-check chạy được mà không
 * đụng mạng (scripts/check-token-retry.ts).
 */
export async function runWithTokenRetry<T>(
  fn: (accessToken: string) => Promise<T>,
  tokens: { resolve: () => Promise<string>; refresh: () => Promise<string> }
): Promise<T> {
  try {
    return await fn(await tokens.resolve());
  } catch (err) {
    if (!isUnauthenticated(err)) throw err;
    // Chỉ thử lại ĐÚNG 1 lần: token mới vẫn 401 nghĩa là cookie hỏng, lặp thêm chỉ đập API.
    return fn(await tokens.refresh());
  }
}
