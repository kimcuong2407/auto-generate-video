import { NextRequest, NextResponse } from 'next/server';
import {
  listAccountsPublic,
  upsertAccount,
  deleteAccount,
  setDefaultAccount,
} from '@/lib/googleFlow/authStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liệt kê tài khoản (ẩn cookie/accessToken nhạy cảm). */
export async function GET() {
  return NextResponse.json({ accounts: listAccountsPublic() });
}

/** Thêm hoặc sửa tài khoản. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    label?: string;
    cookie?: string;
    accessToken?: string | null;
    isDefault?: boolean;
  };

  if (!body.label?.trim()) {
    return NextResponse.json({ error: 'Thiếu label' }, { status: 400 });
  }
  if (!body.cookie?.trim()) {
    return NextResponse.json({ error: 'Thiếu cookie' }, { status: 400 });
  }

  const account = upsertAccount({
    id: body.id || undefined,
    label: body.label.trim(),
    cookie: body.cookie.trim(),
    accessToken: body.accessToken?.trim() || null,
    isDefault: body.isDefault,
  });

  return NextResponse.json({ ok: true, account: { id: account.id, label: account.label } });
}

/** Đặt tài khoản mặc định. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: 'Thiếu id' }, { status: 400 });
  }
  const account = setDefaultAccount(body.id);
  if (!account) {
    return NextResponse.json({ error: 'Tài khoản không tồn tại' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/** Xoá tài khoản. */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: 'Thiếu id' }, { status: 400 });
  }
  const ok = deleteAccount(body.id);
  if (!ok) {
    return NextResponse.json({ error: 'Tài khoản không tồn tại' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
