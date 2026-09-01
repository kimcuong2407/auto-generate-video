/**
 * Self-check điều kiện tự nối lại dây chuyền gen video (lib/livestream/segmentSync.ts).
 *
 * Vì sao cần: người dùng bấm "gen cả block" và mong nó chạy hết mọi cảnh, không phải ngồi canh.
 * Trước đây cascade chỉ trigger đoạn kế khi nó 'idle', nên 1 đoạn 'failed' vì lỗi TẠM THỜI (mint
 * reCAPTCHA timeout, Flow 5xx) làm đứt dây chuyền vĩnh viễn. Nhưng nới ra thì phải có trần, không
 * thì lỗi THẬT (prompt sai, hết quota) sẽ quay vòng vô hạn đốt quota Veo.
 *
 * Chạy: npx tsx scripts/check-cascade-resume.ts
 */
import assert from 'node:assert';
import { shouldAutoTrigger } from '../lib/livestream/segmentSync';
import { isChaining, findNextSegment, findPreviousSegment } from '../lib/livestream/refImages';
import { MAX_SEGMENT_AUTO_RETRIES, SEGMENT_RETRY_BACKOFF_MS } from '../lib/constants';
import { isQuotaError } from '../lib/googleFlow/errors';
import { FlowApiError } from '../lib/googleFlow/errors';
import type { LivestreamChaining, LivestreamJob, LivestreamSegment } from '../lib/livestream/types';

const NOW = new Date('2026-08-26T20:00:00.000Z').getTime();
/** Thời điểm lỗi đã đủ cũ để được thử lại (quá SEGMENT_RETRY_BACKOFF_MS). */
const LONG_AGO = new Date(NOW - SEGMENT_RETRY_BACKOFF_MS - 1000).toISOString();
/** Vừa lỗi xong — còn trong khoảng backoff. */
const JUST_NOW = new Date(NOW - 1000).toISOString();

const seg = (over: Partial<LivestreamSegment> = {}): LivestreamSegment => ({
  id: 'seg-02',
  order: 1,
  voiceoverVi: 'lời thoại',
  veoPrompt: 'A man sits at a table. no subtitles.',
  duration: 8,
  status: 'idle',
  jobId: null,
  videoPath: null,
  videoUrl: null,
  lastFramePath: null,
  error: null,
  attempts: 0,
  lastUpdatedAt: null,
  ...over,
});

// Đoạn chưa chạy → trigger bình thường (hành vi cũ, không được đổi).
assert.strictEqual(shouldAutoTrigger(seg(), NOW), true, 'idle phải được trigger');

// CA CỦA MR.D: seg-02 failed vì mint reCAPTCHA timeout → phải tự chạy lại, không đứng im.
assert.strictEqual(
  shouldAutoTrigger(
    seg({
      status: 'failed',
      attempts: 1,
      error: 'Hết thời gian chờ mint reCAPTCHA token',
      lastUpdatedAt: LONG_AGO,
    }),
    NOW
  ),
  true,
  'failed do lỗi tạm thời phải được tự thử lại'
);

// Backoff: vừa lỗi xong thì CHƯA thử lại ngay — poller chạy mỗi 15s, không có chặn này thì đoạn
// lỗi vì hết quota bị đập 240 lần/giờ.
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'failed', attempts: 1, lastUpdatedAt: JUST_NOW }), NOW),
  false,
  'vừa lỗi xong thì phải lùi lại, không thử lại ngay'
);

// Trần retry: đúng ngưỡng thì dừng, không quay vòng vô hạn đốt quota.
assert.strictEqual(
  shouldAutoTrigger(
    seg({ status: 'failed', attempts: MAX_SEGMENT_AUTO_RETRIES, lastUpdatedAt: LONG_AGO }),
    NOW
  ),
  false,
  'chạm trần retry thì ngừng tự thử lại'
);
assert.strictEqual(
  shouldAutoTrigger(
    seg({ status: 'failed', attempts: MAX_SEGMENT_AUTO_RETRIES - 1, lastUpdatedAt: LONG_AGO }),
    NOW
  ),
  true,
  'dưới trần 1 nhịp thì vẫn còn được thử'
);
assert.strictEqual(
  shouldAutoTrigger(
    seg({ status: 'failed', attempts: MAX_SEGMENT_AUTO_RETRIES + 5, lastUpdatedAt: LONG_AGO }),
    NOW
  ),
  false,
  'vượt trần thì dứt khoát ngừng'
);

// Đoạn đã xong → KHÔNG được gen đè (mất video tốt, tốn quota).
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'done', attempts: 1 }), NOW),
  false,
  'done thì không đụng vào'
);

// Đoạn đang chạy → không trigger chồng (gen 2 job cho 1 đoạn, lệch thứ tự chain).
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'generating' }), NOW),
  false,
  'generating thì để yên'
);

