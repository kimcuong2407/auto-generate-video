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
import { MAX_SEGMENT_AUTO_RETRIES } from '../lib/constants';
import type { LivestreamSegment } from '../lib/livestream/types';

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
assert.strictEqual(shouldAutoTrigger(seg()), true, 'idle phải được trigger');

// CA CỦA MR.D: seg-02 failed vì mint reCAPTCHA timeout → phải tự chạy lại, không đứng im.
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'failed', attempts: 1, error: 'Hết thời gian chờ mint reCAPTCHA token' })),
  true,
  'failed do lỗi tạm thời phải được tự thử lại'
);

// Trần retry: đúng ngưỡng thì dừng, không quay vòng vô hạn đốt quota.
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'failed', attempts: MAX_SEGMENT_AUTO_RETRIES })),
  false,
  'chạm trần retry thì ngừng tự thử lại'
);
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'failed', attempts: MAX_SEGMENT_AUTO_RETRIES - 1 })),
  true,
  'dưới trần 1 nhịp thì vẫn còn được thử'
);
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'failed', attempts: MAX_SEGMENT_AUTO_RETRIES + 5 })),
  false,
  'vượt trần thì dứt khoát ngừng'
);

// Đoạn đã xong → KHÔNG được gen đè (mất video tốt, tốn quota).
assert.strictEqual(shouldAutoTrigger(seg({ status: 'done', attempts: 1 })), false, 'done thì không đụng vào');

// Đoạn đang chạy → không trigger chồng (gen 2 job cho 1 đoạn, lệch thứ tự chain).
assert.strictEqual(shouldAutoTrigger(seg({ status: 'generating' })), false, 'generating thì để yên');

// Chưa có prompt → không gen được, đừng đốt quota vào job rỗng.
assert.strictEqual(shouldAutoTrigger(seg({ veoPrompt: '   ' })), false, 'thiếu veoPrompt thì bỏ qua');
assert.strictEqual(
  shouldAutoTrigger(seg({ status: 'failed', attempts: 1, veoPrompt: '' })),
  false,
  'failed nhưng chưa có prompt thì vẫn bỏ qua'
);

console.log('✓ check-cascade-resume: tất cả assert pass');
