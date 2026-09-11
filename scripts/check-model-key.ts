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
import { readFileSync } from 'node:fs';
import { resolveVideoModelKey, __testables } from '../lib/googleFlow/videoGen';
import { __testables as jobTestables } from '../lib/googleFlow/flowJobs';

const { modelKeyCandidates } = __testables;

// 1. Key nền cho i2v_s + lite, duration 8s (mặc định → không hậu tố duration).
//
// ĐỔI 2026-09-11: trước đây hàm sinh `veo_3_1_i2v_s_lite` rồi TRÔNG CHỜ modelKeyCandidates
// sửa hộ — nhưng candidates là code CHẾT (không được gọi ở đâu, xem docstring của nó), nên
// thực tế mọi lần gen tier lite kèm ảnh đầu đều gửi key không tồn tại và bị Google từ chối
// bằng response RỖNG. Nay sinh thẳng dạng rút gọn, khớp cả hai nguồn:
//   - thực nghiệm 2026-08-25: `veo_3_1_i2v_s_lite` → 404; `veo_3_1_i2v_lite` → chạy;
//   - HAR gen thật 2026-09-11: trang Flow gửi `veo_3_1_i2v_lite_low_priority`.
const base = resolveVideoModelKey('veo_3_1_lite', 'i2v_s', 8, false);
assert.equal(base, 'veo_3_1_i2v_lite', 'tier lite phải dùng mode RÚT GỌN i2v (không có _s)');

// fast/quality vẫn giữ dạng dài `i2v_s` — chỉ tier lite rút gọn.
assert.equal(resolveVideoModelKey('veo_3_1_fast', 'i2v_s', 8, false), 'veo_3_1_i2v_s_fast');
assert.equal(resolveVideoModelKey('veo_3_1_quality', 'i2v_s', 8, false), 'veo_3_1_i2v_s_quality');

// Tier lite_low_priority: đúng key HAR gen thật gửi.
assert.equal(
  resolveVideoModelKey('veo_3_1_lite_low_priority', 'i2v_s', 8, false),
  'veo_3_1_i2v_lite_low_priority',
  'phải khớp key trong HAR gen thật (docs/create-project-flow.google.com.har)'
);

// 2. Ứng viên vẫn giữ biến thể dài, phòng khi Google đổi lại quy ước.
const cands = modelKeyCandidates(resolveVideoModelKey('veo_3_1_fast', 'i2v_s', 8, false));
assert.ok(
  cands.includes('veo_3_1_i2v_fast'),
  'candidates phải có dạng rút gọn để fallback được khi key dài bị từ chối'
);

// 3. abra: HAR gen thật gửi `abra_i2v_8s` — mode rút gọn + LUÔN có hậu tố duration (kể cả 8s,
// khác quy tắc của veo_3_1). Sai một trong hai là Google từ chối bằng response rỗng.
assert.equal(resolveVideoModelKey('abra', 'i2v_s', 8, false), 'abra_i2v_8s');
assert.equal(resolveVideoModelKey('abra', 'i2v_s', 6, false), 'abra_i2v_6s');
assert.equal(resolveVideoModelKey('abra', 't2v', 8, false), 'abra_t2v_8s');
assert.equal(resolveVideoModelKey('abra', 'r2v', 8, false), 'abra_i2v_8s', 'abra r2v gộp vào i2v');

// 4. Key nền luôn được thử ĐẦU TIÊN (không đổi hành vi khi key nền vốn đúng).
const fastBase = resolveVideoModelKey('veo_3_1_fast', 'i2v_s', 8, false);
assert.equal(cands[0], fastBase);

// 4. Không trùng lặp — mỗi lần thử là 1 request thật tới Google.
assert.equal(new Set(cands).size, cands.length);

// 5. Không tự đổi tier: ứng viên chỉ được đổi DẠNG HẬU TỐ, giữ nguyên tier người dùng chọn —
// tier quyết định chi phí và chất lượng, đổi ngầm là vượt quyền quyết định của người dùng.
for (const [tier, keys] of [
  ['lite', modelKeyCandidates(base)],
  ['fast', cands],
] as const) {
  for (const k of keys) {
    assert.ok(
      k.includes(`_${tier}`),
      `ứng viên "${k}" rời khỏi tier "${tier}" — vượt quyền quyết định của người dùng`
    );
  }
}

// 6. KHÔNG tự thêm biến thể `_low_priority`: Google trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED
// cho tier này với tài khoản không được cấp, và 403 không được thử tiếp → một ứng viên như
// vậy giết cả lần gen. (Key nền VỐN là low_priority thì khác — đó là lựa chọn của người dùng.)
for (const k of modelKeyCandidates(base)) {
  assert.ok(!k.endsWith('_low_priority'), `ứng viên "${k}" sẽ trả 403 và giết cả lần gen`);
}

