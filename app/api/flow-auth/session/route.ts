import { NextRequest, NextResponse } from 'next/server';
import { upsertAccount } from '@/lib/googleFlow/authStore';
import { missingLoginCookies } from '@/lib/googleFlow/cookieCheck';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Nhận session từ Chrome extension (service worker): cookie + at/f.sid/bl (WIZ_global_data).
 * Upsert account (theo label hoặc accountId). reCAPTCHA token KHÔNG đi qua đây nữa —
 * đã chuyển sang luồng on-demand mint qua /api/flow-auth/token-request.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    accountId?: string;
    label?: string;
    cookie?: string;
    accessToken?: string | null;
    at?: string | null;
    fsid?: string | null;
    bl?: string | null;
    rpcPath?: string | null;
    origin?: string | null;
  };

  const cookie = body.cookie?.trim();
  const label = body.label?.trim();

  if (!cookie) {
    return NextResponse.json({ error: 'Thiếu cookie' }, { status: 400 });
  }
  // `at` là XSRF token bắt buộc của batchexecute — thiếu nó thì account lưu vào cũng vô dụng,
  // nên chặn ngay ở đây để extension bản cũ báo lỗi rõ thay vì ghi đè session tốt bằng
  // session không gọi được gì.
  const at = body.at?.trim();
  if (!at) {
    return NextResponse.json(
      {
        error:
          'Thiếu at token (WIZ_global_data.SNlM0e). Extension đang chạy bản cũ — cập nhật thư mục extension-flow lên bản 2.0.0 rồi Reload ở chrome://extensions.',
      },
      { status: 400 }
    );
  }

  // Cookie đăng nhập Google KHÔNG có tiền tố __Secure- (SID/HSID/APISID/SIDCC) nằm trên
  // domain cha `.google.com`. Extension bản cũ gom cookie bằng getAll({url}) nên thiếu đúng
  // nhóm này: session vẫn lưu được, at vẫn hợp lệ, nhưng mọi batchexecute trả 401 vì với
  // Google phiên là ẩn danh. Chặn tại đây để lỗi lộ ra lúc GỬI SESSION — nơi Mr.D sửa được
  // bằng cách reload extension — thay vì lúc gen video, nơi nó trông như lỗi Veo.
  const missingLogin = missingLoginCookies(cookie);
  if (missingLogin.length > 0) {
    return NextResponse.json(
      {
        error:
          `Cookie gửi lên thiếu ${missingLogin.join(', ')} — đây là cookie đăng nhập Google trên ` +
          `domain .google.com. Extension đang gom cookie theo url nên bỏ sót chúng, phiên sẽ bị ` +
          `Google coi là ẩn danh và mọi lệnh gen trả HTTP 401. Cập nhật thư mục extension-flow ` +
          `(bản có FLOW_COOKIE_DOMAINS) rồi Reload ở chrome://extensions và gửi session lại.`,
      },
      { status: 400 }
    );
  }

  const account = upsertAccount({
    id: body.accountId || undefined,
    label: label || 'Tài khoản Google Flow',
    cookie,
    accessToken: body.accessToken?.trim() || null,
    at,
    fsid: body.fsid?.trim() || null,
    bl: body.bl?.trim() || null,
    rpcPath: body.rpcPath?.trim() || null,
    origin: body.origin?.trim() || null,
    isDefault: undefined, // giữ default hiện tại khi chỉ cập nhật session
  });

  return NextResponse.json({ ok: true, accountId: account.id });
}