// Chưa có prompt → không gen được, đừng đốt quota vào job rỗng.
assert.strictEqual(
  shouldAutoTrigger(seg({ veoPrompt: '   ' }), NOW),
  false,
  'thiếu veoPrompt thì bỏ qua'
);
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'failed', attempts: 1, veoPrompt: '', lastUpdatedAt: LONG_AGO }), NOW),
  false,
  'failed nhưng chưa có prompt thì vẫn bỏ qua'
);

// ---------------------------------------------------------------
// Nhận diện lỗi HẾT QUOTA — khác lỗi tạm thời: retry ngay không bao giờ thành công.
// ---------------------------------------------------------------
const QUOTA_MSG =
  'Google Flow HTTP 429: { "error": { "code": 429, "message": "Quota exceeded: PUBLIC_ERROR_USER_QUOTA_REACHED", "status": "RESOURCE_EXHAUSTED" } }';
assert.strictEqual(isQuotaError(new Error(QUOTA_MSG)), true, 'nhận ra lỗi quota thật từ Google');
assert.strictEqual(isQuotaError(new FlowApiError('bất kỳ', 429)), true, 'FlowApiError code 429 là quota');
assert.strictEqual(
  isQuotaError(new Error('Hết thời gian chờ mint reCAPTCHA token (action VIDEO_GENERATION)')),
  false,
  'lỗi reCAPTCHA là lỗi TẠM THỜI, không phải quota'
);
assert.strictEqual(isQuotaError(new Error('HTTP 500 internal')), false, '5xx không phải quota');
assert.strictEqual(isQuotaError(undefined), false, 'undefined không crash');

// ---------------------------------------------------------------
// Công tắc auto-gen (job.chaining) — nay sửa được từ UI qua PATCH /api/livestream/[id].
// Validate phải CHẶN giá trị lạ: ghi bừa vào cột mysqlEnum sẽ nổ ở tầng DB, và một giá trị
// không hợp lệ lọt qua sẽ làm findPreviousSegment coi như 'continuous' → gen sai thứ tự.
// ---------------------------------------------------------------
for (const ok of ['off', 'per_product', 'continuous'] as LivestreamChaining[]) {
  assert.strictEqual(isChaining(ok), true, `'${ok}' phải hợp lệ`);
}
for (const bad of ['', 'ON', 'true', 'auto', null, undefined, 1, {}]) {
  assert.strictEqual(isChaining(bad), false, `${JSON.stringify(bad)} phải bị chặn`);
}

// Cascade đi tới đoạn nào là do `chaining` quyết. Job mẫu: 2 sản phẩm, mỗi sản phẩm 2 đoạn,
// `order` đánh số TUYỆT ĐỐI xuyên suốt job (0,1 | 2,3) — xem lib/livestream/reorder.ts.
const twoProductJob = {
  chaining: 'continuous' as LivestreamChaining,
  products: [
    { id: 'p1', segments: [seg({ id: 'a0', order: 0 }), seg({ id: 'a1', order: 1 })] },
    { id: 'p2', segments: [seg({ id: 'b0', order: 2 }), seg({ id: 'b1', order: 3 })] },
  ],
} as unknown as LivestreamJob;
const p1 = twoProductJob.products[0];
const p2 = twoProductJob.products[1];
const lastOfP1 = p1.segments[1];

// 'continuous': hết sản phẩm 1 thì nhảy sang sản phẩm 2 — đây là điều Mr.D muốn khi bật auto.
assert.strictEqual(
  findNextSegment(twoProductJob, p1, lastOfP1)?.id,
  'b0',
  'continuous phải cascade xuyên sản phẩm'
);

// 'per_product': dừng ở cuối mỗi sản phẩm, không tự tràn sang sản phẩm kế.
const perProductJob = { ...twoProductJob, chaining: 'per_product' as LivestreamChaining };
assert.strictEqual(
  findNextSegment(perProductJob, p1, lastOfP1),
  null,
  'per_product phải dừng ở cuối sản phẩm'
);
assert.strictEqual(
  findNextSegment(perProductJob, p1, p1.segments[0])?.id,
  'a1',
  'per_product vẫn cascade trong cùng sản phẩm'
);

// 'off': không có ràng buộc "đoạn trước phải xong" → generate-all được fan-out song song.
const offJob = { ...twoProductJob, chaining: 'off' as LivestreamChaining };
assert.strictEqual(
  findPreviousSegment(offJob, p2, p2.segments[0]),
  null,
  "chaining 'off' không ràng buộc đoạn liền trước"
);
assert.strictEqual(
  findPreviousSegment(twoProductJob, p2, p2.segments[0])?.id,
  'a1',
  'continuous ràng buộc đoạn liền trước xuyên sản phẩm'
);

console.log('✓ check-cascade-resume: tất cả assert pass');
