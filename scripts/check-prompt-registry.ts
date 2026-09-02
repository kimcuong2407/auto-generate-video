/**
 * Self-check: thứ tự ưu tiên prompt (job → global → mặc định) và ngữ nghĩa 3 trạng thái.
 *
 * Vì sao cần: body rỗng là lựa chọn HỢP LỆ nghĩa "tắt hẳn" (negative prompt), khác hẳn với "không
 * có row" nghĩa "dùng mặc định". Viết `jobRow || globalRow || fallback` sẽ nuốt mất chuỗi rỗng và
 * âm thầm bật lại negative prompt mà người dùng đã chủ động tắt — đúng cái bẫy resolveNegativePrompt
 * đã phải cảnh báo bằng comment. Check này khoá lại hợp đồng đó.
 *
 * Không đụng DB: dựng PromptSet trực tiếp từ 2 Map, đúng thứ loadPromptSet build ra sau khi query.
 *
 * Chạy: npm run check:prompt-registry
 */
import assert from 'node:assert/strict';
import {
  PROMPT_STEPS,
  fallbackFor,
  getPromptStep,
  isPromptStepKey,
  type PromptStepKey,
} from '../lib/livestream/promptSteps';
import { buildPromptSet, emptyPromptSet } from '../lib/livestream/promptStore';
import { LIVESTREAM_SYSTEM_PROMPT } from '../lib/livestream/promptDefaults';
import { LIVESTREAM_V2_SYSTEM_PROMPT } from '../lib/livestream/promptDefaultsV2';

// --- tầng mặc định: không có row nào → luôn ra hằng trong code ---
const empty = emptyPromptSet();
for (const step of PROMPT_STEPS) {
  assert.equal(empty.get(step.key), step.fallback, `bước ${step.key} phải rơi về hằng mặc định`);
  assert.equal(empty.scopeOf(step.key), 'default', `bước ${step.key} phải báo scope 'default'`);
  assert.equal(empty.raw(step.key, 'job'), undefined);
  assert.equal(empty.raw(step.key, 'global'), undefined);
}

// --- bước sinh script có HAI bản mặc định: V1 và V2 AIDA Shopee ---
assert.equal(empty.get('script'), LIVESTREAM_SYSTEM_PROMPT);
assert.equal(empty.get('script', { isV2: true }), LIVESTREAM_V2_SYSTEM_PROMPT);
assert.notEqual(LIVESTREAM_SYSTEM_PROMPT, LIVESTREAM_V2_SYSTEM_PROMPT);
assert.equal(fallbackFor('script', true), LIVESTREAM_V2_SYSTEM_PROMPT);
// isV2 chỉ đổi bước script, không lây sang bước khác.
assert.equal(fallbackFor('background', true), getPromptStep('background').fallback);

// --- danh sách bước: khoá phải duy nhất, nhãn/hint/fallback không được rỗng ---
const keys = PROMPT_STEPS.map((s) => s.key);
assert.equal(new Set(keys).size, keys.length, 'step key bị trùng — khoá này lưu trong DB');
for (const s of PROMPT_STEPS) {
  assert.ok(s.label.trim(), `bước ${s.key} thiếu nhãn`);
  assert.ok(s.hint.trim(), `bước ${s.key} thiếu mô tả chạy lúc nào`);
  assert.ok(s.fallback.trim(), `bước ${s.key} thiếu prompt mặc định`);
  assert.ok(s.key.length <= 64, `step key "${s.key}" dài quá cột varchar(64)`);
  // Khoá lưu trong DB: chỉ chữ thường + gạch dưới, tránh ca đổi hoa/thường giữa các DB collation.
  assert.match(s.key, /^[a-z0-9_]+$/, `step key "${s.key}" phải là snake_case`);
  assert.ok(isPromptStepKey(s.key));
}
assert.ok(!isPromptStepKey('khong_ton_tai'));
assert.ok(!isPromptStepKey(''));

// --- 3 bước chạy TRƯỚC khi job tồn tại → chỉ sửa được bản mặc định ---
for (const key of ['extract', 'vision_screenshot', 'v2_field_extract'] as PromptStepKey[]) {
  assert.equal(getPromptStep(key).perJob, false, `bước ${key} chạy trước khi có job, không thể override theo job`);
}
// Ngược lại: các bước trong luồng gen phải override được theo job.
for (const key of ['script', 'background', 'stage_bible', 'negative_video'] as PromptStepKey[]) {
  assert.equal(getPromptStep(key).perJob, true, `bước ${key} phải override được theo job`);
}

