/**
 * State singleton cho luồng on-demand mint reCAPTCHA token.
 *
 * Giữ trong globalThis để SỐNG SÓT qua hot-reload của `next dev`: module này bị
 * re-evaluate mỗi lần reload, nhưng `globalThis` không reset — nhờ đó một request
 * đang `await` token (pending resolver) vẫn được resolve đúng khi token về, kể cả
 * khi hot-reload xảy ra giữa chừng.
 *
 * KHÔNG có pool token (thuần on-demand): mỗi lần gen mint 1 token tươi mới.
 */

export interface PendingEntry {
  accountId: string;
  action: string;
  createdAt: number;
  resolve: (token: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RecaptchaState {
  /** key = requestId → resolver của request đang chờ token. */
  pending: Map<string, PendingEntry>;
  /** bộ đếm để sinh requestId ổn định (không trùng qua hot-reload). */
  seq: number;
  /** timestamp lần cuối content script poll — dùng để fail-fast khi poller offline. */
  lastPollAt: number;
}

const globalForRecaptcha = globalThis as unknown as {
  __flowRecaptchaState?: RecaptchaState;
};

export const recaptchaState: RecaptchaState =
  globalForRecaptcha.__flowRecaptchaState ?? {
    pending: new Map(),
    seq: 0,
    lastPollAt: 0,
  };

if (!globalForRecaptcha.__flowRecaptchaState) {
  globalForRecaptcha.__flowRecaptchaState = recaptchaState;
}
