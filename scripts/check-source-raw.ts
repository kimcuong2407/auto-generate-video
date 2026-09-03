/**
 * Self-check: dữ liệu gốc nguồn crawl (sourceRaw) được giữ nguyên vẹn qua buildProduct và chỉ gắn
 * cho ĐÚNG một sản phẩm.
 *
 * Vì sao cần:
 * - `sourceRaw` là JSON bên thứ ba, đi qua 4 chặng (trang crawl → entry → ingestTextBlocks →
 *   buildProduct → DB). Chặng nào lỡ `JSON.parse(JSON.stringify(...))` hay gán nhầm `?? null` sẽ
 *   làm hỏng dữ liệu mà typecheck không bắt được vì kiểu là `unknown`.
 * - Một lần crawl = MỘT sản phẩm Shopee. Nếu text bị splitProductBlocks tách thành nhiều khối thì
 *   các khối sau KHÔNG thuộc về JSON gốc đó — gắn cho mọi khối sẽ tạo bằng chứng đối chiếu sai,
 *   tệ hơn không có gì vì nó trông như thật.
 *
 * Không đụng DB: chỉ kiểm hàm thuần buildProduct.
 *
 * Chạy: npm run check:source-raw
 */
import assert from 'node:assert/strict';
import { buildProduct } from '../lib/livestream/jobFactory';

const RAW = { itemId: 24360882365, models: [{ name: 'Đen - L', price: 129000, stock: 42 }] };

// --- giữ nguyên vẹn, KHÔNG clone/stringify dọc đường ---
const withRaw = buildProduct({
  order: 1,
  sourceType: 'manual',
  rawText: 'Áo thun nam\nGiá: 129.000₫',
  sourceRaw: RAW,
  ingestStatus: 'ready',
  name: 'Áo thun nam',
  targetDurationSec: 60,
});
assert.deepEqual(withRaw.sourceRaw, RAW, 'sourceRaw phải giữ nguyên nội dung');
assert.equal(withRaw.sourceRaw, RAW, 'sourceRaw phải giữ nguyên tham chiếu (không clone dọc đường)');

// --- entry không phải crawl thì để trống, KHÔNG bịa object rỗng ---
const noRaw = buildProduct({
  order: 2,
  sourceType: 'link',
  sourceLink: 'https://example.com/p/1',
  rawText: 'text từ link',
  ingestStatus: 'ready',
  targetDurationSec: 60,
});
assert.equal(noRaw.sourceRaw, undefined, 'entry không có nguồn crawl thì sourceRaw phải undefined');

// --- mô phỏng ingestTextBlocks: chỉ khối ĐẦU được gắn sourceRaw ---
const blocks = ['Sản phẩm A', 'Sản phẩm B', 'Sản phẩm C'];
const products = blocks.map((block, blockIndex) =>
  buildProduct({
    order: blockIndex + 1,
    sourceType: 'manual',
    rawText: block,
    sourceRaw: blockIndex === 0 ? RAW : undefined,
    ingestStatus: 'ready',
    targetDurationSec: 60,
  })
);
assert.equal(products[0].sourceRaw, RAW, 'khối đầu phải giữ JSON gốc');
assert.equal(products[1].sourceRaw, undefined, 'khối thứ 2 KHÔNG được gắn JSON gốc của khối đầu');
assert.equal(products[2].sourceRaw, undefined, 'khối thứ 3 KHÔNG được gắn JSON gốc của khối đầu');
assert.equal(
  products.filter((p) => p.sourceRaw != null).length,
  1,
  'đúng 1 sản phẩm được gắn JSON gốc cho mỗi lần crawl'
);

// --- khối trùng nội dung vẫn phải đúng (bẫy của indexOf thay vì index) ---
const dup = ['Trùng', 'Trùng'].map((block, blockIndex) =>
  buildProduct({
    order: blockIndex + 1,
    sourceType: 'manual',
    rawText: block,
    sourceRaw: blockIndex === 0 ? RAW : undefined,
    ingestStatus: 'ready',
    targetDurationSec: 60,
  })
);
assert.equal(dup[1].sourceRaw, undefined, 'khối trùng nội dung vẫn không được gắn nhầm');

console.log('✅ check-source-raw: OK (giữ nguyên vẹn, đúng 1 sản phẩm/lần crawl)');
