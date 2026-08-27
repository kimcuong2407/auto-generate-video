/**
 * Self-check thứ tự ưu tiên ảnh reference gửi cho Veo (lib/livestream/refImages.ts).
 *
 * Vì sao cần: Veo chỉ nhận TỐI ĐA 3 ảnh reference. Trước đây ảnh sản phẩm xếp trước rồi cắt 3, nên
 * job chọn đủ 3 ảnh sản phẩm là ảnh mẫu (người dẫn) bị cắt mất hoàn toàn — Veo không bao giờ nhìn
 * thấy người dẫn và vẽ ra người lạ, dù prompt tả rất kỹ. Ảnh mẫu PHẢI luôn nằm trong danh sách gửi.
 * Cùng lý do đó, ảnh NỀN xếp ngay sau ảnh mẫu: bối cảnh cũng không ghim được bằng chữ, trong khi
 * ảnh sản phẩm đã có "Mô tả ngoại hình sản phẩm" do vision đọc vào prompt nên chịu được việc bị cắt.
 *
 * Chạy: npx tsx scripts/check-ref-image-priority.ts
 */
import assert from 'node:assert';
import { pickRefImagePaths } from '../lib/livestream/refImages';

const job = (over: Partial<Parameters<typeof pickRefImagePaths>[0]> = {}) => ({
  selectedRefImagePaths: [] as string[],
  selectedModelImagePath: null as string | null,
  selectedBackgroundImagePath: null as string | null,
  detachedImagePaths: [] as string[],
  ...over,
});

// CA CỦA MR.D: 3 ảnh sản phẩm + 1 ảnh mẫu. Ảnh mẫu PHẢI có mặt, không được bị cắt.
let r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/product-1.jpg', 'inputs/product-2.jpg', 'inputs/product-6.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
  }),
  false
);
assert.strictEqual(r.length, 3, 'không được vượt 3 ảnh (Veo trả INVALID_ARGUMENT)');
assert.ok(r.includes('inputs/model-1.jpg'), 'ảnh mẫu KHÔNG được bị cắt mất');
assert.strictEqual(r[0], 'inputs/model-1.jpg', 'ảnh mẫu phải đứng đầu');
assert.deepStrictEqual(
  r,
  ['inputs/model-1.jpg', 'inputs/product-1.jpg', 'inputs/product-2.jpg'],
  'không có ảnh nền thì sau ảnh mẫu là ảnh sản phẩm theo thứ tự đã chọn'
);

// Có frame chain đoạn trước → chừa 1 suất cho frame, chỉ còn 2 ảnh; ảnh mẫu vẫn phải giữ chỗ.
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/product-1.jpg', 'inputs/product-2.jpg', 'inputs/product-6.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
  }),
  true
);
assert.strictEqual(r.length, 2, 'có frame chain thì chỉ còn 2 suất cho ảnh');
assert.strictEqual(r[0], 'inputs/model-1.jpg', 'ảnh mẫu vẫn được ưu tiên khi có chain');

// CA CỦA MR.D (bug "đã chọn ảnh background nhưng không gửi kèm trong ref"): ảnh nền phải đứng
// TRƯỚC ảnh sản phẩm, ảnh sản phẩm thừa mới là thứ bị cắt.
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg', 'inputs/p3.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
    selectedBackgroundImagePath: 'inputs/bg.jpg',
  }),
  false
);
assert.ok(r.includes('inputs/bg.jpg'), 'ảnh nền đã chọn KHÔNG được bị ảnh sản phẩm cắt mất');
assert.deepStrictEqual(
  r,
  ['inputs/model-1.jpg', 'inputs/bg.jpg', 'inputs/p1.jpg'],
  'thứ tự: ảnh mẫu → ảnh nền → ảnh sản phẩm, cắt ảnh sản phẩm thừa'
);

// Có frame chain + đủ cả 3 loại → chỉ còn 2 suất: mẫu + nền, ảnh sản phẩm nhường chỗ.
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
    selectedBackgroundImagePath: 'inputs/bg.jpg',
  }),
  true
);
assert.deepStrictEqual(r, ['inputs/model-1.jpg', 'inputs/bg.jpg'], 'chain: giữ mẫu + nền');

