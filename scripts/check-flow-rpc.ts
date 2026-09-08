/**
 * Self-check cho flowRpc.ts — hình dạng payload + đọc response batchexecute.
 *
 * Vì sao cần: payload Google Flow là MẢNG LỒNG không tên trường, mọi thứ định vị bằng chỉ số
 * đọc từ HAR. Lệch một vị trí thì Google trả lỗi chung chung (hoặc tệ hơn: nhận nhưng gen sai)
 * và không có gì trong code chỉ ra chỗ hỏng. Các assert dưới đây khoá đúng những chỉ số đã
 * xác minh trong docs/flow.google.com.har (2026-09-08).
 *
 * Chạy: npx tsx scripts/check-flow-rpc.ts
 */
import assert from 'node:assert/strict';
import { __testables } from '../lib/googleFlow/flowRpc';

const { at, buildScene, clientContext, STATE_RUNNING, STATE_DONE } = __testables;

// ---------------------------------------------------------------
// 1. at(): đọc mảng lồng an toàn.
// ---------------------------------------------------------------
assert.equal(at([[1, 2], [3, 4]], [1, 0]), 3);
assert.equal(at([1, [2, [3, 'x']]], [1, 1, 1]), 'x');
// Đường dẫn vượt biên phải trả null, KHÔNG được ném — Google đổi layout thì lỗi phải nói rõ
// "không tìm thấy", chứ không phải TypeError ở giữa module.
assert.equal(at([1, 2], [9]), null);
assert.equal(at(null, [0]), null);
assert.equal(at('không phải mảng', [0]), null);

// ---------------------------------------------------------------
// 2. clientContext: vị trí projectId và reCAPTCHA token.
// HAR: [null,22,null,null,null,"<projectId>",null,null,null,null,["<token>",1]]
// ---------------------------------------------------------------
const ctx = clientContext('proj-1', 'token-abc');
assert.equal(ctx[1], 22, 'mã tool phải ở [1]');
assert.equal(ctx[5], 'proj-1', 'projectId phải ở [5]');
assert.deepEqual(ctx[10], ['token-abc', 1], 'reCAPTCHA token phải ở [10][0]');
assert.equal(ctx.length, 11, 'độ dài clientContext đổi = Google đã đổi layout');

// ---------------------------------------------------------------
// 3. buildScene: prompt lồng 3 lớp, model key, ảnh đầu.
// HAR: [[null,null,[[["<prompt>"]]]], "<model>", 1, null, [null,"<mediaId>",...], [...]]
// ---------------------------------------------------------------
const scene = buildScene({ prompt: 'xin chào', modelKey: 'veo_3_1_i2v_lite', startMediaId: 'media-9' });
assert.equal(at(scene, [0, 2, 0, 0, 0]), 'xin chào', 'prompt phải lồng đúng 3 lớp mảng');
assert.equal(scene[1], 'veo_3_1_i2v_lite');
assert.equal(at(scene, [4, 1]), 'media-9', 'mediaId ảnh đầu phải ở [4][1]');

// t2v (không ảnh đầu) → slot ảnh phải là null, không phải mảng rỗng: trang thật gửi null,
// và mảng rỗng ở vị trí này từng là kiểu lỗi Google im lặng bỏ qua prompt.
const t2v = buildScene({ prompt: 'p', modelKey: 'veo_3_1_t2v_fast' });
assert.equal(t2v[4], null, 'scene không ảnh đầu phải để null ở [4]');

// Hai scene liên tiếp phải có tracking uuid KHÁC nhau — trùng uuid là Google coi như trùng lặp.
const a = buildScene({ prompt: 'p', modelKey: 'm' });
const b = buildScene({ prompt: 'p', modelKey: 'm' });
assert.notEqual(at(a, [5, 4]), at(b, [5, 4]), 'mỗi scene phải có uuid riêng');

// ---------------------------------------------------------------
// 4. Mã trạng thái poll: 2 = đang chạy, 3 = xong (xác minh trên job b5b1f743 trong HAR).
// ---------------------------------------------------------------
assert.equal(STATE_RUNNING, 2);
assert.equal(STATE_DONE, 3);
assert.notEqual(STATE_RUNNING, STATE_DONE);

console.log('check-flow-rpc: OK');
