/**
 * Self-check logic gom ảnh reference cho khâu viết prompt (lib/data/storyboardPromptGenerate.ts):
 * đúng ảnh nào được gửi, đúng URL R2 song song index, và background KHÔNG kèm sản phẩm/người.
 * Chạy: npx tsx scripts/check-prompt-ref-images.ts
 */
import assert from 'node:assert';
import { __testables } from '../lib/data/storyboardPromptGenerate';

const { pickReferenceEntries } = __testables;

const inputs = (over: Partial<Parameters<typeof pickReferenceEntries>[0]>) => ({
  productImages: [] as string[],
  productImageUrls: [] as (string | null)[],
  spokespersonImagePath: null,
  spokespersonImageUrl: null,
  backgroundPath: null,
  backgroundUrl: null,
  ...over,
});

// 1. Ít ảnh (<= 3): giữ nguyên, không bỏ ảnh bìa.
let e = pickReferenceEntries(
  inputs({ productImages: ['a.jpg', 'b.jpg'], productImageUrls: ['ua', 'ub'] }),
  {}
);
assert.deepStrictEqual(e.map((x) => x.rel), ['a.jpg', 'b.jpg']);
assert.deepStrictEqual(e.map((x) => x.url), ['ua', 'ub'], 'URL phải khớp index gốc');

// 2. Dư ảnh (> 3): bỏ ảnh [0] (ảnh bìa marketing), URL vẫn khớp index gốc.
e = pickReferenceEntries(
  inputs({
    productImages: ['cover.jpg', 'a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
    productImageUrls: ['u0', 'u1', 'u2', 'u3', 'u4'],
  }),
  {}
);
assert.deepStrictEqual(e.map((x) => x.rel), ['a.jpg', 'b.jpg', 'c.jpg'], 'bỏ ảnh bìa, tối đa 3');
assert.deepStrictEqual(e.map((x) => x.url), ['u1', 'u2', 'u3']);

// 3. Ảnh trùng đường dẫn: URL vẫn theo index, không tra theo giá trị.
e = pickReferenceEntries(
  inputs({ productImages: ['a.jpg', 'a.jpg'], productImageUrls: ['u0', 'u1'] }),
  {}
);
assert.deepStrictEqual(e.map((x) => x.url), ['u0', 'u1'], 'ảnh trùng path không được lấy nhầm URL');

// 4. Đủ 3 loại ảnh, đúng nhãn.
e = pickReferenceEntries(
  inputs({
    productImages: ['a.jpg'],
    productImageUrls: ['ua'],
    spokespersonImagePath: 'model.jpg',
    backgroundPath: 'bg.jpg',
  }),
  {}
);
assert.deepStrictEqual(e.map((x) => x.rel), ['a.jpg', 'model.jpg', 'bg.jpg']);
assert.ok(e[1].label.includes('NGƯỜI MẪU') && e[2].label.includes('BỐI CẢNH'));

// 5. Background prompt: loại sản phẩm + người mẫu, chỉ còn ảnh nền.
e = pickReferenceEntries(
  inputs({
    productImages: ['a.jpg'],
    productImageUrls: ['ua'],
    spokespersonImagePath: 'model.jpg',
    backgroundPath: 'bg.jpg',
  }),
  { includeProduct: false, includeSpokesperson: false }
);
assert.deepStrictEqual(e.map((x) => x.rel), ['bg.jpg'], 'ảnh nền không được kèm sản phẩm/người');

// 6. Không có ảnh nào → rỗng (caller fallback về đường text).
assert.deepStrictEqual(pickReferenceEntries(inputs({}), {}), []);

console.log('✓ check-prompt-ref-images: 6/6 pass');
