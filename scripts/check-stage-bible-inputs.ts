/**
 * Self-check: bước chốt "stage bible" phải BÁM ĐÚNG dữ liệu đầu vào, và gọi lại nhiều lần với
 * cùng input thì KHÔNG chốt lại (lib/livestream/refImages.ts + stageBible.ts).
 *
 * Vì sao cần: bible được cache cấp job. Trước đây dấu vết duy nhất là ảnh mẫu, nên đổi ảnh nền /
 * đổi bộ ảnh sản phẩm / sửa mô tả sản phẩm thì bible cũ vẫn dùng lại VĨNH VIỄN dù đang tả sai sân
 * khấu — ca thật: ảnh mẫu nam nhưng host chốt ra "athletic woman", 32 đoạn đều mô tả nữ, gen video
 * thì ref (nam) chọi prompt (nữ) → MEDIA_GENERATION_STATUS_FAILED.
 *
 * Chạy: npx tsx scripts/check-stage-bible-inputs.ts
 */
import assert from 'node:assert';
import { pickVisionRefEntries, stageBibleFingerprint } from '../lib/livestream/refImages';
import { isStageBibleStale } from '../lib/livestream/stageBible';
import type { LivestreamProduct, LivestreamStageBible } from '../lib/livestream/types';

const product = (id: string, over: Partial<LivestreamProduct> = {}) =>
  ({ id, name: `SP ${id}`, description: `mô tả ${id}`, ...over }) as LivestreamProduct;

const job = (over: Record<string, unknown> = {}) => ({
  selectedRefImagePaths: [] as string[],
  selectedModelImagePath: null as string | null,
  selectedBackgroundImagePath: null as string | null,
  products: [product('a'), product('b')],
  ...over,
});

// ─── pickVisionRefEntries: ảnh nào được gửi cho vision, theo thứ tự nào ───────────────────────

// 1. Không có ảnh nào → rỗng (caller rơi về đường text-only).
assert.deepStrictEqual(pickVisionRefEntries(job()), [], 'không ảnh → mảng rỗng');

// 2. CA CỦA MR.D: ảnh mẫu phải đứng ĐẦU, và ảnh sản phẩm PHẢI có mặt (trước đây bị bỏ hoàn toàn).
let e = pickVisionRefEntries(
  job({
    selectedModelImagePath: 'inputs/model-1.jpg',
    selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg'],
    selectedBackgroundImagePath: 'inputs/bg.jpg',
  })
);
assert.deepStrictEqual(
  e.map((x) => x.rel),
  ['inputs/model-1.jpg', 'inputs/p1.jpg', 'inputs/p2.jpg', 'inputs/bg.jpg'],
  'thứ tự phải là: ảnh mẫu → ảnh sản phẩm → ảnh nền'
);
assert.ok(e[0].label.includes('NGƯỜI MẪU'), 'ảnh đầu phải mang nhãn người mẫu');
assert.ok(e[3].label.includes('BỐI CẢNH'), 'ảnh cuối phải mang nhãn bối cảnh');

// 3. Chọn NHIỀU ảnh sản phẩm: cắt còn 3 và bỏ ảnh [0] (ảnh bìa marketing sàn TMĐT).
e = pickVisionRefEntries(
  job({ selectedRefImagePaths: ['cover.jpg', 'p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg'] })
);
assert.deepStrictEqual(
  e.map((x) => x.rel),
  ['p1.jpg', 'p2.jpg', 'p3.jpg'],
  'dư ảnh → bỏ ảnh bìa, tối đa 3 ảnh sản phẩm'
);

// 4. Đúng 3 ảnh sản phẩm (không dư) → giữ nguyên cả 3, KHÔNG bỏ ảnh đầu.
e = pickVisionRefEntries(job({ selectedRefImagePaths: ['p1.jpg', 'p2.jpg', 'p3.jpg'] }));
assert.deepStrictEqual(e.map((x) => x.rel), ['p1.jpg', 'p2.jpg', 'p3.jpg'], 'đủ 3 thì giữ nguyên');

// 5. Ảnh sản phẩm được đánh số liên tục từ 1 (legend gửi cho model phải khớp).
assert.deepStrictEqual(
  e.map((x) => x.label),
  ['ảnh SẢN PHẨM THẬT 1', 'ảnh SẢN PHẨM THẬT 2', 'ảnh SẢN PHẨM THẬT 3'],
  'nhãn ảnh sản phẩm đánh số từ 1'
);

// ─── stageBibleFingerprint: cùng input → cùng chuỗi, đổi input → đổi chuỗi ───────────────────

const base = job({
  selectedModelImagePath: 'inputs/model-1.jpg',
  selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg'],
  selectedBackgroundImagePath: 'inputs/bg.jpg',
});

// 6. Ổn định: gọi 2 lần cùng input phải ra chuỗi giống hệt (nếu không, mỗi lần sinh script đều
//    tính là lệch và đốt thêm 1 lượt AI vision vô ích).
assert.strictEqual(
  stageBibleFingerprint(base),
  stageBibleFingerprint(base),
  'cùng input phải ra cùng fingerprint'
);

// 7. Đảo thứ tự ảnh sản phẩm (bỏ chọn rồi chọn lại) mà BỘ ảnh không đổi → fingerprint KHÔNG đổi.
assert.strictEqual(
  stageBibleFingerprint(job({ ...base, selectedRefImagePaths: ['inputs/p2.jpg', 'inputs/p1.jpg'] })),
  stageBibleFingerprint(base),
  'đảo thứ tự cùng bộ ảnh không được tính là đổi input'
);

// 8. Mỗi loại input đổi đều phải làm fingerprint đổi.
const differs = (over: Record<string, unknown>, msg: string) =>
  assert.notStrictEqual(stageBibleFingerprint(job({ ...base, ...over })), stageBibleFingerprint(base), msg);

