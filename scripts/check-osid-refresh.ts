/**
 * Self-check cho chu trình làm mới OSID (lib/googleFlow/osidRefresh.ts).
 *
 * Vì sao cần: OSID hết hạn là nguyên nhân THẬT của 401 mà cả hai lần chẩn đoán trước đều
 * đoán nhầm thành "cookie hết hạn" (tài khoản vẫn đăng nhập tốt ở www.google.com và
 * labs.google — chỉ riêng flow.google.com trả 302 ServiceLogin). Logic ở đây chạy ngầm khi
 * gặp 401, hỏng thì lại rơi về đúng triệu chứng khó chẩn đoán cũ.
 *
 * Chạy offline hoàn toàn: fetch bị thay bằng stub mô phỏng đúng chuỗi redirect quan sát được
 * (flow → ServiceLogin → SetOSID → 200 kèm SNlM0e).
 */
import assert from 'node:assert/strict';
import { refreshOsid, __testables } from '../lib/googleFlow/osidRefresh';
import { FlowApiError } from '../lib/googleFlow/errors';

const { CookieJar, wizValue } = __testables;

// --- CookieJar: parse, absorb, xoá cookie hết hạn.
{
  const jar = new CookieJar('SID=a; HSID=b; OSID=old');
  assert.equal(jar.get('OSID'), 'old');

  const res = new Response('', {
    headers: [
      ['set-cookie', 'OSID=new; Path=/; Secure; HttpOnly'],
      ['set-cookie', 'SIDCC=fresh; Path=/'],
    ],
  });
  jar.absorb(res);
  assert.equal(jar.get('OSID'), 'new', 'Set-Cookie phải ghi đè cookie cũ');
  assert.equal(jar.get('SIDCC'), 'fresh', 'cookie mới phải được thêm');
  assert.equal(jar.get('SID'), 'a', 'cookie không liên quan phải giữ nguyên');

  // Giá trị chứa dấu '=' (base64) không được cắt cụt.
  const jar2 = new CookieJar('X=YWJj=='); 
  assert.equal(jar2.get('X'), 'YWJj==', "giá trị cookie chứa '=' phải giữ nguyên");
}

// --- Google xoá cookie bằng giá trị rỗng → jar phải bỏ, không giữ chuỗi rỗng.
{
  const jar = new CookieJar('OSID=old; SID=keep');
  jar.absorb(new Response('', { headers: [['set-cookie', 'OSID=; Expires=Thu, 01 Jan 1970 00:00:00 GMT']] }));
  assert.equal(jar.get('OSID'), null, 'cookie bị xoá không được giữ lại dạng rỗng');
  assert.ok(jar.header().includes('SID=keep'));
  assert.ok(!jar.header().includes('OSID='), 'header không được chứa cookie đã xoá');
}

// --- wizValue rút đúng key trong WIZ_global_data.
{
  const html = 'window.WIZ_global_data = {"cfb2h":"boq_x_20260907.05_p0","SNlM0e":"AIQ-abc","FdrFJe":"123"};';
  assert.equal(wizValue(html, 'SNlM0e'), 'AIQ-abc');
  assert.equal(wizValue(html, 'cfb2h'), 'boq_x_20260907.05_p0');
  assert.equal(wizValue(html, 'khong-co'), null);
}

async function main() {
  // --- Chu trình đầy đủ: 3 hop redirect rồi 200 có SNlM0e (đúng như quan sát thật).
  {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      const cookieSent = String((init?.headers as Record<string, string>)?.Cookie ?? '');
      if (u === 'https://flow.google.com/') {
        // Chỉ redirect khi OSID còn là bản cũ — sau SetOSID phải trả trang thật.
        if (cookieSent.includes('OSID=fresh')) {
          return new Response('window.WIZ_global_data={"SNlM0e":"AT_NEW","cfb2h":"BL_NEW","FdrFJe":"SID_NEW"};', { status: 200 });
        }
        return new Response('', { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin?osid=1&continue=https://flow.google.com/' } });
      }
      if (u.startsWith('https://accounts.google.com/ServiceLogin')) {
        return new Response('', { status: 302, headers: { location: 'https://flow.google.com/accounts/SetOSID?osidt=TOKEN&continue=https://flow.google.com/' } });
      }
      if (u.startsWith('https://flow.google.com/accounts/SetOSID')) {
        const h = new Headers({ location: 'https://flow.google.com/' });
        h.append('set-cookie', 'OSID=fresh; Path=/; Secure');
        return new Response('', { status: 302, headers: h });
      }
      throw new Error('URL ngoài kịch bản: ' + u);
    }) as typeof fetch;

    try {
      const out = await refreshOsid('SID=a; HSID=b; OSID=stale');
      assert.equal(out.at, 'AT_NEW', 'phải lấy được at mới từ HTML cuối chu trình');
      assert.equal(out.bl, 'BL_NEW');
      assert.equal(out.fsid, 'SID_NEW');
      assert.ok(out.cookie.includes('OSID=fresh'), 'cookie trả về phải chứa OSID mới');
      assert.ok(out.cookie.includes('SID=a'), 'cookie gốc phải được giữ');
      assert.equal(calls.length, 4, 'chu trình thật đi đúng 4 request (3 redirect + 1 trang)');
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // --- Phiên chết thật: redirect tới trang nhập tài khoản → phải báo 401 đúng bản chất,
  // KHÔNG được lặp redirect tới hết MAX_HOPS rồi báo lỗi mơ hồ.
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u === 'https://flow.google.com/') {
        return new Response('', { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin?osid=1' } });
      }
      return new Response('', { status: 302, headers: { location: 'https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn' } });
    }) as typeof fetch;

    try {
      await assert.rejects(
        () => refreshOsid('SID=dead'),
        (e: unknown) => e instanceof FlowApiError && e.code === 401 && /đăng xuất thật sự/.test(e.message),
        'redirect tới trang signin phải báo 401 "đăng xuất thật sự"'
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // --- Trang 200 nhưng ẩn danh (không có SNlM0e) → 401, không trả creds rỗng im lặng.
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('<html>trang ẩn danh</html>', { status: 200 })) as typeof fetch;
    try {
      await assert.rejects(
        () => refreshOsid('SID=x'),
        (e: unknown) => e instanceof FlowApiError && e.code === 401,
        'trang không có SNlM0e phải báo lỗi, không trả at rỗng'
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // --- Vòng lặp redirect vô hạn phải dừng, không treo.
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('', { status: 302, headers: { location: 'https://flow.google.com/loop' } })) as typeof fetch;
    try {
      await assert.rejects(() => refreshOsid('SID=x'), /quá 10 lần chuyển hướng/);
    } finally {
      globalThis.fetch = realFetch;
    }
  }
}

// Không dùng .then đơn lẻ: assert fail bên trong main() sẽ thành unhandled rejection và
// (tuỳ phiên bản Node) vẫn thoát code 0 — self-check báo OK trong khi thực chất đã hỏng.
main().then(
  () => console.log('check-osid-refresh: OK'),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
