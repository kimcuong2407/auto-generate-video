/**
 * Có cookie phiên ChatGPT thật hay chưa — theo docs/IMPLEMENTATION_CHATGPT_IMAGE_GEN.md mục 3.
 *
 * Chỉ ghé chatgpt.com khi CHƯA đăng nhập cũng đã được set vài cookie (Cloudflare, analytics),
 * nên "có cookie" không đủ. Phải có cookie TÊN chứa "session" (vd __Secure-next-auth.session-token)
 * mới tính là đã login; thiếu bước này sẽ đánh dấu connected cho phiên giả, rồi gen ảnh chết
 * ở bước chờ composer mà không rõ lý do.
 *
 * Để ở lib/ chứ không ở route.ts: Next.js chỉ cho phép route file export handler HTTP và vài
 * field config — export thêm hàm thường làm `next build` fail ("is not a valid Route export
 * field"), dù `tsc --noEmit` vẫn pass.
 */
export function hasSessionCookie(cookie: string): boolean {
  return cookie
    .split(';')
    .map((c) => c.split('=')[0]?.trim().toLowerCase() || '')
    .some((name) => name.includes('session'));
}
