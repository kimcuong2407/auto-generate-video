/**
 * Self-check: system prompt sinh kịch bản LUÔN mang contract JSON, kể cả khi Mr.D sửa prompt.
 *
 * Bug đã xảy ra: prompt override đánh rơi dòng contract → AI trả markdown "# KỊCH BẢN..." →
 * JSON.parse ném "Unexpected token '#'" và chết cả lượt gen.
 */
import assert from 'node:assert/strict';
import { ensureScriptJsonContract, SCRIPT_JSON_CONTRACT } from '../lib/livestream/scriptPrompt';
import { LIVESTREAM_SYSTEM_PROMPT } from '../lib/livestream/promptDefaults';
import { LIVESTREAM_V2_SYSTEM_PROMPT } from '../lib/livestream/promptDefaultsV2';

// Prompt tuỳ chỉnh đánh rơi contract → phải được nối lại.
const custom = 'Bạn là chuyên gia viết kịch bản livestream.\nViết thật hay vào.';
const fixed = ensureScriptJsonContract(custom);
assert.ok(fixed.includes('"segments"'), 'prompt thiếu contract phải được nối contract');
assert.ok(fixed.endsWith(SCRIPT_JSON_CONTRACT), 'contract phải nằm ở CUỐI, không bị chèn giữa');
assert.ok(fixed.startsWith(custom.trimEnd()), 'nội dung Mr.D viết phải giữ nguyên');

// Prompt mặc định V1/V2 đã có contract → không nối thêm lần hai.
for (const [name, p] of [
  ['V1', LIVESTREAM_SYSTEM_PROMPT],
  ['V2', LIVESTREAM_V2_SYSTEM_PROMPT],
] as const) {
  assert.equal(ensureScriptJsonContract(p), p, `${name}: prompt mặc định không được sửa`);
}

// Chạy 2 lần không nhân đôi contract — route generate và route preview đều gọi.
assert.equal(ensureScriptJsonContract(fixed), fixed, 'gọi lần hai không được nối thêm');

console.log('✓ check-script-json-contract: tất cả assert pass');
