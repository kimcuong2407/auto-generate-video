/**
 * Self-check cho cách StepConfirmModal xử lý phản hồi của route confirm-step.
 *
 * Thứ dễ hỏng: modal cố tình KHÔNG đóng được bằng click nền hay nút ✕ (bỏ lửng giữa lượt chạy =
 * treo request tới hết 10 phút timeout). Quy tắc đó chỉ đúng khi cổng CÒN SỐNG. Khi server trả
 * 409 — cổng đã chết vì hết giờ, F5, hoặc hot-reload ở next dev — thì không còn request nào để
 * treo, mà modal vẫn ở lại với hai nút bấm gì cũng ra đúng lỗi đó: Mr.D kẹt cứng, chỉ còn F5.
 *
 * Nên hai nhánh phải đi NGƯỢC nhau, và đây là chỗ duy nhất giữ ràng buộc ấy:
 *   - 409          → đóng modal (onDecided) + báo ra ngoài (onGateLost)
 *   - lỗi khác     → GIỮ modal, hiện lỗi tại chỗ để bấm lại (VD 500 chớp nhoáng, mạng lỗi)
 *
 * Mô phỏng đúng thân hàm decide() thay vì import: file kia là client component (JSX + 'use client'
 * + alias @/), tsx chạy trực tiếp sẽ vỡ. Đổi lại phải chốt bằng assert #4/#5 rằng source thật vẫn
 * còn nhánh 409 — nếu ai xoá nó đi, mô phỏng ở đây sẽ không còn phản ánh code thật.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MODAL = 'components/livestream/StepConfirmModal.tsx';

interface DecideResult {
  closed: boolean;
  errorShown: string | null;
  gateLostMessage: string | null;
}

/** Bản sao thân decide() của StepConfirmModal — giữ khớp với source (xem assert #4/#5). */
function decide(res: { ok: boolean; status: number; body: { error?: string } }): DecideResult {
  const out: DecideResult = { closed: false, errorShown: null, gateLostMessage: null };
  if (!res.ok) {
    if (res.status === 409) {
      out.gateLostMessage =
        res.body.error || 'Lượt chạy đã dừng nên bước này không duyệt được nữa. Hãy bấm sinh lại.';
      out.closed = true;
      return out;
    }
    out.errorShown = res.body.error || `HTTP ${res.status}`;
    return out;
  }
  out.closed = true;
  return out;
}

// 1. Cổng đã chết → modal PHẢI đóng, nếu không Mr.D kẹt cứng phải F5 (đúng bug đã gặp).
const gone = decide({
  ok: false,
  status: 409,
  body: { error: 'Bước này không còn chờ duyệt (đã hết giờ hoặc lượt chạy đã dừng). Hãy chạy lại.' },
});
assert.equal(gone.closed, true, '409 phải đóng modal — giữ lại là kẹt cứng, bấm gì cũng ra 409');
assert.equal(gone.errorShown, null, '409 không hiện lỗi trong modal (modal đã đóng, không ai đọc)');
assert.match(
  gone.gateLostMessage ?? '',
  /chạy lại|sinh lại/i,
  '409 phải báo ra ngoài kèm hướng dẫn chạy lại — biến mất im lặng trông như bước đã chạy xong'
);

// 2. Lỗi KHÁC 409 → cổng có thể vẫn sống, phải GIỮ modal để bấm lại. Đóng ở đây là bỏ lửng thật:
//    request treo tới hết 10 phút timeout.
const flaky = decide({ ok: false, status: 500, body: { error: 'DB rớt' } });
assert.equal(flaky.closed, false, 'lỗi 5xx phải GIỮ modal — cổng còn sống, đóng là treo request');
assert.equal(flaky.errorShown, 'DB rớt', 'lỗi 5xx hiện tại chỗ để bấm lại');
assert.equal(flaky.gateLostMessage, null, 'lỗi 5xx không phải mất cổng');

// 3. Duyệt thành công → đóng modal, không lỗi.
const ok = decide({ ok: true, status: 200, body: {} });
assert.equal(ok.closed, true, 'duyệt thành công phải đóng modal');
assert.equal(ok.errorShown, null, 'duyệt thành công không có lỗi');
assert.equal(ok.gateLostMessage, null, 'duyệt thành công không phải mất cổng');

// 4+5. Chốt rằng mô phỏng trên vẫn phản ánh source thật: xoá nhánh 409 khỏi modal thì check này
//      phải đỏ, chứ không phải vẫn xanh vì bản sao ở đây còn nguyên.
const modalSrc = fs.readFileSync(path.join(ROOT, MODAL), 'utf8');
assert.match(
  modalSrc,
  /res\.status === 409/,
  `${MODAL} không còn nhánh 409 — modal sẽ kẹt cứng lại như bug cũ`
);
assert.match(
  modalSrc,
  /onGateLost/,
  `${MODAL} không còn onGateLost — cổng chết sẽ biến mất im lặng, Mr.D tưởng bước đã chạy`
);

console.log(
  '✅ check-step-confirm-gate: 409 đóng modal + báo ra ngoài; lỗi khác giữ modal để bấm lại.'
);
