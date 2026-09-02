# ChatGPT Image Worker

Extension Chrome làm **worker gen ảnh** cho app review pipeline: nhận job từ app, chạy automation
ngay trong tab `chatgpt.com` của bạn, gửi ảnh về app.

Kèm nhiệm vụ cũ: báo cho app biết tài khoản ChatGPT còn đăng nhập hay đã bị đá ra.

## Vì sao chạy trong Chrome của bạn

Bản gốc gen ảnh bằng Playwright trên server, đọc profile Chrome copy sẵn lên đó. Tạo được profile
đó thì tắc cả ba đường:

- Copy profile từ macOS — không ăn, cookie mã hoá bằng khoá nằm trong Keychain.
- Gửi cookie qua extension — không đủ, token còn ở `localStorage`/`IndexedDB` và Cloudflare gắn
  phiên với fingerprint trình duyệt (xem `docs/IMPLEMENTATION_CHATGPT_IMAGE_GEN.md` mục 0).
- Đăng nhập trực tiếp trên VPS qua X11 — chạy được, nhưng phải làm lại mỗi lần ChatGPT đá phiên.

Chạy thẳng trong Chrome bạn đang mở thì không vướng rào nào: đó là trình duyệt thật, đã đăng nhập,
đúng fingerprint, đúng IP.

**Đánh đổi:** Chrome phải mở và có tab `chatgpt.com` thì job mới chạy. Đóng Chrome → job nằm chờ
trong queue, quá 15 phút thì server tự đánh dấu thất bại.

## Cài

1. Chrome → `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `extension-chatgpt/`.
3. Cài trong **đúng profile Chrome đã đăng nhập ChatGPT**.
4. Mở popup, đặt endpoint **đúng port app đang chạy**:
   - Local: `http://localhost:3000/api/chatgpt-auth/session`
   - Production: `https://video.homebox.vn/api/chatgpt-auth/session`

   Route gen ảnh tự suy ra từ endpoint này (cùng origin), không phải nhập riêng.

   ⚠️ Sai port là extension im lặng không làm gì (job nằm chờ trong queue, không báo lỗi).
   Kiểm tra nhanh bằng `curl http://localhost:<port>/api/chatgpt-image/status` — đúng app thì
   trả JSON `{"online":...}`, sai app thì trả trang 404.
5. Bấm **Gửi trạng thái đăng nhập** để kiểm tra kết nối.
6. Trong app: **Cài đặt → AI → Provider gen ảnh** → chọn **ChatGPT (qua extension Chrome)**.
   Banner phải hiện "Extension đang kết nối".

## Dùng

Mở sẵn một tab `chatgpt.com` rồi bấm gen ảnh trong app như bình thường. Popup hiện trạng thái:
đang chờ job / đang gen / job gần nhất xong hay lỗi.

## Cách nó chạy

```
app (job queue, source='extension')
   ▲  POST ảnh base64                    │ GET job
   │                                     ▼
service worker  ──chrome.scripting──►  tab chatgpt.com
   ▲                                     │
   └────── POLL_JOBS mỗi 1.5s ───── content.js
```

- `content.js` chỉ giữ **nhịp** — service worker MV3 bị Chrome kill sau ~30s idle, cần được đánh
  thức đều đặn. Ngoài ra có alarm keepalive 1 phút phòng khi không tab nào tick.
- `background.js` fetch job + gọi `chrome.scripting.executeScript` vào MAIN world.
- `imageJob.js` chứa toàn bộ logic DOM (đính ảnh ref → gõ prompt → gửi → chờ ảnh → lấy bytes).
  Đây là bản port của `lib/chatgptImage/runner.ts` + `domScript.ts` — **đổi selector bên đó thì
  phải đổi cả bên này**; `npm run check:chatgpt-extension` canh cho hai bên không lệch.

## Thông báo trong popup

| Hiện | Nghĩa |
|---|---|
| ✓ Đã đăng nhập — app đã ghi nhận | Xong |
| ✓ Đã đăng nhập, ghi chú "chưa có profile automation" | Bình thường nếu dùng provider extension — profile đó chỉ dành cho đường Playwright |
| ✗ Chưa đăng nhập ChatGPT trong Chrome | Chỉ thấy cookie Cloudflare → đăng nhập lại ở tab chatgpt.com |
| ✗ Không gọi được app | Sai endpoint, hoặc app chưa chạy |
| Worker: chưa rõ (service worker đang ngủ) | Bình thường — mở tab chatgpt.com là nó tỉnh |

## Khi sửa extension

Sau khi Reload ở `chrome://extensions`, content script cũ trên tab đang mở thành "orphan" và tự
dừng (log cảnh báo là **bình thường**). Service worker mới sẽ nạp lại trong ~60s, hoặc F5 tab cho
nhanh.
