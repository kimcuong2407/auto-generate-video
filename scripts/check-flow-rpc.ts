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

const {
  at,
  buildScene,
  clientContext,
  mapJobState,
  jobStatusOf,
  buildPollPayload,
  STATE_QUEUED,
  STATE_RUNNING,
  STATE_DONE,
  STATE_ERROR,
} = __testables;

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
// 3b. Payload poll: mỗi operationId nằm trong MẢNG RIÊNG.
// HAR 2026-09-09: [null,null,[["1e583222-…"],["6730c9c7-…"]]] cho 2 job.
// Bug cũ gửi [[id1,id2]] — trùng khớp tình cờ với 1 job nên ẩn cho tới khi poll nhiều job.
// ---------------------------------------------------------------
assert.deepEqual(buildPollPayload(['a', 'b']), [null, null, [['a'], ['b']]], 'mỗi id một mảng riêng');
assert.deepEqual(buildPollPayload(['a']), [null, null, [['a']]]);

// ---------------------------------------------------------------
// 4. Mã trạng thái poll — XÁC MINH HAR 2026-09-09 (12 lần poll, 2 job):
//    j[5][8] = [6] vừa nhận → [2] đang render → [3] xong.
//    j[5][8] = [4, [null,"Media not found."], ["Media not found."]] khi lỗi.
// ---------------------------------------------------------------
assert.equal(STATE_QUEUED, 6);
assert.equal(STATE_RUNNING, 2);
assert.equal(STATE_DONE, 3);
assert.equal(STATE_ERROR, 4);

// --- State là MẢNG, không phải số trần. Đây chính là bug đã lọt qua bộ check cũ:
// check cũ chỉ gọi mapJobState(3) (số trần) nên luôn xanh, trong khi Google gửi [3] và code
// so sánh `=== 3` không bao giờ khớp → MỌI job đều báo 'running' tới hết timeout.
{
  assert.equal(mapJobState([STATE_DONE]), 'done', 'Google gửi [3] — phải nhận là done');
  assert.equal(mapJobState([STATE_RUNNING]), 'running');
  assert.equal(mapJobState([STATE_QUEUED]), 'running', 'state 6 (vừa nhận) là đang chạy');
  assert.equal(
    mapJobState([STATE_ERROR, [null, 'Media not found.'], ['Media not found.']]),
    'error',
    'state 4 PHẢI là lỗi'
  );

  // Vẫn nhận số trần: nếu Google đổi lại thì không vỡ.
  assert.equal(mapJobState(STATE_DONE), 'done');
  assert.equal(mapJobState(STATE_ERROR), 'error');

  // Mã CHƯA từng quan sát vẫn coi là đang chạy: đoán nhầm mã lạ thành lỗi sẽ giết job
  // đang render bình thường (thiệt hại nặng hơn nhiều so với chờ thừa vài vòng poll).
  for (const unknownState of [0, 1, 5, 99, null, undefined, 'x', [], [7]]) {
    assert.equal(mapJobState(unknownState), 'running', `state lạ ${JSON.stringify(unknownState)} phải coi là running`);
  }
}

// --- Lỗi TẠM THỜI vs lỗi thật, đọc từ response thô THẬT của Google.
//
// Bằng chứng HAR 2026-09-09: job 6730c9c7 trả state 4 "Media not found." ở lần poll ĐẦU
// (5s sau khi gen), lần poll thứ hai đã là [2] rồi render xong. Nên "Media not found." ngay
// sau khi gen là race mediaId chưa propagate, KHÔNG phải job chết — giết nó là mất một video
// đang render tốt.
{
  const jobWith = (state8: unknown) =>
    ['6730c9c7', 'proj', 'x', null, null, [null, null, null, null, null, null, null, null, state8]];

  const transient = jobStatusOf(jobWith([4, [null, 'Media not found.'], ['Media not found.']]));
  assert.equal(transient.state, 'error');
  assert.equal(transient.error, 'Media not found.', 'phải rút được mô tả lỗi để báo cho người dùng');
  assert.equal(transient.transient, true, '"Media not found." là lỗi TẠM THỜI — phải poll tiếp');

  const hard = jobStatusOf(jobWith([4, [13, 'PERMISSION_DENIED'], ['PERMISSION_DENIED']]));
  assert.equal(hard.state, 'error');
  assert.equal(hard.transient, false, 'lỗi chưa biết KHÔNG được coi là tạm thời — treo tới timeout còn tệ hơn');

  const ok = jobStatusOf(jobWith([2]));
  assert.deepEqual(ok, { state: 'running', error: null, transient: false });

  assert.equal(at(jobWith([3]), [5, 8, 0]), 3, 'state phải đọc được tại [5][8][0]');
  assert.equal(jobErrorReason(['id', 'p']), null, 'job không có lỗi thì trả null, không crash');
}

console.log('check-flow-rpc: OK');
