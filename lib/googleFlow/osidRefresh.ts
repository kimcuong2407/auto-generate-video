/**
 * Làm mới OSID + `at` cho flow.google.com bằng chính chu trình redirect của Google.
 *
 * VẤN ĐỀ (xác minh 2026-09-09): `OSID` là cookie phiên RIÊNG cho từng service Google, hạn
 * ngắn hơn nhiều so với `SID`/`__Secure-1PSID`. Trình duyệt làm mới nó ngầm qua chuỗi
 * redirect mỗi khi vào lại trang; bản sao cookie ta lưu thì đứng yên, nên sau vài giờ
 * flow.google.com trả 302 → ServiceLogin và MỌI batchexecute trả 401.
 *
 * Triệu chứng cực dễ chẩn đoán nhầm: tài khoản Google vẫn đăng nhập tốt (www.google.com và
 * labs.google/fx đều nhận), gửi lại session từ extension cũng không giúp gì vì extension chỉ
 * copy lại đúng OSID đã hết hạn đó. Nhìn từ ngoài y hệt "cookie hết hạn".
 *
 * CÁCH CHỮA: đi trọn chu trình Google dùng cho chính việc này —
 *   GET flow.google.com  → 302 accounts.google.com/ServiceLogin?osid=1
 *                        → 302 flow.google.com/accounts/SetOSID?osidt=…
 *                        → 200 flow.google.com/?pli=1   (Set-Cookie: OSID mới, HTML có SNlM0e)
 * Chu trình này KHÔNG cần nhập mật khẩu: nó dựa trên SID/HSID/APISID vẫn còn hiệu lực, nên
 * chỉ chạy được khi phiên Google gốc còn sống — nếu đã đăng xuất thật, redirect dẫn tới trang
 * signin và hàm này báo lỗi đúng bản chất.
 */

import { FlowApiError } from './errors';

/** Cookie jar tối giản: chỉ cần name→value vì mọi request đều về cùng một site. */
class CookieJar {
  private jar = new Map<string, string>();

  constructor(header: string) {
    for (const part of header.split(';')) {
      const s = part.trim();
      if (!s) continue;
      const i = s.indexOf('=');
      if (i > 0) this.jar.set(s.slice(0, i), s.slice(i + 1));
    }
  }

  header(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Nuốt Set-Cookie của 1 response. Bỏ qua thuộc tính (Path/Expires…) — chỉ giữ name=value. */
  absorb(res: Response): void {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const first = sc.split(';')[0];
      const i = first.indexOf('=');
      if (i <= 0) continue;
      const name = first.slice(0, i).trim();
      const value = first.slice(i + 1);
      // Google xoá cookie bằng cách set giá trị rỗng/EXPIRED — tôn trọng để không giữ rác.
      if (!value || value === 'EXPIRED') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  get(name: string): string | null {
    return this.jar.get(name) ?? null;
  }
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Số redirect tối đa. Chu trình thật dùng 3 hop; 10 là dư mà vẫn chặn được vòng lặp vô hạn. */
const MAX_HOPS = 10;

export interface OsidRefreshResult {
  /** Cookie header mới (đã gồm OSID tươi) — ghi đè vào account. */
  cookie: string;
  /** `at` (SNlM0e) đọc từ HTML trang đã đăng nhập. */
  at: string;
  /** bl (cfb2h) và fsid (FdrFJe) mới nếu trang có — Google đổi bl vài ngày/lần. */
  bl: string | null;
  fsid: string | null;
}

/** Rút một key trong WIZ_global_data khỏi HTML. */
function wizValue(html: string, key: string): string | null {
  const m = html.match(new RegExp(`"${key}":"([^"]+)"`));
  return m ? m[1] : null;
}

/**
 * Chạy chu trình làm mới OSID.
 *
 * @param cookieHeader cookie hiện có (phải còn SID/HSID/APISID hợp lệ).
 * @throws FlowApiError(401) khi chu trình dẫn tới trang đăng nhập — phiên Google đã chết thật.
 */
export async function refreshOsid(cookieHeader: string, origin = 'https://flow.google.com'): Promise<OsidRefreshResult> {
  const jar = new CookieJar(cookieHeader);
  let url = `${origin}/`;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetch(url, {
      headers: { Cookie: jar.header(), 'User-Agent': UA },
      redirect: 'manual',
    });
    jar.absorb(res);

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, url).toString();
      // Trang nhập tài khoản/mật khẩu = phiên Google đã chết, redirect thêm cũng vô ích.
      if (/\/v3\/signin\/|\/signin\/identifier|ServiceLogin\?.*\bpassive=false/.test(next)) {
        throw new FlowApiError(
          'Phiên Google đã đăng xuất thật sự (chu trình làm mới dẫn tới trang đăng nhập). ' +
            'Đăng nhập lại Google trong trình duyệt rồi gửi session từ extension.',
          401
        );
      }
      url = next;
      continue;
    }

    if (!res.ok) {
      throw new FlowApiError(`Làm mới OSID thất bại: ${url} trả HTTP ${res.status}`, res.status);
    }

    const html = await res.text();
    const at = wizValue(html, 'SNlM0e');
    if (!at) {
      throw new FlowApiError(
        'Làm mới OSID: trang trả về không có SNlM0e (vẫn là trang ẩn danh). ' +
          'Nhiều khả năng cookie đăng nhập Google đã hết hiệu lực — gửi lại session từ extension.',
        401
      );
    }
    return {
      cookie: jar.header(),
      at,
      bl: wizValue(html, 'cfb2h'),
      fsid: wizValue(html, 'FdrFJe'),
    };
  }

  throw new FlowApiError(`Làm mới OSID: quá ${MAX_HOPS} lần chuyển hướng, có thể Google đổi luồng đăng nhập.`);
}

/** Chỉ dùng cho scripts/check-osid-refresh.ts. */
export const __testables = { CookieJar, wizValue };