differs({ selectedModelImagePath: 'inputs/model-2.jpg' }, 'đổi ảnh mẫu phải đổi fingerprint');
differs({ selectedModelImagePath: null }, 'xoá ảnh mẫu phải đổi fingerprint');
differs({ selectedRefImagePaths: ['inputs/p1.jpg'] }, 'bớt ảnh sản phẩm phải đổi fingerprint');
differs(
  { selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg', 'inputs/p3.jpg'] },
  'thêm ảnh sản phẩm phải đổi fingerprint'
);
differs({ selectedBackgroundImagePath: 'inputs/bg-2.jpg' }, 'đổi ảnh nền phải đổi fingerprint');
differs({ selectedBackgroundImagePath: null }, 'bỏ chọn ảnh nền phải đổi fingerprint');
differs(
  { products: [product('a'), product('b', { description: 'mô tả ĐÃ SỬA' })] },
  'sửa mô tả sản phẩm phải đổi fingerprint'
);
differs({ products: [product('a')] }, 'xoá 1 sản phẩm phải đổi fingerprint');

// ─── isStageBibleStale: quyết định có chốt lại hay không ──────────────────────────────────────

const bible = (over: Partial<LivestreamStageBible> = {}): LivestreamStageBible => ({
  host: 'a Vietnamese man in his early 30s, shaved head, clear-frame glasses',
  scene: 'a home live-selling corner',
  camera: 'medium shot, eye-level',
  voice: 'adult male voice, warm mid-range pitch',
  wardrobeLock: 'same outfit throughout',
  modelImagePath: 'inputs/model-1.jpg',
  inputsFingerprint: stageBibleFingerprint(base),
  ...over,
});

// 9. Input y nguyên → KHÔNG stale. Đây chính là yêu cầu "gọi nhiều lần vẫn đúng base": bấm sinh
//    script lần 2, lần 3 mà không đổi gì thì dùng lại đúng bible cũ, không tốn lượt AI.
assert.strictEqual(
  isStageBibleStale({ ...base, stageBible: bible() }),
  false,
  'input không đổi → tái dùng bible, không chốt lại'
);

// 10. Đổi ảnh NỀN → stale. Trước đây lọt lưới vì chỉ so modelImagePath, khiến bible tả sai phòng
//     vĩnh viễn và UI không có nút chốt lại.
assert.strictEqual(
  isStageBibleStale({ ...base, selectedBackgroundImagePath: 'inputs/bg-2.jpg', stageBible: bible() }),
  true,
  'đổi ảnh nền phải chốt lại bible'
);

// 11. Đổi bộ ảnh SẢN PHẨM → stale (bible tả bối cảnh/đạo cụ dựa theo ảnh sản phẩm).
assert.strictEqual(
  isStageBibleStale({ ...base, selectedRefImagePaths: ['inputs/p9.jpg'], stageBible: bible() }),
  true,
  'đổi ảnh sản phẩm phải chốt lại bible'
);

// 12. Sửa mô tả sản phẩm → stale.
assert.strictEqual(
  isStageBibleStale({
    ...base,
    products: [product('a'), product('b', { description: 'mô tả ĐÃ SỬA' })],
    stageBible: bible(),
  }),
  true,
  'sửa mô tả sản phẩm phải chốt lại bible'
);

// 13. Toggle 1 ảnh ref rồi toggle lại (mảng đảo thứ tự, bộ ảnh về như cũ) → KHÔNG stale.
assert.strictEqual(
  isStageBibleStale({
    ...base,
    selectedRefImagePaths: ['inputs/p2.jpg', 'inputs/p1.jpg'],
    stageBible: bible(),
  }),
  false,
  'toggle ảnh rồi toggle lại không được đốt thêm lượt AI'
);

// 14. Đổi ảnh mẫu → stale (hành vi cũ, phải giữ nguyên).
assert.strictEqual(
  isStageBibleStale({ ...base, selectedModelImagePath: 'inputs/model-2.jpg', stageBible: bible() }),
  true,
  'đổi ảnh mẫu phải chốt lại bible'
);

// 15. Bible do bản code CŨ chốt (thiếu cả modelImagePath lẫn inputsFingerprint) trong khi job đang
//     có ảnh mẫu → stale. Không có ca này thì job của Mr.D kẹt mãi với người dẫn sai giới tính.
assert.strictEqual(
  isStageBibleStale({
    ...base,
    stageBible: bible({ modelImagePath: undefined, inputsFingerprint: undefined }),
  }),
  true,
  'bible bản cũ + job có ảnh mẫu → phải chốt lại'
);

// 16. Bible bản cũ khớp ảnh mẫu nhưng thiếu fingerprint → vẫn stale (chốt lại 1 lần để ghi dấu vết
//     đầy đủ, từ lần sau mới tái dùng được).
assert.strictEqual(
  isStageBibleStale({ ...base, stageBible: bible({ inputsFingerprint: undefined }) }),
  true,
  'thiếu fingerprint → chốt lại 1 lần để ghi dấu vết'
);

// 17. Chưa có bible → không có gì để chốt lại (ensureStageBible tự sinh lần đầu).
assert.strictEqual(
  isStageBibleStale({ ...base, stageBible: null }),
  false,
  'chưa có bible thì không tính là stale'
);

// 18. Caller cũ chỉ truyền 2 field (không có products) → rơi về đúng hành vi cũ, không crash.
assert.strictEqual(
  isStageBibleStale({ stageBible: bible(), selectedModelImagePath: 'inputs/model-1.jpg' }),
  false,
  'thiếu products thì chỉ so ảnh mẫu như hành vi cũ'
);

console.log('✓ check-stage-bible-inputs: 18/18 pass');
