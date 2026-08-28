/**
 * Self-check: preview bước GEN VIDEO phải nói đúng ảnh nào tới Veo và ảnh nào bị bỏ lại.
 *
 * Vì sao cần: bước gen video là bước tốn tiền nhất, và sai lầm hay gặp nhất không nằm ở prompt mà
 * ở BỘ ẢNH — pickRefImagePaths cắt còn 3 (trần Veo) và trừ thêm 1 suất khi đoạn nối tiếp frame
 * trước. Ảnh bị cắt im lặng thì Mr.D tưởng đã gửi đủ. Check này khoá 3 tính chất mà UI dựa vào:
 * thứ tự ưu tiên, danh sách bị-bỏ-lại, và nhãn vai trò từng ảnh.
 *
 * Chạy: npx tsx scripts/check-segment-preview.ts
 */
import assert from 'node:assert';
import { pickRefImagePaths } from '../lib/livestream/refImages';

const MODEL = 'inputs/model.jpg';
const BG = 'inputs/bg.jpg';
const P1 = 'inputs/p1.jpg';
const P2 = 'inputs/p2.jpg';

/** Bản sao logic UI/route dùng để liệt kê ảnh ĐÃ CHỌN nhưng KHÔNG tới Veo. */
function droppedRefs(job: Parameters<typeof pickRefImagePaths>[0], hasPrevFrame: boolean): string[] {
  const sent = pickRefImagePaths(job, hasPrevFrame);
  const detached = new Set(job.detachedImagePaths ?? []);
  return [
    ...(job.selectedModelImagePath ? [job.selectedModelImagePath] : []),
    ...(job.selectedBackgroundImagePath ? [job.selectedBackgroundImagePath] : []),
    ...(job.selectedRefImagePaths ?? []),
  ].filter((rel) => !detached.has(rel) && !sent.includes(rel));
}

/** Nhãn vai trò — cùng công thức với route preview-prompt (step=segment). */
function labelOf(
  job: { selectedModelImagePath: string | null; selectedBackgroundImagePath: string | null },
  rel: string
): string {
  if (rel === job.selectedModelImagePath) return 'ảnh NGƯỜI MẪU/NGƯỜI DẪN';
  if (rel === job.selectedBackgroundImagePath) return 'ảnh BỐI CẢNH/BACKGROUND';
  return 'ảnh SẢN PHẨM THẬT';
}

// --- đủ chỗ: 3 ảnh, không cắt ai ---
const full = {
  selectedModelImagePath: MODEL,
  selectedBackgroundImagePath: BG,
  selectedRefImagePaths: [P1],
  detachedImagePaths: [],
};
assert.deepStrictEqual(
  pickRefImagePaths(full, false),
  [MODEL, BG, P1],
  'thứ tự ưu tiên phải là mẫu → nền → sản phẩm'
);
assert.deepStrictEqual(droppedRefs(full, false), [], 'vừa đủ 3 ảnh thì không ai bị bỏ lại');

// --- quá trần: ảnh sản phẩm thứ 2 bị cắt và PHẢI được báo ---
const over = { ...full, selectedRefImagePaths: [P1, P2] };
assert.deepStrictEqual(pickRefImagePaths(over, false), [MODEL, BG, P1], 'trần Veo là 3 ảnh');
assert.deepStrictEqual(droppedRefs(over, false), [P2], 'ảnh vượt trần phải nằm trong danh sách bị bỏ lại');

// --- đoạn nối tiếp: frame trước chiếm 1 suất, chỉ còn 2 ảnh ---
assert.deepStrictEqual(
  pickRefImagePaths(full, true),
  [MODEL, BG],
  'có frame chain thì chỉ còn 2 suất cho ảnh ref'
);
assert.deepStrictEqual(droppedRefs(full, true), [P1], 'ảnh mất suất vì frame chain cũng phải được báo');

// --- ảnh bị tách: không gửi cho Veo VÀ không bị tính là "bị bỏ lại" (đó là chủ ý của Mr.D) ---
const detachedModel = { ...full, detachedImagePaths: [MODEL] };
assert.ok(
  !pickRefImagePaths(detachedModel, false).includes(MODEL),
  'ảnh đã tách không được gửi cho Veo'
);
assert.deepStrictEqual(
  droppedRefs(detachedModel, false),
  [],
  'ảnh tách có chủ ý không được báo nhầm thành bị cắt oan'
);

// --- nhãn: ảnh sản phẩm ngoài top-3 vision vẫn phải ra đúng vai trò, không rơi về nhãn chung ---
assert.strictEqual(labelOf(full, MODEL), 'ảnh NGƯỜI MẪU/NGƯỜI DẪN');
assert.strictEqual(labelOf(full, BG), 'ảnh BỐI CẢNH/BACKGROUND');
assert.strictEqual(labelOf(full, P2), 'ảnh SẢN PHẨM THẬT', 'ảnh sản phẩm nào cũng phải có nhãn đúng');

console.log('✓ check-segment-preview: tất cả assert pass');
