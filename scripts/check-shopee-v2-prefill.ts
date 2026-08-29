/**
 * Self-check luồng shopee-crawl → form /livestream-v2/new.
 *
 * Hai thứ dễ hỏng âm thầm ở đây:
 * 1. Map thô ghi đè dữ liệu Shopee chắc chắn đúng (tên/màu) bằng phỏng đoán của AI.
 * 2. `advantages` lọt thông số kỹ thuật ("Kích thước 12cm") — prompt V2 bắt MỖI USP phải có cảnh
 *    demo chứng minh bằng hình, nên USP là thông số sẽ đẻ ra cảnh demo vô nghĩa.
 */
import assert from 'node:assert/strict';
import { shopeeToV2Prefill, SHOPEE_V2_PREFILL_KEY } from '../lib/shopee/toProjectPayload';
import type { ShopeeProductInfo } from '../lib/shopee/types';
import type { LivestreamV2Fields } from '../lib/livestream/types';

const base: ShopeeProductInfo = {
  itemId: 1, shopId: 2,
  name: 'Bông Tắm Tròn Tạo Bọt 3D',
  description: 'Chất liệu lưới PE mềm\nTạo bọt nhanh\nKích thước 12cm',
  images: ['https://cf.shopee.vn/a.jpg', 'https://cf.shopee.vn/b.jpg'],
  currency: 'VND', price: 25000, priceMin: 25000, priceMax: 25000,
  priceBeforeDiscount: 50000, discountPercent: 50, stock: 10,
  sold: 5, historicalSold: 100, liked: false, likedCount: 3, viewCount: 900,
  ratingStar: 4.8, ratingCount: 120, categories: ['Sắc Đẹp'], brand: 'HomeBox',
  isOfficialShop: true, shopeeVerified: true, freeShipping: true,
  shopName: 'HomeBox Official', shopLocation: 'HCM',
  models: [
    { modelId: 1, name: 'Hồng', price: 25000, priceBeforeDiscount: 50000, stock: 5 },
    { modelId: 2, name: 'Xanh', price: 25000, priceBeforeDiscount: 50000, stock: 5 },
  ],
  productUrl: 'https://shopee.vn/x',
  priceText: '₫25.000', originalPriceText: '₫50.000', soldText: 'Đã bán 100', ratingText: '4.8',
};

// --- Map thô: chỉ điền ô Shopee có field rõ ràng, KHÔNG bịa phần cần AI ---
{
  const p = shopeeToV2Prefill(base);
  assert.equal(p.name, 'Bông Tắm Tròn Tạo Bọt 3D');
  assert.equal(p.colors, 'Hồng, Xanh', 'màu phải lấy từ models');
  assert.equal(p.channelName, 'HomeBox Official', 'tên kênh phải lấy từ shopName');
  assert.equal(p.promotion, 'Giảm 50%, Freeship');
  assert.deepEqual(p.imageUrls, base.images);
  // Các ô cần AI phải để RỖNG ở bước map thô — điền đại vào đây là bịa.
  for (const k of ['usage', 'material', 'size', 'audience', 'howToUse', 'storage'] as const) {
    assert.equal(p[k], '', `${k} phải rỗng ở map thô (chờ AI tách)`);
  }
  assert.deepEqual(p.advantages, [], 'advantages phải rỗng ở map thô, không map từ description');
  assert.ok(p.rawText.includes('Bông Tắm'), 'rawText phải chứa dữ liệu gốc để AI tách');
}

// --- Không khuyến mãi → promotion rỗng, để prompt V2 cấm bịa giá phát huy tác dụng ---
{
  const p = shopeeToV2Prefill({ ...base, discountPercent: 0, freeShipping: false });
  assert.equal(p.promotion, '', 'không có ưu đãi thì promotion phải rỗng');
}

// --- Shop nghèo dữ liệu: không được crash, các ô đơn giản về rỗng ---
{
  const p = shopeeToV2Prefill({ ...base, models: [], shopName: '', description: '' });
  assert.equal(p.colors, '');
  assert.equal(p.channelName, '');
  assert.equal(p.name, 'Bông Tắm Tròn Tạo Bọt 3D', 'tên vẫn phải giữ');
}

