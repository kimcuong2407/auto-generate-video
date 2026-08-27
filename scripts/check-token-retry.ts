/**
 * Self-check retry-on-401 của Google Flow (lib/googleFlow/recaptcha.ts):
 * 401 → refresh token rồi chạy lại ĐÚNG 1 lần; lỗi khác không được nuốt.
 * Chạy: npx tsx scripts/check-token-retry.ts
 */
import assert from 'node:assert';
import { runWithTokenRetry, isUnauthenticated } from '../lib/googleFlow/recaptcha';
import { FlowApiError } from '../lib/googleFlow/errors';

const tokens = () => {
  const state = { refreshed: 0 };
  return {
    state,
    resolve: async () => 'old-token',
    refresh: async () => {
      state.refreshed += 1;
      return 'new-token';
    },
  };
};

async function main() {
  // 1. Không lỗi: chạy 1 lần với token cũ, không refresh.
  {
    const t = tokens();
    const seen: string[] = [];
    const out = await runWithTokenRetry(async (tok) => {
      seen.push(tok);
      return 'ok';
    }, t);
    assert.equal(out, 'ok');
    assert.deepEqual(seen, ['old-token']);
    assert.equal(t.state.refreshed, 0);
  }

  // 2. 401 lần đầu: refresh rồi chạy lại bằng token mới và thành công.
  {
    const t = tokens();
    const seen: string[] = [];
    const out = await runWithTokenRetry(async (tok) => {
      seen.push(tok);
      if (tok === 'old-token') throw new FlowApiError('HTTP 401 UNAUTHENTICATED', 401);
      return 'ok-after-refresh';
    }, t);
    assert.equal(out, 'ok-after-refresh');
    assert.deepEqual(seen, ['old-token', 'new-token']);
    assert.equal(t.state.refreshed, 1);
  }

  // 3. 401 cả sau khi refresh: ném lỗi, KHÔNG lặp vô hạn (đúng 2 lượt gọi).
  {
    const t = tokens();
    let calls = 0;
    await assert.rejects(
      runWithTokenRetry(async () => {
        calls += 1;
        throw new FlowApiError('HTTP 401 UNAUTHENTICATED', 401);
      }, t),
      /401/
    );
    assert.equal(calls, 2);
    assert.equal(t.state.refreshed, 1);
  }

  // 4. Lỗi khác 401 (429 quota, 500) không được refresh/nuốt.
  for (const code of [429, 500, undefined]) {
    const t = tokens();
    let calls = 0;
    await assert.rejects(
      runWithTokenRetry(async () => {
        calls += 1;
        throw new FlowApiError(`HTTP ${code}`, code);
      }, t),
      new RegExp(String(code))
    );
    assert.equal(calls, 1, `code ${code} không được retry`);
    assert.equal(t.state.refreshed, 0);
  }

  // 5. Lỗi không phải FlowApiError giữ nguyên.
  {
    const t = tokens();
    await assert.rejects(
      runWithTokenRetry(async () => {
        throw new Error('mạng đứt');
      }, t),
      /mạng đứt/
    );
    assert.equal(t.state.refreshed, 0);
  }

  // 6. isUnauthenticated chỉ đúng với FlowApiError 401.
  assert.equal(isUnauthenticated(new FlowApiError('x', 401)), true);
  assert.equal(isUnauthenticated(new FlowApiError('x', 403)), false);
  assert.equal(isUnauthenticated(new Error('401')), false);
}

main().then(() => console.log('✓ check-token-retry OK'));
