/**
 * Self-check cho 2 ràng buộc nhất quán của livestream nhiều sản phẩm:
 * 1. user prompt luôn mang theo sân khấu chung + đúng vai trò vị trí (mở màn/giữa/cuối)
 * 2. findOverlongSegments bắt được lời thoại dài quá nhịp nói
 * Chạy: npx tsx scripts/check-livestream-consistency.ts
 */
import assert from 'node:assert/strict';
import { buildLivestreamUserPrompt } from '../lib/livestream/scriptPrompt';
import { formatStageBibleBlock } from '../lib/livestream/stageBible';
import { computeSegmentDurations, findOverlongSegments } from '../lib/livestream/segmentSanitize';
import type { LivestreamSegment } from '../lib/livestream/types';

const bible = {
  host: 'a Vietnamese woman in her mid-20s wearing a light-pink t-shirt',
  scene: 'a small cozy home livestream corner with a beige wall',
  camera: 'medium shot, eye-level, static phone camera',
  voice: 'young adult female voice, warm mid-range pitch',
  wardrobeLock: 'The host never changes outfit during the livestream.',
};
const block = formatStageBibleBlock(bible);
for (const v of [bible.host, bible.scene, bible.camera, bible.voice, bible.wardrobeLock]) {
  assert.ok(block.includes(v), 'stage bible block phải chứa nguyên văn mọi yếu tố');
}

// Sản phẩm mở đầu: được chào. Sản phẩm giữa/cuối: cấm chào lại.
const durations = computeSegmentDurations(60);
const first = buildLivestreamUserPrompt('sp A', durations, undefined, block, { index: 0, total: 3 });
assert.ok(first.includes(bible.host), 'user prompt phải mang sân khấu chung');
assert.ok(first.includes('MỞ ĐẦU'), 'sản phẩm 1 phải được đánh dấu mở màn');

const middle = buildLivestreamUserPrompt('sp B', durations, undefined, block, {
  index: 1,
  total: 3,
  prevProductName: 'sp A',
});
assert.ok(middle.includes('KHÔNG chào lại'), 'sản phẩm giữa phải bị cấm chào lại');
assert.ok(middle.includes('sp A'), 'sản phẩm giữa phải biết sản phẩm liền trước');
assert.ok(middle.includes('CHƯA phải sản phẩm cuối'), 'sản phẩm giữa không được chào kết thúc');

const last = buildLivestreamUserPrompt('sp C', durations, undefined, block, { index: 2, total: 3 });
assert.ok(last.includes('sản phẩm CUỐI'), 'sản phẩm cuối phải được phép khép lại live');

// Trần số từ phải xuất hiện tường minh cho từng đoạn.
assert.ok(first.includes('tối đa 22 từ'), 'đoạn 8s phải có trần 22 từ (8 × 2.75)');

// findOverlongSegments: 23 từ / 8s là vượt, 20 từ / 8s là đạt.
const seg = (words: number, duration: number): LivestreamSegment => ({
  id: `s-${words}`,
  order: 1,
  voiceoverVi: Array.from({ length: words }, () => 'từ').join(' '),
  veoPrompt: 'x',
  duration,
  status: 'idle',
  jobId: null,
  videoPath: null,
  videoUrl: null,
  lastFramePath: null,
  error: null,
  attempts: 0,
  lastUpdatedAt: null,
});
const flagged = findOverlongSegments([seg(23, 8), seg(20, 8), seg(12, 4)]);
assert.deepEqual(
  flagged.map((f) => f.id),
  ['s-23', 's-12'],
  'chỉ đoạn vượt 2.75 từ/s mới bị cảnh báo'
);
assert.equal(flagged[0].maxWords, 22);

console.log('✓ livestream consistency checks passed');