// Không có ảnh mẫu → nền vẫn đứng trước sản phẩm.
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg', 'inputs/p3.jpg'],
    selectedBackgroundImagePath: 'inputs/bg.jpg',
  }),
  false
);
assert.deepStrictEqual(r, ['inputs/bg.jpg', 'inputs/p1.jpg', 'inputs/p2.jpg'], 'không ảnh mẫu: nền vẫn trước sản phẩm');

// Không có ảnh mẫu → giữ nguyên hành vi cũ (chỉ sản phẩm), không chèn gì lạ.
r = pickRefImagePaths(job({ selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg'] }), false);
assert.deepStrictEqual(r, ['inputs/p1.jpg', 'inputs/p2.jpg'], 'không có ảnh mẫu thì chỉ ảnh sản phẩm');

// Không chọn gì → rỗng (route tự chặn/gen t2v), không crash.
assert.deepStrictEqual(pickRefImagePaths(job(), false), [], 'không có ảnh nào thì trả rỗng');

// ------------------------------------------------------------------
// Tách ảnh khỏi bước gen video (job.detachedImagePaths).
// Ảnh bị tách vẫn cho AI vision đọc để mô tả vào prompt, nhưng KHÔNG gửi cho Veo làm reference.
// ------------------------------------------------------------------

// Tách ảnh mẫu → không gửi cho Veo nữa, ảnh sản phẩm dồn lên.
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
    detachedImagePaths: ['inputs/model-1.jpg'],
  }),
  false
);
assert.deepStrictEqual(r, ['inputs/p1.jpg', 'inputs/p2.jpg'], 'ảnh mẫu đã tách thì không gửi cho Veo');

// CỐT LÕI: lọc phải xảy ra TRƯỚC khi cắt 3, nếu không ảnh bị tách vẫn chiếm suất và ảnh thứ 4
// không bao giờ được gửi — đúng thứ Mr.D muốn khi tách ảnh bìa để nhường chỗ cho ảnh góc khác.
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg', 'inputs/p3.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
    detachedImagePaths: ['inputs/p1.jpg'],
  }),
  false
);
assert.strictEqual(r.length, 3, 'tách 1 ảnh thì ảnh phía sau lên thay, vẫn đủ 3 suất');
assert.deepStrictEqual(
  r,
  ['inputs/model-1.jpg', 'inputs/p2.jpg', 'inputs/p3.jpg'],
  'ảnh sau ảnh bị tách phải được dồn lên, không để trống suất'
);

// Tách background → chỉ mất mỗi background, phần còn lại nguyên vẹn.
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/p1.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
    selectedBackgroundImagePath: 'inputs/bg.jpg',
    detachedImagePaths: ['inputs/bg.jpg'],
  }),
  false
);
assert.deepStrictEqual(r, ['inputs/model-1.jpg', 'inputs/p1.jpg'], 'background đã tách thì không gửi');

// Tách ảnh nền khi dư ảnh sản phẩm → ảnh sản phẩm dồn lên chiếm suất trống của nền.
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg', 'inputs/p3.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
    selectedBackgroundImagePath: 'inputs/bg.jpg',
    detachedImagePaths: ['inputs/bg.jpg'],
  }),
  false
);
assert.deepStrictEqual(
  r,
  ['inputs/model-1.jpg', 'inputs/p1.jpg', 'inputs/p2.jpg'],
  'tách nền thì ảnh sản phẩm dồn lên, không để trống suất'
);

// Tách HẾT → rỗng, không crash (route gen tự chặn bằng guard riêng).
r = pickRefImagePaths(
  job({
    selectedRefImagePaths: ['inputs/p1.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
    detachedImagePaths: ['inputs/p1.jpg', 'inputs/model-1.jpg'],
  }),
  false
);
assert.deepStrictEqual(r, [], 'tách hết thì trả rỗng');

// Job cũ (chưa có field) → undefined phải coi như "chưa tách ảnh nào", giữ nguyên hành vi cũ.
r = pickRefImagePaths(
  {
    selectedRefImagePaths: ['inputs/p1.jpg'],
    selectedModelImagePath: 'inputs/model-1.jpg',
    selectedBackgroundImagePath: null,
  },
  false
);
assert.deepStrictEqual(r, ['inputs/model-1.jpg', 'inputs/p1.jpg'], 'job cũ thiếu field vẫn gửi đủ ảnh');

console.log('✓ check-ref-image-priority: tất cả assert pass');
