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

/** Chờ extension mint token tối đa 20s. */
const MINT_TIMEOUT_MS = 20_000;

/**
 * Nếu content script không poll trong khoảng này thì coi như poller offline → fail-fast
 * thay vì bắt người dùng chờ hết MINT_TIMEOUT_MS. Chỉ áp dụng khi ĐÃ từng có poll (
 * lastPollAt > 0) — tránh fail oan ngay sau khi khởi động server.
 */
const POLLER_STALE_MS = 10_000;

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
  // Fail-fast: đã từng có poller nhưng lâu rồi không thấy poll → coi như offline.
  const lastPoll = recaptchaState.lastPollAt;
  if (lastPoll > 0 && Date.now() - lastPoll > POLLER_STALE_MS) {
    return Promise.reject(
      new FlowApiError(
        `Extension Google Flow không hoạt động (không thấy poll ${Math.round(
          (Date.now() - lastPoll) / 1000
        )}s). Mở tab https://labs.google (đã đăng nhập) và bật extension để mint reCAPTCHA token.`
      )
    );
  }

  const requestId = `rq-${Date.now()}-${recaptchaState.seq++}`;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      recaptchaState.pending.delete(requestId);
      reject(
        new FlowApiError(
          `Hết thời gian chờ mint reCAPTCHA token (action ${action}). ` +
            `Mở tab https://labs.google (đã đăng nhập) và cài/bật extension Google Flow.`
        )
      );
    }, MINT_TIMEOUT_MS);
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

/** Trả access_token dùng cho API_BASE, tự refresh nếu account chưa có token. */
export async function resolveAccessToken(account: FlowAccount): Promise<string> {
  if (account.accessToken) return account.accessToken;
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