/**
 * Mô phỏng đúng bước đắp field ở goToV2Form (app/shopee-crawl/page.tsx): AI chỉ ĐẮP ô còn trống,
 * không ghi đè tên/màu do Shopee cung cấp.
 */
function applyAiFields(
  prefill: ReturnType<typeof shopeeToV2Prefill>,
  fields: LivestreamV2Fields
): ReturnType<typeof shopeeToV2Prefill> {
  return {
    ...prefill,
    name: prefill.name || fields.name || '',
    colors: prefill.colors || fields.colors || '',
    advantages: fields.advantages || [],
    usage: fields.usage || '',
    material: fields.material || '',
    size: fields.size || '',
    audience: fields.audience || '',
    howToUse: fields.howToUse || '',
    storage: fields.storage || '',
  };
}

const aiFields: LivestreamV2Fields = {
  name: 'Bông tắm (AI đoán tên khác)',
  advantages: ['Tạo bọt nhanh và nhiều', 'Bề mặt mềm không xước da'],
  usage: 'Làm sạch và massage cơ thể khi tắm',
  material: 'Lưới PE mềm',
  size: 'Đường kính khoảng 12cm',
  colors: 'Đỏ (AI đoán sai)',
  audience: 'Cả nam và nữ',
  howToUse: 'Làm ướt, cho sữa tắm rồi xoa tạo bọt',
  storage: 'Rửa sạch, treo nơi thoáng mát',
};

// --- AI đắp ô trống nhưng KHÔNG ghi đè dữ liệu Shopee ---
{
  const merged = applyAiFields(shopeeToV2Prefill(base), aiFields);
  assert.equal(merged.name, 'Bông Tắm Tròn Tạo Bọt 3D', 'AI KHÔNG được ghi đè tên từ Shopee');
  assert.equal(merged.colors, 'Hồng, Xanh', 'AI KHÔNG được ghi đè màu từ models');
  assert.equal(merged.usage, 'Làm sạch và massage cơ thể khi tắm');
  assert.equal(merged.material, 'Lưới PE mềm');
  assert.equal(merged.size, 'Đường kính khoảng 12cm');
  assert.deepEqual(merged.advantages, ['Tạo bọt nhanh và nhiều', 'Bề mặt mềm không xước da']);
}

// --- Shopee thiếu tên/màu thì AI mới được lấp vào ---
{
  const merged = applyAiFields(shopeeToV2Prefill({ ...base, name: '', models: [] }), aiFields);
  assert.equal(merged.name, 'Bông tắm (AI đoán tên khác)', 'Shopee thiếu tên thì dùng của AI');
  assert.equal(merged.colors, 'Đỏ (AI đoán sai)', 'Shopee thiếu màu thì dùng của AI');
}

// --- Đếm số ô điền được, khớp con số báo cáo cho Mr.D ---
{
  const merged = applyAiFields(shopeeToV2Prefill(base), aiFields);
  // 18 ô của form; durationSec/dialoguesPerScene/platform luôn có mặc định nên tính là đã điền.
  const filled = [
    merged.name, merged.advantages.length ? 'x' : '', merged.usage, merged.material, merged.size,
    merged.colors, merged.audience, merged.howToUse, merged.storage,
    'duration', 'dialogues', 'platform',
    merged.channelName, '', '', merged.promotion, '',
    merged.imageUrls.length ? 'x' : '',
  ].filter((v) => String(v).trim() !== '').length;
  assert.equal(filled, 15, `phải điền được 15/18 ô sau khi có AI, đang là ${filled}`);
}

// --- Key sessionStorage phải ổn định: đổi ở 1 phía là prefill im lặng mất tác dụng ---
assert.equal(SHOPEE_V2_PREFILL_KEY, 'shopee-v2-prefill');

console.log('✅ check-shopee-v2-prefill: OK');
