# Google Flow Session Grabber — Chrome Extension

Lấy **cookie/access_token** từ tab `labs.google` đã đăng nhập, và **mint reCAPTCHA Enterprise token theo yêu cầu (on-demand)** để app tự gọi Google Flow API.

reCAPTCHA token sống rất ngắn (~2 phút) và chỉ dùng được **một lần**, nên extension KHÔNG mint sẵn nữa. Thay vào đó, khi app cần gen (video/ảnh), app tạo một "pending request"; **content script** trên tab `labs.google` short-poll thấy request → mint token **tươi** ngay lúc đó → gửi về app.

## Cài đặt (Load unpacked)

1. Mở Chrome → `chrome://extensions`.
2. Bật **Developer mode**.
3. Bấm **Load unpacked** → chọn thư mục `extension-flow/`.
4. Ghim icon lên thanh công cụ.

## Sử dụng

1. Đăng nhập Google Flow: mở `https://labs.google` và đăng nhập tài khoản Google.
2. Chạy app: `npm run dev` (mặc định `http://localhost:3000`).
3. **Giữ tab `https://labs.google` luôn mở** — content script sống trong tab này để mint token khi app cần.
4. Bấm icon extension → điền **Nhãn tài khoản** + **Endpoint URL** (mặc định `http://localhost:3000/api/flow-auth/session`) → bấm **"Gửi session ngay"** (lưu cookie + access_token vào app).
5. Gen video/ảnh trong app như bình thường — token được mint tự động on-demand.

## Cách hoạt động (kỹ thuật)

Hai phần độc lập:

### 1. Session (cookie + access_token) — `background.js` (service worker)
- Lấy cookie HttpOnly qua `chrome.cookies.getAll` (cần quyền `cookies`) + access_token qua `GET /fx/api/auth/session`, POST về `/api/flow-auth/session`.
- Chạy theo `chrome.alarms` mỗi ~5 phút (session sống lâu hơn token nhiều), hoặc bấm "Gửi ngay" thủ công.

### 2. reCAPTCHA token (on-demand) — `content.js` + `background.js`
- `content.js` (isolated world, sống theo tab labs.google) chỉ giữ **nhịp**: mỗi ~1.5s gửi `POLL_TOKENS` cho service worker. Nó KHÔNG tự fetch/mint vì **CSP của labs.google chặn** content script fetch cross-origin tới localhost và chặn inject `<script>` từ `chrome-extension://`.
- `background.js` (service worker — không bị CSP của trang ràng buộc, có `host_permissions` localhost) mới thực sự: fetch `GET /api/flow-auth/token-request`; với mỗi pending → mint token qua `chrome.scripting.executeScript({ world: 'MAIN' })` trong tab labs.google (nơi duy nhất thấy `window.grecaptcha.enterprise`) → POST token về `POST /api/flow-auth/token-request`.
- labs.google **tự load sẵn** `grecaptcha.enterprise` nên KHÔNG tự inject `enterprise.js` (CSP chặn).

## Lưu ý

- **Tab `labs.google` phải luôn mở** — đóng tab thì không mint được token, app sẽ báo lỗi "Hết thời gian chờ mint reCAPTCHA".
- Nếu báo "grecaptcha.enterprise chưa sẵn sàng": **tải lại (F5) tab labs.google** để trang load xong `grecaptcha`.
- Kiểm tra trạng thái poller: `GET http://localhost:3000/api/flow-auth/status` → xem `recaptcha.pendingCount` và `recaptcha.lastPollAt`.
- Site key: `6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV`.
