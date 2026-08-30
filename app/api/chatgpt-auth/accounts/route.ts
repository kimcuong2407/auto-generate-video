import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import {
  listAccounts,
  updateAccount,
  deleteAccount,
  profileDir,
} from '@/lib/chatgptImage/accountStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liệt kê tài khoản ChatGPT. Kèm hasProfile đọc từ đĩa THẬT chứ không tin cờ connected:
 * deploy sang VPS mới mà quên copy thư mục profile là trường hợp hay gặp nhất, lúc đó
 * accounts.json vẫn nói connected nhưng gen ảnh sẽ chết ngay.
 */
export async function GET() {
  const accounts = listAccounts().map((a) => ({
    ...a,
    hasProfile: fs.existsSync(profileDir(a.id)),
  }));
  return NextResponse.json({ accounts });
}

/** Đổi nhãn / đặt mặc định. Không tạo account ở đây — tạo qua `npm run chatgpt:login`. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    label?: string;
    isDefault?: boolean;
  };
  if (!body.id) return NextResponse.json({ error: 'Thiếu id' }, { status: 400 });

  const account = updateAccount(body.id, {
    ...(body.label !== undefined ? { label: body.label.trim() } : {}),
    ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
  });
  if (!account) return NextResponse.json({ error: 'Không tìm thấy tài khoản' }, { status: 404 });
  return NextResponse.json({ account });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Thiếu id' }, { status: 400 });
  const ok = deleteAccount(id);
  if (!ok) return NextResponse.json({ error: 'Không tìm thấy tài khoản' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
