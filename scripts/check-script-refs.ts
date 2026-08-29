/**
 * Self-check: ảnh Mr.D tick trong modal sinh script (job.scriptRefPaths) phải THỰC SỰ đổi được
 * thứ AI nhìn thấy ở bước sinh script — lib/livestream/refImages.ts.
 *
 * Vì sao cần: bước sinh script không gửi ảnh cho lượt viết lời thoại, ảnh chỉ đi vào 2 lượt phụ
 * (vision đọc ngoại hình sản phẩm + chốt sân khấu). Nếu tick ảnh mà fingerprint không đổi thì
 * bible cũ vẫn được dùng lại nguyên xi — người dùng bỏ ảnh gây nhiễu xong không có gì thay đổi,
 * đúng kiểu bug im lặng đã xảy ra với ảnh nền trước đây.
 *
 * Chạy: npx tsx scripts/check-script-refs.ts
 */
import assert from 'node:assert';
import {
  pickScriptRefEntries,
  pickVisionRefEntries,
  stageBibleFingerprint,
} from '../lib/livestream/refImages';
import type { LivestreamJob, LivestreamProduct } from '../lib/livestream/types';

const product = (id: string) =>
  ({ id, name: `SP ${id}`, description: `mô tả ${id}` }) as LivestreamProduct;

const base = {
  selectedModelImagePath: 'inputs/model.jpg',
  selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg'],
  selectedBackgroundImagePath: 'inputs/bg.jpg',
  scriptRefPaths: [] as string[],
  products: [product('a')],
};
const job = (over: Partial<typeof base> = {}) => ({ ...base, ...over }) as unknown as LivestreamJob;

// 1. Rỗng = giữ nguyên hành vi cũ (server tự chọn) — job cũ chưa có field này không được đổi gì.
assert.deepStrictEqual(
  pickScriptRefEntries(job()),
  pickVisionRefEntries(job()),
  'scriptRefPaths rỗng phải rơi về đúng pickVisionRefEntries'
);

// 2. Tick 1 ảnh = gửi ĐÚNG 1 ảnh đó, không tự thêm lại ảnh mẫu/ảnh nền.
const only = pickScriptRefEntries(job({ scriptRefPaths: ['inputs/p1.jpg'] }));
assert.deepStrictEqual(
  only.map((e) => e.rel),
  ['inputs/p1.jpg'],
  'tick 1 ảnh thì chỉ gửi đúng ảnh đó'
);

// 3. Nhãn suy theo VAI TRÒ thật — model cần biết đang nhìn người dẫn hay hàng hoá, sai nhãn là
//    bible tả người dẫn theo ảnh sản phẩm.
const labeled = pickScriptRefEntries(
  job({ scriptRefPaths: ['inputs/bg.jpg', 'inputs/model.jpg', 'inputs/p2.jpg'] })
);
assert.deepStrictEqual(
  labeled.map((e) => e.label),
  ['ảnh BỐI CẢNH/BACKGROUND', 'ảnh NGƯỜI MẪU/NGƯỜI DẪN', 'ảnh SẢN PHẨM THẬT 1'],
  'nhãn phải theo vai trò thật của từng ảnh'
);

// 4. Thứ tự tick được GIỮ NGUYÊN (thứ tự là thứ AI nhận).
assert.deepStrictEqual(
  pickScriptRefEntries(job({ scriptRefPaths: ['inputs/p2.jpg', 'inputs/model.jpg'] })).map(
    (e) => e.rel
  ),
  ['inputs/p2.jpg', 'inputs/model.jpg'],
  'giữ đúng thứ tự người dùng tick'
);

// 5. CỐT LÕI: đổi danh sách tick phải làm bible cũ thành stale, nếu không tick xong vô nghĩa.
assert.notStrictEqual(
  stageBibleFingerprint(job({ scriptRefPaths: ['inputs/p1.jpg'] })),
  stageBibleFingerprint(job()),
  'tick ảnh cho bước script phải đổi fingerprint (bible phải chốt lại)'
);

// 6. Nhưng đảo THỨ TỰ tick mà vẫn cùng BỘ ảnh thì KHÔNG chốt lại — tránh đốt lượt AI vô ích.
assert.strictEqual(
  stageBibleFingerprint(job({ scriptRefPaths: ['inputs/p2.jpg', 'inputs/p1.jpg'] })),
  stageBibleFingerprint(job({ scriptRefPaths: ['inputs/p1.jpg', 'inputs/p2.jpg'] })),
  'cùng bộ ảnh, khác thứ tự → fingerprint không đổi'
);

// 7. Lọc ảnh cho lượt vision đọc NGOẠI HÌNH SẢN PHẨM (logic ở route script/generate): chỉ lấy
//    phần giao với ảnh sản phẩm đã chọn — đưa ảnh mẫu/ảnh nền vào sẽ ra mô tả người/căn phòng
//    thay vì mô tả món hàng.
const forVision = (j: { scriptRefPaths: string[]; selectedRefImagePaths: string[] }) =>
  j.scriptRefPaths.length > 0
    ? j.scriptRefPaths.filter((rel) => j.selectedRefImagePaths.includes(rel))
    : j.selectedRefImagePaths;
assert.deepStrictEqual(
  forVision({
    scriptRefPaths: ['inputs/model.jpg', 'inputs/bg.jpg', 'inputs/p2.jpg'],
    selectedRefImagePaths: base.selectedRefImagePaths,
  }),
  ['inputs/p2.jpg'],
  'lượt vision chỉ đọc ảnh SẢN PHẨM trong danh sách đã tick'
);
assert.deepStrictEqual(
  forVision({ scriptRefPaths: [], selectedRefImagePaths: base.selectedRefImagePaths }),
  base.selectedRefImagePaths,
  'chưa tick gì → vision đọc mọi ảnh sản phẩm đã chọn như cũ'
);

console.log('✓ check-script-refs: 8/8 pass');
