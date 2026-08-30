/**
 * Self-check cho isResultImage() + buildPrompt() + readPageState() ở lib/chatgptImage/domScript.ts.
 *
 * Vì sao cần: đây là logic hỏng ÂM THẦM nhất trong cả luồng. Nếu bộ lọc lọt 1 ảnh sai, app
 * lưu avatar / ảnh ref user vừa upload / ảnh của lượt chat TRƯỚC làm kết quả gen — và không
 * có lỗi nào được ném ra. Ảnh sai đó rồi được nạp làm khung hình khởi điểm gen video, tốn
 * tiền Veo cho một cảnh sai hoàn toàn.
 *
 * Chạy: npx tsx scripts/check-chatgpt-image-filter.ts
 */
import assert from 'node:assert/strict';
import { __testables } from '../lib/chatgptImage/domScript';

const { isResultImage, buildPrompt, readPageState } = __testables;

/** Ảnh kết quả hợp lệ điển hình — mọi case khác là biến thể của nó. */
const valid = {
  src: 'https://files.oaiusercontent.com/file-abc123',
  naturalWidth: 1024,
  naturalHeight: 1792,
  inAssistantTurn: true,
  afterCurrentUserTurn: true,
};

// 1. Ảnh hợp lệ phải lọt.
assert.equal(isResultImage(valid), true, 'ảnh kết quả thật bị loại oan');

// 2. blob: và data:image cũng là dạng src hợp lệ ChatGPT hay dùng.
assert.equal(isResultImage({ ...valid, src: 'blob:https://chatgpt.com/abc-123' }), true);
assert.equal(isResultImage({ ...valid, src: 'data:image/png;base64,iVBORw0KGgo=' }), true);
assert.equal(
  isResultImage({ ...valid, src: 'https://chatgpt.com/backend-api/files/file-x' }),
  true
);

// 3. Ảnh do USER vừa đính kèm — nằm trong lượt user, KHÔNG phải kết quả gen.
// Đây là case nguy hiểm nhất: ảnh ref cũng to, cũng đúng domain, chỉ khác ở role.
assert.equal(
  isResultImage({ ...valid, inAssistantTurn: false }),
  false,
  'ảnh ref user upload bị nhận nhầm thành ảnh kết quả'
);

// 4. Ảnh của lượt chat TRƯỚC — đúng role assistant nhưng nằm trước mốc user turn hiện tại.
assert.equal(
  isResultImage({ ...valid, afterCurrentUserTurn: false }),
  false,
  'ảnh lượt chat cũ bị nhận nhầm thành ảnh vừa gen'
);

// 5. Avatar/icon nhỏ bị loại theo kích thước.
assert.equal(isResultImage({ ...valid, naturalWidth: 64, naturalHeight: 64 }), false);
// Đúng ngưỡng 256 vẫn loại (điều kiện là > 256, không phải >=).
assert.equal(isResultImage({ ...valid, naturalWidth: 256, naturalHeight: 256 }), false);
assert.equal(isResultImage({ ...valid, naturalWidth: 257, naturalHeight: 257 }), true);
// Ảnh rộng nhưng dẹt (banner) — chiều nào nhỏ cũng loại.
assert.equal(isResultImage({ ...valid, naturalHeight: 100 }), false);

// 6. Avatar TO nằm đúng lượt assistant — chỉ tên trong URL cứu được. Kích thước không đủ lọc.
assert.equal(
  isResultImage({ ...valid, src: 'https://cdn.oaiusercontent.com/avatar/user-big.png' }),
  false,
  'avatar cỡ lớn lọt qua bộ lọc'
);
for (const bad of ['favicon', 'profile', 'emoji', 'icon', 'sprite']) {
  assert.equal(
    isResultImage({ ...valid, src: `https://files.oaiusercontent.com/${bad}-x.png` }),
    false,
    `ảnh chứa "${bad}" trong URL lọt qua bộ lọc`
  );
}

// 7. src lạ không khớp pattern nào (VD ảnh quảng cáo bên thứ ba) → loại.
assert.equal(isResultImage({ ...valid, src: 'https://example.com/random.png' }), false);
assert.equal(isResultImage({ ...valid, src: '' }), false);

// 8. buildPrompt: câu "không hỏi lại" là BẮT BUỘC — thiếu nó ChatGPT hay hỏi làm rõ thay vì
// vẽ, và lượt đó trôi hết timeout mà không ra ảnh nào.
const p1 = buildPrompt({ prompt: 'ly cà phê', aspect: '9:16', hasRefImages: false });
assert.ok(p1.includes('9:16'), 'prompt thiếu tỉ lệ khung hình');
assert.ok(p1.includes('Chỉ trả về ảnh, không hỏi lại'), 'prompt thiếu câu chặn ChatGPT hỏi lại');
assert.ok(p1.includes('ly cà phê'), 'prompt gốc của người dùng bị mất');
assert.ok(!p1.includes('tham chiếu'), 'không có ref mà vẫn nhắc ảnh tham chiếu');

const p2 = buildPrompt({ prompt: 'ly cà phê', aspect: '16:9', hasRefImages: true });
assert.ok(p2.includes('tham chiếu'), 'có ref nhưng prompt không nhắc ChatGPT dùng');
assert.ok(p2.includes('16:9'));

// 9. readPageState: chạy được nhờ stub DOM tối thiểu (hàm chỉ đụng querySelector + body.innerText).
function withDom(html: { hasComposer: boolean; bodyText: string; hasLoginButton?: boolean }) {
  (globalThis as Record<string, unknown>).document = {
    querySelector: (sel: string) => {
      if (sel.includes('prompt-textarea')) return html.hasComposer ? {} : null;
      if (sel.includes('login-button')) return html.hasLoginButton ? {} : null;
      return null;
    },
    body: { innerText: html.bodyText },
  };
}

withDom({ hasComposer: true, bodyText: 'xin chào' });
assert.equal(readPageState('#prompt-textarea'), 'ready');

// Trang login: KHÔNG được trả 'ready' — nhận nhầm sẽ lưu phiên giả rồi chết ở lần gen đầu.
withDom({ hasComposer: false, bodyText: 'Welcome back', hasLoginButton: true });
assert.equal(readPageState('#prompt-textarea'), 'login');
withDom({ hasComposer: false, bodyText: 'Log in to continue' });
assert.equal(readPageState('#prompt-textarea'), 'login');

// Trang đang load: chưa có composer, cũng chưa có dấu hiệu login → phải chờ tiếp, không kết luận.
withDom({ hasComposer: false, bodyText: '' });
assert.equal(readPageState('#prompt-textarea'), 'pending');

console.log('✓ check-chatgpt-image-filter: tất cả assert đã pass');
