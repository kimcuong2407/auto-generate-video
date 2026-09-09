/**
 * Self-check: phát hiện bộ cookie thiếu nhóm đăng nhập Google (lib/googleFlow/cookieCheck).
 *
 * Vì sao cần: đây là lỗi đã thực sự xảy ra 2026-09-09 và tốn nhiều thời gian chẩn đoán sai
 * hướng — extension gom cookie bằng getAll({url}) nên bỏ sót SID/HSID/APISID/SIDCC, session
 * lưu "thành công" nhưng mọi lệnh gen trả 401. Triệu chứng giống hệt cookie hết hạn, nên nếu
 * guard này hỏng thì lần sau lại đi chẩn đoán lại từ đầu.
 */
import assert from 'node:assert/strict';
import { missingLoginCookies, REQUIRED_LOGIN_COOKIES } from '../lib/googleFlow/cookieCheck';

// Tên cookie THẬT trong request GET https://flow.google.com/ của docs/flow.google.com.har
// (phiên đăng nhập tốt, trang trả HTML có SNlM0e).
const HAR_COOKIE_NAMES = [
  'SEARCH_SAMESITE', '__Secure-BUCKET', 'HSID', 'SSID', 'APISID', 'SAPISID',
  '__Secure-1PAPISID', '__Secure-3PAPISID', 'SID', '__Secure-1PSID', '__Secure-3PSID',
  'OSID', '__Secure-OSID', '_ga', 'AEC', 'NID', '__Secure-1PSIDTS', '__Secure-1PSIDRTS',
  '__Secure-3PSIDTS', '__Secure-3PSIDRTS', 'SIDCC', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
  '_ga_X2GNH8R5NS',
];

// Tên cookie THẬT extension bản cũ gom được — phiên này Google coi là ẩn danh, gen trả 401.
const BROKEN_COOKIE_NAMES = [
  '__Secure-next-auth.session-token', '__Secure-BUCKET', 'SSID', 'SAPISID',
  '__Secure-1PAPISID', '__Secure-3PAPISID', '__Secure-1PSID', '__Secure-3PSID', 'OSID',
  '__Secure-OSID', 'AEC', 'NID', '__Secure-1PSIDTS', '__Secure-1PSIDRTS',
  '__Secure-3PSIDTS', '__Secure-3PSIDRTS', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
];

const asHeader = (names: string[]) => names.map((n) => `${n}=v_${n}`).join('; ');

// --- Bộ cookie tốt (từ HAR) phải được chấp nhận.
{
  assert.deepEqual(missingLoginCookies(asHeader(HAR_COOKIE_NAMES)), [],
    'cookie thật từ HAR (phiên đăng nhập tốt) không được báo thiếu');
}

// --- Bộ cookie hỏng thật phải bị chặn, và phải nêu đúng cái thiếu.
{
  const missing = missingLoginCookies(asHeader(BROKEN_COOKIE_NAMES));
  assert.deepEqual(missing.sort(), ['APISID', 'HSID', 'SID'].sort(),
    'phải chỉ ra đúng nhóm cookie đăng nhập bị thiếu');
}

// --- Chuỗi rỗng: thiếu tất cả, không được crash.
{
  assert.deepEqual(missingLoginCookies('').sort(), [...REQUIRED_LOGIN_COOKIES].sort());
}

// --- Không nhầm cookie có tên chứa tên bắt buộc (SID vs __Secure-1PSID / SIDCC).
//
// Bẫy thật: bộ hỏng CÓ __Secure-1PSID và __Secure-3PSID nhưng KHÔNG có SID. Nếu so khớp bằng
// includes/substring thay vì tên chính xác, guard sẽ tưởng đủ và bỏ lọt đúng ca lỗi 401.
{
  const decoys = ['__Secure-1PSID', '__Secure-3PSID', 'SIDCC', '__Secure-1PSIDCC', 'SSID'];
  const missing = missingLoginCookies(asHeader(decoys));
  assert.ok(missing.includes('SID'), 'SID phải so khớp CHÍNH XÁC, không nhận __Secure-1PSID/SIDCC thay thế');
  assert.ok(missing.includes('HSID'), 'HSID không được nhận SSID thay thế');
}

// --- Khoảng trắng thừa / dấu ; cuối chuỗi không được làm hỏng việc tách tên.
{
  assert.deepEqual(missingLoginCookies('  SID=a ;HSID=b;  SAPISID=c ; APISID=d ;  '), [],
    'phải chịu được khoảng trắng thừa và dấu ; ở cuối');
}

console.log('check-flow-login-cookies: OK');
