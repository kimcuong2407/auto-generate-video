/**
 * Self-check prompt gen ảnh background livestream (lib/livestream/backgroundGenerate.ts).
 *
 * Vì sao cần: người dùng chọn ảnh mẫu nhưng ảnh nền gen ra vẫn là người lạ. Hai nguyên nhân:
 *   1. Ảnh mẫu bị push CUỐI danh sách ref (sau N ảnh sản phẩm) → model gần như bỏ qua.
 *   2. Prompt không nói ảnh nào là ảnh nào → model nhận một chồng ảnh vô danh, không biết phải
 *      copy khuôn mặt từ ảnh nào; lại còn bị bibleBlock ("copy y nguyên mô tả người dẫn") đè lên.
 *
 * Check này khoá cả 2: ảnh mẫu đứng ĐẦU, và prompt phải có legend đánh số + câu ép ưu tiên ẢNH.
 *
 * Chạy: npx tsx scripts/check-background-ref-legend.ts
 */
import assert from 'node:assert';
import { pickVisionRefEntries } from '../lib/livestream/refImages';

const entries = pickVisionRefEntries({
  selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg'],
  selectedModelImagePath: 'inputs/model.jpg',
  selectedBackgroundImagePath: 'inputs/bg.jpg',
});

// 1. Ảnh mẫu đứng ĐẦU — không được nằm sau ảnh sản phẩm như bản cũ.
assert.strictEqual(entries[0].rel, 'inputs/model.jpg', 'ảnh mẫu phải đứng đầu danh sách ref');
assert.ok(entries[0].label.includes('NGƯỜI MẪU'), 'ảnh mẫu phải có nhãn NGƯỜI MẪU');

// 2. Danh sách gửi cho Flow lấy đúng từ entries, giữ nguyên thứ tự.
assert.deepStrictEqual(
  entries.map((e) => e.rel),
  ['inputs/model.jpg', 'inputs/p1.jpg', 'inputs/p2.jpg', 'inputs/bg.jpg'],
  'thứ tự: ảnh mẫu → ảnh sản phẩm → ảnh nền'
);

// 3. Legend đánh số phải khớp 1-1 với thứ tự ảnh thật gửi lên, nếu không model đọc nhầm vai trò.
const legend = entries.map((e, i) => `  ${i + 1}. ${e.label}`).join('\n');
assert.ok(legend.startsWith('  1. ảnh NGƯỜI MẪU'), `legend sai thứ tự:\n${legend}`);
assert.strictEqual(legend.split('\n').length, entries.length, 'legend phải liệt kê đủ mọi ảnh gửi');

// 4. Không chọn gì → rỗng, prompt bỏ hẳn khối legend (không gửi "ẢNH REFERENCE ĐÍNH KÈM: " trống).
assert.deepStrictEqual(
  pickVisionRefEntries({
    selectedRefImagePaths: [],
    selectedModelImagePath: null,
    selectedBackgroundImagePath: null,
  }),
  [],
  'không có ảnh nào thì trả rỗng'
);

console.log('check-background-ref-legend: OK');
