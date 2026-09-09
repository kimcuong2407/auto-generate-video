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
import { jobErrorReason, __testables } from '../lib/googleFlow/flowRpc';

const { at, buildScene, clientContext, mapJobState, STATE_RUNNING, STATE_DONE, STATE_ERROR } = __testables;

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

// --- map trạng thái job: state 4 = LỖI, không phải 'đang chạy'.
//
// Bug thật 2026-09-09: mọi state != 3 bị map thành 'running', nên job Google đã báo hỏng
// (state 4, [13,"NOT_FOUND"]) vẫn hiện là đang render. App chờ hết timeout mới bỏ cuộc,
// người dùng bấm gen lại — lặp 17 lần mà không ai biết Google đã từ chối ngay từ đầu.
{
  assert.equal(mapJobState(STATE_DONE), 'done');
  assert.equal(mapJobState(STATE_RUNNING), 'running');
  assert.equal(mapJobState(STATE_ERROR), 'error', 'state 4 PHẢI là lỗi — đây là bug đã xảy ra thật');
  assert.equal(STATE_ERROR, 4, 'state lỗi quan sát được từ Google là 4');

  // Mã CHƯA từng quan sát vẫn coi là đang chạy: đoán nhầm mã lạ thành lỗi sẽ giết job
  // đang render bình thường (thiệt hại nặng hơn nhiều so với chờ thừa vài vòng poll).
  for (const unknownState of [0, 1, 5, 99, null, undefined, 'x']) {
    assert.equal(mapJobState(unknownState), 'running', `state lạ ${unknownState} phải coi là running`);
  }
}

// --- Đọc lý do lỗi từ response thô THẬT của Google.
{
  // Cắt từ response thật: j[5][8] = [4, [13, "NOT_FOUND"], ["NOT_FOUND"]]
  const job = ['id-1', 'proj', 'x', 'CAE', null, [null, null, null, null, null, null, null, null,
    [4, [13, 'NOT_FOUND'], ['NOT_FOUND']]]];
  assert.equal(at(job, [5, 8, 0]), 4, 'state phải đọc được tại [5][8][0]');
  assert.equal(jobErrorReason(job), 'NOT_FOUND', 'phải rút được tên lỗi để báo cho người dùng');
  assert.equal(jobErrorReason(['id', 'p']), null, 'job không có lỗi thì trả null, không crash');
}

console.log('check-flow-rpc: OK');