// 7. r2v dùng key i2v — batchexecute KHÔNG có key r2v riêng.
//
// XÁC MINH 2026-09-09: quét toàn bộ HAR gen thật chỉ thấy `veo_3_1_i2v_lite_low_priority`
// và `abra_i2v_8s`, KHÔNG có key nào chứa 'r2v'. Gen bằng key `veo_3_1_r2v_*` → Google trả
// state 4 "Media not found." 17 lần liên tiếp, trong khi tạo tay cùng prompt+ảnh thì chạy.
// Khớp với cấu trúc payload: buildScene chỉ có MỘT slot ảnh (startMediaId).
assert.equal(resolveVideoModelKey('veo_3_1_fast', 'r2v', 8, false), 'veo_3_1_i2v_lite_low_priority');

// 8. Duration: khi hoà (7s cách đều 6 và 8) phải chọn 8, KHÔNG chọn 6.
// veo_3_1_*_6s trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED (thực nghiệm 2026-08-25).
const { resolveAllowedDuration } = jobTestables;
assert.equal(resolveAllowedDuration(7, 'veo_3_1_lite', false), 8, '7s phải làm tròn LÊN 8s');
assert.equal(resolveAllowedDuration(8, 'veo_3_1_lite', false), 8);
assert.equal(resolveAllowedDuration(5, 'veo_3_1_lite', false), 6);
// Có ref images → luôn ép 8s bất kể yêu cầu.
assert.equal(resolveAllowedDuration(4, 'veo_3_1_lite', true), 8);


// ---------------------------------------------------------------
// r2v: tier LUÔN bị ép về lite bất kể model người dùng chọn, và dùng TÊN MODE i2v.
// Đây là lý do "job chọn fast nhưng thực tế chạy lite": có ảnh ref là vào nhánh này.
// ---------------------------------------------------------------
for (const model of ['veo_3_1_quality', 'veo_3_1_fast', 'veo_3_1_lite', 'veo_3_1_lite_low_priority'] as const) {
  assert.strictEqual(
    resolveVideoModelKey(model, 'r2v', 8, false),
    'veo_3_1_i2v_lite_low_priority',
    `r2v phải ép về key i2v tier lite_low_priority (model ${model})`
  );
}

// Mode KHÁC r2v không được ăn theo tier ép của r2v — t2v/i2v vẫn theo model người dùng chọn.
assert.strictEqual(
  resolveVideoModelKey('veo_3_1_fast', 't2v', 8, false),
  'veo_3_1_t2v_fast',
  't2v giữ nguyên tier người dùng chọn, không bị r2v kéo theo'
);
assert.strictEqual(
  resolveVideoModelKey('veo_3_1_quality', 'i2v_s', 8, false),
  'veo_3_1_i2v_s_quality',
  'i2v_s giữ nguyên tier người dùng chọn'
);

// Hậu tố thời lượng vẫn đúng khi đã đổi tier (8s bỏ hậu tố, khác 8s thì thêm).
assert.strictEqual(
  resolveVideoModelKey('veo_3_1_fast', 'r2v', 6, false),
  'veo_3_1_i2v_lite_low_priority_6s',
  'r2v 6s phải kèm hậu tố _6s sau tier'
);

// Biến thể key sinh ra cho r2v: KHÔNG được chứa _low_priority (403 sẽ giết cả lần gen, khác 404
// ở chỗ không được thử tiếp) — xem ghi chú trong modelKeyCandidates.
// modelKeyCandidates KHÔNG được TỰ THÊM biến thể _low_priority vào key chưa có nó: 403 khác 404
// ở chỗ không được thử tiếp, một ứng viên 403 lọt vào là giết cả lần gen. (Key r2v nay đã mang
// sẵn _low_priority từ resolveVideoModelKey — đó là lựa chọn tường minh, không phải tự sinh.)
const liteCandidates = modelKeyCandidates('veo_3_1_i2v_s_lite');
assert.ok(
  liteCandidates.every((k) => !k.includes('low_priority')),
  'không được TỰ SINH biến thể _low_priority (403 PERMISSION_DENIED giết cả lần gen)'
);

const r2vCandidates = modelKeyCandidates('veo_3_1_r2v_lite_low_priority');
assert.strictEqual(
  r2vCandidates[0],
  'veo_3_1_r2v_lite_low_priority',
  'key gốc phải đứng đầu danh sách thử'
);
assert.strictEqual(
  new Set(r2vCandidates).size,
  r2vCandidates.length,
  'không được thử trùng key (tốn 1 request thừa mỗi lần)'
);

