# Shopee Product Grabber — Chrome Extension

Đọc thông tin sản phẩm ngay trong tab Shopee thật của bạn (đã đăng nhập / đã qua kiểm tra anti-bot)
rồi gửi về app review pipeline. Đây là cách **duy nhất** lấy được data vì Shopee chặn mọi crawl phía
server (đã kiểm chứng: fetch thuần, Playwright headless/headful, stealth, CDP — tất cả bị chặn
`error 90309999` / redirect verify).

## Cài đặt (Load unpacked)

1. Mở Chrome → vào `chrome://extensions`.
2. Bật **Developer mode** (góc trên phải).
3. Bấm **Load unpacked** → chọn thư mục `extension/` này.
4. Extension **Shopee Product Grabber** xuất hiện, ghim icon lên thanh công cụ cho tiện.

## Sử dụng

1. Chạy app: `npm run dev` (mặc định `http://localhost:3000`).
2. Mở màn hình crawl: `http://localhost:3000/shopee-crawl` → bấm **"Bắt đầu lắng nghe data"**.
3. Trong Chrome, mở **1 trang sản phẩm Shopee** bất kỳ (VD `https://shopee.vn/...-i.<shop>.<item>`).
4. Bấm icon extension → kiểm tra **Endpoint URL** (mặc định `http://localhost:3000/api/shopee/ingest`)
   → bấm **"Gửi data"**.
5. Popup báo `✅ Đã gửi: <tên sản phẩm>`. Màn hình `/shopee-crawl` tự hiện toàn bộ info.

## Deploy lên server Ubuntu (qua domain)

Chỉ cần đổi **Endpoint URL** trong popup extension thành domain server của bạn, ví dụ:

```
https://your-domain.com/api/shopee/ingest
```

Endpoint được lưu lại (chrome.storage) nên chỉ nhập 1 lần. Server nhận data qua `POST /api/shopee/ingest`
(đã bật CORS `*`). Extension vẫn chạy trên máy có Chrome; chỉ nơi **nhận** data đổi sang server.

## Cách hoạt động

- `content.js` chạy trong trang Shopee, tìm thẻ `<script>` chứa JSON `{"initialState":...}` và bóc
  `initialState.item.items[<itemId>]` (data sản phẩm đầy đủ). Có fallback đọc DOM nếu Shopee đổi cấu trúc.
- `popup.js` **tự inject `content.js`** vào tab (qua `chrome.scripting`) rồi gửi message lấy data,
  cuối cùng `POST` về Endpoint URL đã cấu hình.
- Vì code chạy trong tab thật (không dùng CDP/automation), Shopee không phát hiện ⇒ không bị chặn.

## Xử lý sự cố

- **`Could not establish connection. Receiving end does not exist.`**: content script chưa có trong
  tab (thường do trang Shopee được mở TRƯỚC khi cài/reload extension). Popup nay tự inject content
  script trước khi gửi message nên thường tự khỏi — nếu vẫn lỗi, **tải lại (F5) trang Shopee** rồi bấm
  lại. Sau khi sửa/reload extension ở `chrome://extensions`, cũng cần F5 lại tab Shopee.
- **Tab hiện tại không phải trang Shopee**: đảm bảo tab đang active là 1 trang sản phẩm `shopee.vn`.
