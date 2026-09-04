/**
 * Self-check cho logic thu session của extension (extension-flow/background.js →
 * collectSessionInMainWorld).
 *
 * Vì sao cần: Google gỡ /fx/api/auth/session + Bearer token (2026-09), extension chuyển
 * sang đọc window.WIZ_global_data. Đọc sai tên key là extension câm lặng "collect thất bại"
 * — đúng lỗi đã tốn nhiều lượt debug với cơ chế cũ.
 *
 * Check này giữ bản sao logic thuần (không cần Chrome) và assert nó bóc đúng key. Bản sao
 * PHẢI khớp background.js — sửa 1 chỗ là sửa cả 2.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

interface Wiz {
  SNlM0e?: string;
  FdrFJe?: string;
  cfb2h?: string;
  Im6cmf?: string;
}

/** Bản sao logic trong background.js (đã bỏ phần phụ thuộc window/document). */
function collect(w: Wiz | null | undefined, href: string) {
  if (!w || typeof w !== 'object') return { error: 'không thấy WIZ_global_data tại ' + href };
  const at = w.SNlM0e;
  if (!at) return { error: 'thiếu SNlM0e (at token) — chưa đăng nhập' };
  const missing: string[] = [];
  if (!w.FdrFJe) missing.push('FdrFJe (f.sid)');
  if (!w.cfb2h) missing.push('cfb2h (bl)');
  if (!w.Im6cmf) missing.push('Im6cmf (rpc path)');
  return {
    at,
    fsid: w.FdrFJe || null,
    bl: w.cfb2h || null,
    rpcPath: w.Im6cmf || '/_/AiSandboxAngularFrontend',
    warning: missing.length ? 'Thiếu key phụ: ' + missing.join(', ') : undefined,
  };
}

// --- 1. Giá trị THẬT lấy từ WIZ_global_data trong docs/flow.google.com.har (2026-09-04).
{
  const real: Wiz = {
    SNlM0e: 'AIQ-s5g7UY1Ti5MuVdIF2DYTK1p9:1788527226315',
    FdrFJe: '4611544007278570669',
    cfb2h: 'boq_labs-ai-sandbox-frontend_20260902.11_p4',
    Im6cmf: '/_/AiSandboxAngularFrontend',
  };
  const out = collect(real, 'https://flow.google.com/project/x') as Record<string, unknown>;
  assert.equal(out.at, 'AIQ-s5g7UY1Ti5MuVdIF2DYTK1p9:1788527226315');
  assert.equal(out.fsid, '4611544007278570669');
  assert.equal(out.bl, 'boq_labs-ai-sandbox-frontend_20260902.11_p4');
  assert.equal(out.rpcPath, '/_/AiSandboxAngularFrontend');
  assert.equal(out.warning, undefined, 'dữ liệu đầy đủ thì không cảnh báo');
  assert.equal(out.error, undefined);
}

// --- 2. Chưa đăng nhập (không có SNlM0e) → báo lỗi, KHÔNG trả session rỗng.
{
  const out = collect({ FdrFJe: '1', cfb2h: 'b' }, 'https://flow.google.com/') as Record<string, unknown>;
  assert.match(String(out.error), /SNlM0e/, 'thiếu at phải báo đích danh key');
  assert.equal(out.at, undefined, 'không được trả at rỗng cho server');
}

// --- 3. Trang chưa load xong / không phải Flow → báo lỗi rõ.
{
  assert.match(String((collect(null, 'https://x/') as Record<string, unknown>).error), /WIZ_global_data/);
}

// --- 4. Thiếu key PHỤ vẫn phải gửi được (chỉ cảnh báo): Google hay đổi tên key phụ,
//        chặn cứng ở đây là tự khoá mình ra ngoài dù at + cookie vẫn dùng tốt.
{
  const out = collect({ SNlM0e: 'at-token' }, 'https://flow.google.com/') as Record<string, unknown>;
  assert.equal(out.at, 'at-token');
  assert.equal(out.error, undefined, 'thiếu key phụ KHÔNG được coi là lỗi chặn');
  assert.match(String(out.warning), /FdrFJe/);
  assert.equal(out.rpcPath, '/_/AiSandboxAngularFrontend', 'phải có mặc định cho rpcPath');
}

// --- 5. background.js thật phải còn đọc đúng 4 key này (chống drift giữa bản sao và bản thật).
{
  const bg = fs.readFileSync(path.join(process.cwd(), 'extension-flow', 'background.js'), 'utf8');
  for (const key of ['SNlM0e', 'FdrFJe', 'cfb2h', 'Im6cmf', 'WIZ_global_data']) {
    assert.ok(bg.includes(key), `background.js phải đọc ${key} — bản sao logic đã lệch bản thật`);
  }
  // Chỉ cấm GỌI endpoint đã chết; nhắc tên nó trong comment lịch sử là hợp lệ và hữu ích.
  const codeOnly = bg.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/fx\/api\/auth\/session/.test(codeOnly),
    'background.js không được GỌI /fx/api/auth/session (Google đã gỡ endpoint này)'
  );
  assert.ok(!/aisandbox-pa/.test(codeOnly), 'không được gọi host aisandbox-pa đã chết');
}

console.log('check-flow-session-discovery: OK');
