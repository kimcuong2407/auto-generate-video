/**
 * Self-check điều kiện chốt lại "stage bible" (lib/livestream/stageBible.ts).
 *
 * Vì sao cần: bible tả người dẫn được cache cấp job. Nếu không phát hiện được lúc nó đã lệch khỏi
 * ảnh mẫu hiện tại, job đã sinh script xong sẽ kẹt vĩnh viễn với người dẫn sai giới tính — mọi sản
 * phẩm đều scriptStatus='done' nên "Sinh script tất cả" không còn target, còn sinh lại từng sản
 * phẩm lẻ thì theo thiết kế vẫn dùng bible cũ.
 *
 * Chạy: npx tsx scripts/check-stage-bible-stale.ts
 */
import assert from 'node:assert';
import { isStageBibleStale } from '../lib/livestream/stageBible';
import type { LivestreamStageBible } from '../lib/livestream/types';

const bible = (over: Partial<LivestreamStageBible> = {}): LivestreamStageBible => ({
  host: 'a Vietnamese woman in her mid-20s',
  scene: 'a home live-selling corner',
  camera: 'medium shot, eye-level',
  voice: 'young adult female voice',
  wardrobeLock: 'same outfit throughout',
  ...over,
});

// Chưa có bible → không có gì để chốt lại (ensureStageBible tự sinh lần đầu).
assert.strictEqual(
  isStageBibleStale({ stageBible: null, selectedModelImagePath: 'inputs/model-1.jpg' }),
  false,
  'chưa có bible thì không tính là stale'
);

// Khớp ảnh mẫu → giữ nguyên, KHÔNG gọi AI lại (giữ tính nhất quán giữa các sản phẩm).
assert.strictEqual(
  isStageBibleStale({
    stageBible: bible({ modelImagePath: 'inputs/model-1.jpg' }),
    selectedModelImagePath: 'inputs/model-1.jpg',
  }),
  false,
  'cùng ảnh mẫu thì bible còn dùng được'
);

// Đổi ảnh mẫu → bible đang tả sai người, phải chốt lại.
assert.strictEqual(
  isStageBibleStale({
    stageBible: bible({ modelImagePath: 'inputs/model-1.jpg' }),
    selectedModelImagePath: 'inputs/model-2.jpg',
  }),
  true,
  'đổi ảnh mẫu thì phải chốt lại bible'
);

// Xoá ảnh mẫu (còn null) sau khi bible đã chốt theo ảnh → cũng phải chốt lại.
assert.strictEqual(
  isStageBibleStale({
    stageBible: bible({ modelImagePath: 'inputs/model-1.jpg' }),
    selectedModelImagePath: null,
  }),
  true,
  'xoá ảnh mẫu thì bible cũ không còn đúng'
);

// CA CỦA MR.D: bible do bản code CŨ chốt (không có modelImagePath) trong khi job ĐANG có ảnh mẫu.
// Phải tính là stale, nếu không job kẹt mãi với người dẫn sai giới tính.
assert.strictEqual(
  isStageBibleStale({
    stageBible: bible(),
    selectedModelImagePath: 'inputs/model-1787653308698.jpg',
  }),
  true,
  'bible cũ (thiếu dấu vết) + job có ảnh mẫu → phải chốt lại'
);

// Bible cũ và job cũng KHÔNG có ảnh mẫu → khớp, giữ nguyên (đừng gọi AI vô ích).
assert.strictEqual(
  isStageBibleStale({ stageBible: bible(), selectedModelImagePath: null }),
  false,
  'bible cũ + job không có ảnh mẫu → không cần chốt lại'
);

console.log('✓ check-stage-bible-stale: tất cả assert pass');
