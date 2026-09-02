/**
 * Self-check cho params `${...}` trong system prompt sinh kịch bản (lib/livestream/promptParams.ts).
 *
 * Chạy: npm run check:prompt-params
 */
import assert from 'node:assert/strict';
import {
  PROMPT_PARAMS,
  buildPromptParamValues,
  fillPromptParams,
} from '../lib/livestream/promptParams';

const job = {
  products: [
    { id: 'p1', name: 'Áo thun', description: 'Cotton 100%', targetDurationSec: 24 },
    { id: 'p2', name: 'Quần jean', description: 'Denim co giãn', targetDurationSec: 32 },
  ],
} as never as Parameters<typeof buildPromptParamValues>[0]['job'];

const v2Input = {
  advantages: ['Thấm hút tốt', 'Không nhăn'],
  platform: 'Shopee Live',
  channelName: 'Shop ABC',
  followerCount: '10k',
  viewerCount: '500',
  promotion: 'Giảm 30%',
  cta: 'Chốt đơn ngay',
  dialoguesPerScene: 3,
};

const values = buildPromptParamValues({
  job,
  product: job.products[1],
  durations: [8, 8, 8, 8],
  v2Input,
});

// Giá trị lấy đúng sản phẩm ĐANG sinh, không phải sản phẩm đầu tiên.
assert.equal(values.ten_sanpham, 'Quần jean');
assert.equal(values.mota_sanpham, 'Denim co giãn');
assert.equal(values.thoiluong, '32');
assert.equal(values.so_doan, '4');
assert.equal(values.vi_tri_sanpham, '2');
assert.equal(values.so_sanpham, '2');
assert.equal(values.uu_diem, 'Thấm hút tốt\nKhông nhăn');
assert.equal(values.cta, 'Chốt đơn ngay');

// Mọi key khai báo trong PROMPT_PARAMS đều phải có giá trị — thiếu là UI gợi ý param chết.
for (const p of PROMPT_PARAMS) {
  assert.ok(p.key in values, `PROMPT_PARAMS khai báo "${p.key}" nhưng buildPromptParamValues không trả về`);
}

// Job V1 (không có v2Input) không được crash, param V2 về chuỗi rỗng.
const v1 = buildPromptParamValues({ job, product: job.products[0], durations: [8, 8, 8] });
assert.equal(v1.uu_diem, '');
assert.equal(v1.nen_tang, '');
assert.equal(v1.ten_sanpham, 'Áo thun');

// Thay nhiều lần, nhiều param, có cả khoảng trắng trong ngoặc.
assert.equal(
  fillPromptParams('Bán ${ten_sanpham}: ${ mota_sanpham } trong ${thoiluong}s', values),
  'Bán Quần jean: Denim co giãn trong 32s'
);

// Param lạ GIỮ NGUYÊN — nuốt mất thành chuỗi rỗng thì gõ sai tên không có dấu hiệu nào.
assert.equal(fillPromptParams('Xin chào ${khong_ton_tai} nhé', values), 'Xin chào ${khong_ton_tai} nhé');

// Prompt không có param nào thì trả về y nguyên (đường đi của mọi prompt mặc định hiện tại).
const plain = 'Bạn là chuyên gia viết kịch bản livestream.';
assert.equal(fillPromptParams(plain, values), plain);

// Giá trị thay vào có chứa ${...} cũng KHÔNG được thay tiếp (tránh vòng lặp/inject từ mô tả sản phẩm).
assert.equal(
  fillPromptParams('${mota_sanpham}', { mota_sanpham: 'giá ${ten_sanpham} đồng', ten_sanpham: 'X' }),
  'giá ${ten_sanpham} đồng'
);

console.log('✅ check-prompt-params: OK');
