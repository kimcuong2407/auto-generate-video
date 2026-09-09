/**
 * Kiểm tra bộ cookie thu từ extension có đủ nhóm cookie đăng nhập Google hay không.
 *
 * BỐI CẢNH (2026-09-09): extension gom cookie bằng chrome.cookies.getAll({url}) chỉ lấy được
 * nhóm `__Secure-*`, bỏ sót SID/HSID/APISID/SIDCC — cookie đăng nhập KHÔNG có tiền tố
 * `__Secure-`, nằm trên domain cha `.google.com`. Hậu quả rất khó chẩn đoán: session lưu
 * thành công, `at` hợp lệ, labs.google vẫn nhận đăng nhập, nhưng flow.google.com trả HTML
 * ẩn danh và MỌI batchexecute trả 401 — trông hệt như cookie hết hạn.
 *
 * Đối chiếu HAR gen thật (docs/flow.google.com.har): trình duyệt gửi 24 cookie; bộ thu thiếu
 * đúng 4 cái dưới đây (cùng vài cookie analytics vô hại).
 */

/**
 * Cookie bắt buộc để Google coi phiên là đã đăng nhập.
 *
 * Chỉ liệt kê nhóm CHẮC CHẮN cần: SIDCC/_ga có trong HAR nhưng SIDCC là cookie chống lạm dụng
 * tự sinh lại, _ga là analytics — thiếu chúng không làm phiên thành ẩn danh, đưa vào đây sẽ
 * chặn oan session dùng được.
 */
export const REQUIRED_LOGIN_COOKIES = ['SID', 'HSID', 'SAPISID', 'APISID'] as const;

/** Trả danh sách cookie đăng nhập còn thiếu trong chuỗi Cookie header ('' nếu đủ). */
export function missingLoginCookies(cookie: string): string[] {
  const names = new Set(
    cookie
      .split(';')
      .map((c) => c.trim().split('=')[0])
      .filter(Boolean)
  );
  return REQUIRED_LOGIN_COOKIES.filter((n) => !names.has(n));
}