// --- Chống tái phát: KHÔNG key nào được chứa 'r2v'.
//
// Google đã gỡ kiến trúc REST nơi r2v có key riêng. Sinh ra key chứa 'r2v' = quay lại đúng
// bug đã lặp 17 lần: Google trả "Media not found." mà app tưởng job đang render.
{
  const models = ['veo_3_1_quality', 'veo_3_1_fast', 'veo_3_1_lite', 'veo_3_1_lite_low_priority'] as const;
  const modes = ['t2v', 'i2v_s', 'i2v_se', 'r2v'] as const;
  for (const m of models)
    for (const mode of modes)
      for (const dur of [4, 6, 8, 10])
        for (const fl of [true, false]) {
          const key = resolveVideoModelKey(m, mode, dur, fl);
          assert.ok(!key.includes('r2v'), `key "${key}" chứa 'r2v' — batchexecute không có key này`);
        }
}

console.log('OK — model key + duration + r2v tier lock: tất cả assert pass');
// ---------------------------------------------------------------
// 10. Fallback model key phải được NỐI THẬT vào generateVideo.
//
// Vì sao check bằng đọc source: modelKeyCandidates từng là code CHẾT suốt từ lúc port sang
// batchexecute — docstring cũ ghi rõ "HIỆN KHÔNG ĐƯỢC GỌI Ở ĐÂU". Hệ quả: sự cố 2026-09-09
// (key r2v sai, Google từ chối 17 lần) không có gì chặn, và mọi lần gen tier lite kèm ảnh đầu
// đều gửi key không tồn tại. Một hàm fallback không được gọi thì tệ hơn không có, vì nhìn vào
// code ai cũng tưởng đang được bảo vệ.
// ---------------------------------------------------------------
{
  const src = readFileSync(new URL('../lib/googleFlow/videoGen.ts', import.meta.url), 'utf8');
  const gen = src.slice(src.indexOf('export async function generateVideo'));
  const body = gen.slice(0, gen.indexOf('\n}\n') + 2);

  assert.ok(
    /modelKeyCandidates\(/.test(body),
    'generateVideo PHẢI gọi modelKeyCandidates — không gọi thì fallback là code chết'
  );
  assert.ok(
    /isInvalidModelKeyError\(/.test(body),
    'chỉ được thử biến thể khi lỗi là "key không hợp lệ" — 403 thiếu quyền thử tiếp là vô ích'
  );

  // 403 KHÔNG được thử tiếp: key đúng, tài khoản thiếu quyền.
  const guard = src.slice(src.indexOf('function isInvalidModelKeyError'));
  assert.ok(
    /err\.code === 403/.test(guard.slice(0, guard.indexOf('\n}\n'))),
    'isInvalidModelKeyError phải loại trừ 403 tường minh'
  );
}

// ---------------------------------------------------------------
// 11. Kiểm model khả dụng TRƯỚC khi gửi lệnh gen.
//
// yBhWQ trả danh sách tier Google cấp cho tài khoản (gọi thật 2026-09-11:
// veo_3_1_quality, veo_3_1_lite, veo_3_1_fast, veo_3_1_lite_low_priority, abra).
// Không kiểm thì model sai bị từ chối bằng response RỖNG — không mã lỗi, không phân biệt
// được với token reCAPTCHA hỏng, và mỗi lần thử lại tiêu thêm 1 reCAPTCHA token.
// ---------------------------------------------------------------
{
  const src = readFileSync(new URL('../lib/googleFlow/flowJobs.ts', import.meta.url), 'utf8');
  assert.ok(/assertModelAvailable\(/.test(src), 'generateSceneVideo phải kiểm model trước khi gen');
  assert.ok(/rpcAvailableModels/.test(src), 'phải hỏi Google danh sách model thật, không hardcode');

  const fn = src.slice(src.indexOf('async function assertModelAvailable'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  // KHÔNG được chặn oan khi RPC phụ trợ hỏng — thà để lệnh gen chạy và tự báo lỗi.
  assert.ok(/catch/.test(body) && /return;/.test(body), 'đọc danh sách lỗi thì bỏ qua bước kiểm, không chặn oan');
  assert.ok(
    /models\.length === 0/.test(body),
    'danh sách rỗng = Google đổi cấu trúc response, không phải tài khoản không có model — không chặn'
  );
}

console.log('check-model-key (bổ sung fallback + kiểm model): OK');
