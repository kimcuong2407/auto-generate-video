# ChatGPT Session Grabber

Extension Chrome báo cho app biết tài khoản ChatGPT còn đăng nhập hay đã bị đá ra.

## Nó KHÔNG làm gì

Không thay thế được profile automation. Cookie gửi về **không đủ** để dựng lại phiên cho
Playwright: ChatGPT chặn HTTP thuần bằng Cloudflare Turnstile, và token phiên còn nằm ở
`localStorage`/`IndexedDB` mà `chrome.cookies` không đọc được
(xem `docs/IMPLEMENTATION_CHATGPT_IMAGE_GEN.md` mục 0).

Việc gen ảnh vẫn chạy bằng Playwright trên profile ở `data/chatgpt-profiles/<id>/`.

## Nó làm gì

Mỗi 5 phút (và khi bấm nút trong popup): đọc cookie `chatgpt.com`, POST về
`/api/chatgpt-auth/session`. Server kiểm tra có cookie tên chứa `session` không rồi bật/tắt
cờ `connected` của account — nhờ đó trang Cài đặt hiện đúng trạng thái, và worker bỏ qua
account chết thay vì retry tới hết timeout.

## Cài

1. Chrome → `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `extension-chatgpt/`.
3. Cài trong **đúng profile Chrome đã đăng nhập ChatGPT**. Extension đọc cookie của profile
   đang chạy nó, không đọc được profile khác.
4. Mở popup, kiểm tra endpoint (mặc định `https://video.homebox.vn/api/chatgpt-auth/session`),
   bấm **Gửi trạng thái đăng nhập**.

## Thông báo trong popup

| Hiện | Nghĩa |
|---|---|
| ✓ Đã đăng nhập — app đã ghi nhận | Xong, account `connected` |
| ⚠ chưa có profile automation | Cookie hợp lệ nhưng app chưa có `data/chatgpt-profiles/<id>/` — vẫn chưa gen ảnh được |
| ✗ Chưa đăng nhập ChatGPT trong Chrome | Chỉ thấy cookie Cloudflare, không có cookie phiên → đăng nhập lại ở tab chatgpt.com |
| ✗ Không gọi được app | Sai endpoint, hoặc app chưa chạy |
