/**
 * Self-check: ảnh nền là BẮT BUỘC trước khi gen video (lib/livestream/segmentGenerate.ts).
 *
 * Vì sao cần: thiếu ảnh nền, mỗi đoạn Veo tự bịa một căn phòng khác nhau → video ghép lại nhảy
 * cảnh thấy rõ. Trước đây bước gen background là "tuỳ chọn" nên gen video vẫn chạy khi chưa có.
 * Nay guard tự gen ảnh nền trước, nhưng KHÔNG được tốn lượt gen thừa khi kho đã có ảnh sẵn.
 *
 * Chạy: npx tsx scripts/check-background-required.ts
 */
import assert from 'node:assert';
import { planBackgroundEnsure } from '../lib/livestream/segmentGenerate';

const base = {
  selectedBackgroundImagePath: null as string | null,
  backgroundImagePaths: [] as string[],
  products: [{ id: 'p1' }, { id: 'p2' }],
};

// 1. Đã chọn ảnh nền → không đụng gì, không gen thừa.
assert.deepStrictEqual(
  planBackgroundEnsure({ ...base, selectedBackgroundImagePath: 'inputs/bg.jpg' }),
  { action: 'ok' },
  'đã chọn ảnh nền thì không được gen lại'
);

// 2. Kho đã có ảnh nhưng chưa chọn → chọn ảnh MỚI NHẤT, KHÔNG gen (không đốt lượt Flow).
assert.deepStrictEqual(
  planBackgroundEnsure({ ...base, backgroundImagePaths: ['inputs/bg-1.png', 'inputs/bg-2.png'] }),
  { action: 'select', path: 'inputs/bg-2.png' },
  'kho có ảnh sẵn thì chọn ảnh mới nhất, không gen thêm'
);

// 3. Kho rỗng → phải gen, dùng mô tả sản phẩm ĐẦU TIÊN (ảnh nền áp chung cả job).
assert.deepStrictEqual(
  planBackgroundEnsure(base),
  { action: 'generate', productId: 'p1' },
  'kho rỗng thì phải tự gen ảnh nền trước khi gen video'
);

// 4. Không có sản phẩm nào → chặn hẳn: prompt gen nền cần mô tả sản phẩm, gen bừa ra ảnh vô nghĩa.
assert.deepStrictEqual(
  planBackgroundEnsure({ ...base, products: [] }),
  { action: 'blocked', error: 'Job chưa có sản phẩm nào' },
  'không có sản phẩm thì không gen nền được'
);

console.log('✅ check-background-required OK');
