import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import {
  listAccounts,
  createAccount,
  updateAccount,
  markNeedsLogin,
  profileDir,
} from '@/lib/chatgptImage/accountStore';
import { hasSessionCookie } from '@/lib/chatgptImage/sessionCookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Extension gọi cross-origin từ chrome-extension:// nên phải mở CORS như flow-auth.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Nhận session ChatGPT từ extension.
 *
 * LƯU Ý về vai trò của cookie ở đây: KHÔNG dùng để dựng lại phiên cho Playwright — ChatGPT
 * còn giữ token ở localStorage/IndexedDB và Cloudflare gắn phiên với fingerprint trình duyệt
 * (doc mục 0). Cookie chỉ để XÁC MINH tài khoản còn đăng nhập, cập nhật cờ connected cho UI.
 * Việc gen ảnh vẫn chạy trên profile Chrome ở data/chatgpt-profiles/<id>/.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    accountId?: string;
    label?: string;
    cookie?: string;
    loggedIn?: boolean;
  };

  const cookie = body.cookie?.trim() || '';
  const label = body.label?.trim() || 'Tài khoản ChatGPT';

  if (!cookie) return json({ error: 'Thiếu cookie' }, 400);

  const accounts = listAccounts();
  const account =
    (body.accountId && accounts.find((a) => a.id === body.accountId)) ||
    accounts.find((a) => a.label === label) ||
    createAccount(label);

  if (!hasSessionCookie(cookie)) {
    markNeedsLogin(account.id, 'Chưa đăng nhập ChatGPT trong Chrome (không thấy cookie session)');
    return json({ ok: false, accountId: account.id, loggedIn: false, reason: 'no-session-cookie' });
  }

  // Cookie hợp lệ nhưng profile automation chưa có thì vẫn CHƯA gen được — nói rõ ra thay vì
  // bật connected rồi để worker chết lúc chạy thật.
  const hasProfile = fs.existsSync(profileDir(account.id));
  updateAccount(account.id, {
    connected: hasProfile,
    lastError: hasProfile ? null : 'Đã đăng nhập trong Chrome nhưng chưa có profile automation',
  });

  return json({ ok: true, accountId: account.id, loggedIn: true, hasProfile });
}
