# ChatGPT Image Standalone

Công cụ gen ảnh bằng ChatGPT độc lập: đẩy **prompt (JSON) qua API**, extension chạy automation ngay trong tab `chatgpt.com` của bạn rồi trả ảnh về. **Không cần** database, **không cần** Next.js/server nặng — chỉ một server nhỏ giữ hàng đợi trong bộ nhớ + ghi ảnh ra file.

```
API/curl của bạn ──POST /jobs──► server nhỏ ──GET /jobs/next──► extension ──tab chatgpt.com──► ảnh
       ▲                            ▲                                │
       └──── GET /jobs/:id ─────────┴──────── POST /jobs/result ─────┘
```

## 1. Chạy server

```bash
node scripts/chatgpt-image-server.mjs
# hoặc: npm run image-server
# đổi cổng: PORT=5000 node scripts/chatgpt-image-server.mjs
```

Mặc định `http://localhost:4123`. Hàng đợi nằm trong RAM — tắt process là mất, đúng nhu cầu "đẩy prompt → lấy ảnh".

## 2. Cài extension

1. Chrome → `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `extension-chatgpt-standalone/`.
3. Cài trong **đúng profile Chrome đã đăng nhập ChatGPT**.
4. Mở popup → **Server URL** để `http://localhost:4123` (hoặc cổng bạn đổi) → **Lưu**.
5. Mở sẵn 1 tab `https://chatgpt.com` đã đăng nhập và **để mở**.

## 3. Dùng

### Cách A — test nhanh trong popup
Popup có sẵn ô **prompt** + **ảnh tham chiếu** + nút **Gen ảnh**. Bấm xong, ảnh hiện ngay trong popup kèm nút tải khi ChatGPT trả về (1-3 phút).

### Cách B — qua API (JSON), ghép vào pipeline của bạn

Đẩy job:
```bash
curl -X POST http://localhost:4123/jobs \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Ảnh sản phẩm chai serum trên nền đá cẩm thạch, ánh sáng studio"}'
# → {"id":"img-abc123"}
```

Với ảnh tham chiếu (server tự tải `url` về rồi đính; hoặc gửi thẳng `dataUrl` base64):
```bash
curl -X POST http://localhost:4123/jobs \
  -H "Content-Type: application/json" \
  -d '{
        "prompt":"Giữ đúng sản phẩm này, đặt trong bối cảnh phòng tắm sang trọng",
        "refImages":[{"url":"https://example.com/san-pham.jpg"}]
      }'
```

Lấy ảnh (poll tới khi `status: "done"`):
```bash
curl http://localhost:4123/jobs/img-abc123
# → {"id":"img-abc123","status":"done","file":"<đường dẫn>/output/img-abc123.png","imageBase64":"<base64>","ext":"png"}
#   hoặc {"status":"running"} / {"status":"error","error":"..."}
```

### Output tự lưu ra file

Ảnh gen xong server **tự ghi ra `output/<jobId>.<ext>`** (cạnh thư mục chạy lệnh). Pipeline chỉ
việc đọc file theo `file` trả về trong `/jobs/:id`, khỏi giải base64. Đổi thư mục bằng biến môi
trường:

```bash
IMAGE_OUTPUT_DIR=/duong/dan/khac node scripts/chatgpt-image-server.mjs
```

Trường `imageBase64` vẫn được trả song song (cho popup preview / ai cần base64). Thư mục `output/`
đã nằm trong `.gitignore`.

## Hợp đồng JSON

| Route | Body / Kết quả |
|---|---|
| `POST /jobs` | `{ prompt, refImages?: [{ url } \| { dataUrl, name? }] }` → `{ id }` |
| `GET /jobs/next` | *(extension dùng)* → `{ job }` hoặc `{}` |
| `POST /jobs/result` | *(extension dùng)* `{ jobId, imageBase64, ext }` \| `{ jobId, error }` |
| `GET /jobs/:id` | `{ status, imageBase64?, ext?, error? }` |
| `GET /jobs` | danh sách debug (không kèm base64) |
| `GET /health` | `{ ok, total, queued, running, done, error }` |

## Lưu ý

- **Phải mở tab chatgpt.com** đã đăng nhập thì job mới chạy. Không có tab → job bị đánh dấu lỗi ngay.
- Job `running` quá **25 phút** không có kết quả sẽ tự chuyển `error` (extension đóng tab/chết giữa chừng).
- Sau khi **Reload** extension ở `chrome://extensions`, content script cũ trên tab thành "orphan" và tự dừng (log cảnh báo là bình thường) — service worker mới nạp lại trong ~60s, hoặc F5 tab cho nhanh.
- Selector DOM nằm ở `imageJob.js` — ChatGPT đổi giao diện thì sửa ở đó.
- Self-check hàng đợi: `npm run check:image-server-queue`.
