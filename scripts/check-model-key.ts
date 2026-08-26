/**
 * Self-check cho modelKeyCandidates() + resolveVideoModelKey().
 *
 * Vì sao cần: videoModelKey là chuỗi reverse-engineered, Google không công bố danh sách hợp lệ.
 * Key sai trả 404 NOT_FOUND — GIỐNG HỆT lỗi "project entity không tồn tại", nên rất dễ chẩn
 * đoán nhầm sang hướng tạo lại Flow project (đã mất nhiều thời gian vì đúng cái bẫy này).
 * Nếu danh sách ứng viên mất biến thể `veo_3_1_i2v_lite`, gen video i2v tier lite sẽ chết lại.
 *
 * Chạy: npx tsx scripts/check-model-key.ts
 */
import assert from 'node:assert/strict';
import { resolveVideoModelKey, __testables } from '../lib/googleFlow/videoGen';
import { __testables as jobTestables } from '../lib/googleFlow/flowJobs';

const { modelKeyCandidates } = __testables;

// 1. Key nền cho i2v_s + lite, duration 8s (mặc định → không hậu tố duration).
const base = resolveVideoModelKey('veo_3_1_lite', 'i2v_s', 8, false);
assert.equal(base, 'veo_3_1_i2v_s_lite');

// 2. Ứng viên PHẢI chứa veo_3_1_i2v_lite — key duy nhất Google chấp nhận (xác minh 2026-08-25).
const cands = modelKeyCandidates(base);
assert.ok(
  cands.includes('veo_3_1_i2v_lite'),
  'thiếu veo_3_1_i2v_lite → gen video i2v tier lite sẽ 404 trở lại'
);

// 3. Key nền luôn được thử ĐẦU TIÊN (không đổi hành vi khi key nền vốn đúng).
assert.equal(cands[0], base);

// 4. Không trùng lặp — mỗi lần thử là 1 request thật tới Google.
assert.equal(new Set(cands).size, cands.length);

// 5. Không tự đổi tier: mọi ứng viên vẫn phải là `lite`, không được nhảy sang fast/quality.
for (const k of cands) {
  assert.ok(!/_fast|_quality/.test(k), `ứng viên "${k}" đổi tier — vượt quyền quyết định của người dùng`);
}

// 6. KHÔNG được có biến thể `_low_priority`: Google trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED
// cho tier này, và 403 không được thử tiếp → một ứng viên như vậy giết cả lần gen.
for (const k of cands) {
  assert.ok(!k.endsWith('_low_priority'), `ứng viên "${k}" sẽ trả 403 và giết cả lần gen`);
}

// 7. r2v giữ nguyên quy tắc ép tier lite đã biết.
assert.equal(resolveVideoModelKey('veo_3_1_fast', 'r2v', 8, false), 'veo_3_1_r2v_lite');

// 8. Duration: khi hoà (7s cách đều 6 và 8) phải chọn 8, KHÔNG chọn 6.
// veo_3_1_*_6s trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED (thực nghiệm 2026-08-25).
const { resolveAllowedDuration } = jobTestables;
assert.equal(resolveAllowedDuration(7, 'veo_3_1_lite', false), 8, '7s phải làm tròn LÊN 8s');
assert.equal(resolveAllowedDuration(8, 'veo_3_1_lite', false), 8);
assert.equal(resolveAllowedDuration(5, 'veo_3_1_lite', false), 6);
// Có ref images → luôn ép 8s bất kể yêu cầu.
assert.equal(resolveAllowedDuration(4, 'veo_3_1_lite', true), 8);


// ---------------------------------------------------------------
// r2v: tier LUÔN bị ép về lite bất kể model người dùng chọn.
// Veo 3.1 chỉ có r2v ở tier lite — fast/quality trả 404, lite_low_priority trả 403.
// Đây là lý do "job chọn fast nhưng thực tế chạy lite": có ảnh ref là vào nhánh này.
// ---------------------------------------------------------------
for (const model of ['veo_3_1_quality', 'veo_3_1_fast', 'veo_3_1_lite', 'veo_3_1_lite_low_priority'] as const) {
  assert.strictEqual(
    resolveVideoModelKey(model, 'r2v', 8, false),
    'veo_3_1_r2v_lite',
    `r2v phải ép về tier lite (model ${model})`
  );
}

// Biến thể key sinh ra cho r2v: KHÔNG được chứa _low_priority (403 sẽ giết cả lần gen, khác 404
// ở chỗ không được thử tiếp) — xem ghi chú trong modelKeyCandidates.
const r2vCandidates = modelKeyCandidates('veo_3_1_r2v_lite');
assert.ok(
  r2vCandidates.every((k) => !k.includes('low_priority')),
  'không được sinh biến thể _low_priority (403 PERMISSION_DENIED giết cả lần gen)'
);
assert.ok(r2vCandidates.includes('veo_3_1_r2v_lite'), 'key gốc luôn được thử đầu tiên');
assert.strictEqual(r2vCandidates[0], 'veo_3_1_r2v_lite', 'key gốc phải đứng đầu danh sách thử');
assert.strictEqual(
  new Set(r2vCandidates).size,
  r2vCandidates.length,
  'không được thử trùng key (tốn 1 request thừa mỗi lần)'
);

console.log('OK — model key + duration + r2v tier lock: tất cả assert pass');