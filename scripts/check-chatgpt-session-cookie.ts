/**
 * Self-check cho hasSessionCookie (lib/chatgptImage/sessionCookie.ts).
 *
 * Vì sao đáng check: đây là ranh giới duy nhất phân biệt "đã đăng nhập thật" với "chỉ mới ghé
 * chatgpt.com". Nới lỏng nhầm → app bật connected cho phiên giả, worker gen ảnh chết ở bước
 * chờ composer mà log không nói được lý do (doc mục 3).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasSessionCookie } from '../lib/chatgptImage/sessionCookie';

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

// hasProfileData: thư mục rỗng KHÔNG phải đã login. createAccount() tạo sẵn thư mục rỗng
// nên existsSync luôn đúng — dùng nhầm sẽ báo connected cho profile chưa đăng nhập bao giờ.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cgpt-check-'));
const prevCwd = process.cwd();
try {
  process.chdir(tmpRoot);
  const { createAccount, hasProfileData, profileDir } = require('../lib/chatgptImage/accountStore');
  const acc = createAccount('Test');
  assert.equal(hasProfileData(acc.id), false, 'thư mục vừa tạo còn rỗng → chưa có phiên');
  fs.writeFileSync(path.join(profileDir(acc.id), 'Local State'), '{}', 'utf-8');
  assert.equal(hasProfileData(acc.id), true, 'có file bên trong → đã có dữ liệu phiên');
  assert.equal(hasProfileData('khong-ton-tai'), false, 'thư mục không tồn tại → false, không ném lỗi');
} finally {
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('✓ check-chatgpt-session-cookie: tất cả assert pass');
