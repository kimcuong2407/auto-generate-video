import { NextRequest, NextResponse } from 'next/server';
import { upsertAccount } from '@/lib/googleFlow/authStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Nhận session từ Chrome extension (service worker): cookie + access_token.
 * Upsert account (theo label hoặc accountId). reCAPTCHA token KHÔNG đi qua đây nữa —
 * đã chuyển sang luồng on-demand mint qua /api/flow-auth/token-request.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    accountId?: string;
    label?: string;
    cookie?: string;
    accessToken?: string | null;
  };

  const cookie = body.cookie?.trim();
  const label = body.label?.trim();

  if (!cookie) {
    return NextResponse.json({ error: 'Thiếu cookie' }, { status: 400 });
  }

  const account = upsertAccount({
    id: body.accountId || undefined,
    label: label || 'Tài khoản Google Flow',
    cookie,
    accessToken: body.accessToken?.trim() || null,
    isDefault: undefined, // giữ default hiện tại khi chỉ cập nhật session
  });

  return NextResponse.json({ ok: true, accountId: account.id });
}
