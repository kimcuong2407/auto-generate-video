/**
 * Self-check cho hasSessionCookie (app/api/chatgpt-auth/session/route.ts).
 *
 * Vì sao đáng check: đây là ranh giới duy nhất phân biệt "đã đăng nhập thật" với "chỉ mới ghé
 * chatgpt.com". Nới lỏng nhầm → app bật connected cho phiên giả, worker gen ảnh chết ở bước
 * chờ composer mà log không nói được lý do (doc mục 3).
 */
import assert from 'node:assert/strict';
import { hasSessionCookie } from '../app/api/chatgpt-auth/session/route';

// Chưa đăng nhập: ghé chatgpt.com vẫn được set cookie Cloudflare/analytics.
assert.equal(hasSessionCookie('__cf_bm=abc; _cfuvid=xyz; oai-did=123'), false, 'cookie Cloudflare không phải phiên');
assert.equal(hasSessionCookie(''), false, 'chuỗi rỗng');
assert.equal(hasSessionCookie('   '), false, 'toàn khoảng trắng');

// Đã đăng nhập: cookie phiên thật của ChatGPT.
assert.equal(
  hasSessionCookie('__cf_bm=abc; __Secure-next-auth.session-token=eyJhbGc; oai-did=123'),
  true,
  'cookie session-token của next-auth'
);
assert.equal(hasSessionCookie('__Host-next-auth.csrf-token=x; _session=abc'), true, 'tên cookie viết thường');

// Chỉ xét TÊN cookie, không xét giá trị — giá trị chứa chữ "session" là trùng hợp, không
// chứng minh gì. Bắt nhầm ở đây là kiểu dương tính giả khó lần ra nhất.
assert.equal(hasSessionCookie('oai-did=my-session-value'), false, 'chữ session nằm ở giá trị, không phải tên');

// Khoảng trắng thừa và chữ hoa vẫn phải nhận ra.
assert.equal(hasSessionCookie('  __Secure-next-auth.Session-Token = abc  '), true, 'chữ hoa + khoảng trắng thừa');

console.log('✓ check-chatgpt-session-cookie: tất cả assert pass');