// --- 3 cột override cũ phải có bước tương ứng, nếu không backfill migration mất dữ liệu ---
for (const key of ['script', 'background', 'negative_video'] as PromptStepKey[]) {
  assert.ok(keys.includes(key), `thiếu bước "${key}" — migration 0018 backfill vào đây`);
}

// --- THỨ TỰ ƯU TIÊN: job thắng global, global thắng hằng mặc định ---
const withBoth = buildPromptSet(
  new Map<PromptStepKey, string>([['script', 'BAN_CUA_JOB']]),
  new Map<PromptStepKey, string>([
    ['script', 'BAN_MAC_DINH_DA_SUA'],
    ['background', 'BG_MAC_DINH_DA_SUA'],
  ])
);
assert.equal(withBoth.get('script'), 'BAN_CUA_JOB', 'bản riêng job phải thắng bản mặc định');
assert.equal(withBoth.scopeOf('script'), 'job');
assert.equal(withBoth.get('background'), 'BG_MAC_DINH_DA_SUA', 'không có bản job thì dùng bản mặc định đã sửa');
assert.equal(withBoth.scopeOf('background'), 'global');
assert.equal(withBoth.get('stage_bible'), getPromptStep('stage_bible').fallback, 'không tầng nào có thì về hằng');
assert.equal(withBoth.scopeOf('stage_bible'), 'default');

// raw() trả đúng từng tầng — ô sửa ở UI phải hiện bản của ĐÚNG tầng đang chọn, không trộn.
assert.equal(withBoth.raw('script', 'job'), 'BAN_CUA_JOB');
assert.equal(withBoth.raw('script', 'global'), 'BAN_MAC_DINH_DA_SUA');
assert.equal(withBoth.raw('background', 'job'), undefined);
assert.equal(withBoth.raw('stage_bible', 'global'), undefined);

// --- NGỮ NGHĨA CHUỖI RỖNG: row rỗng = TẮT HẲN, KHÁC với không có row = dùng mặc định ---
// Đây là ca `a || b || c` viết sai sẽ nuốt mất: negative prompt bị bật lại dù người dùng đã tắt.
const turnedOff = buildPromptSet(
  new Map<PromptStepKey, string>([['negative_video', '']]),
  new Map()
);
assert.equal(turnedOff.get('negative_video'), '', 'row rỗng phải giữ nguyên chuỗi rỗng (tắt hẳn)');
assert.equal(turnedOff.scopeOf('negative_video'), 'job', 'row rỗng vẫn là một override thật sự');
assert.notEqual(
  turnedOff.get('negative_video'),
  getPromptStep('negative_video').fallback,
  'row rỗng KHÔNG được rơi ngược về prompt mặc định'
);

// Tắt ở tầng mặc định cũng vậy, và job rỗng phải che được bản mặc định có nội dung.
const offGlobal = buildPromptSet(new Map(), new Map<PromptStepKey, string>([['negative_video', '']]));
assert.equal(offGlobal.get('negative_video'), '');
assert.equal(offGlobal.scopeOf('negative_video'), 'global');
const jobOffOverGlobal = buildPromptSet(
  new Map<PromptStepKey, string>([['negative_video', '']]),
  new Map<PromptStepKey, string>([['negative_video', 'CO_NOI_DUNG']])
);
assert.equal(jobOffOverGlobal.get('negative_video'), '', 'job tắt hẳn phải thắng bản mặc định có nội dung');

// --- Prompt lưu trong DB GIỮ NGUYÊN ${...}: registry không được tự fill params ---
const withParams = buildPromptSet(
  new Map<PromptStepKey, string>([['script', 'Bán ${ten_sanpham} trong ${thoiluong}s']]),
  new Map()
);
assert.ok(
  withParams.get('script').includes('${ten_sanpham}'),
  'registry phải trả prompt còn nguyên params — fill là việc của lúc gen, theo từng sản phẩm'
);

console.log(`✅ check-prompt-registry: OK (${PROMPT_STEPS.length} bước)`);
