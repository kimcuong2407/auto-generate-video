# Veo Product Review Pipeline

Ứng dụng Next.js quản lý pipeline 6 bước tạo video review sản phẩm bằng Google Veo (gọi trực tiếp Google Flow API, không qua MCP) và ghép video hoàn chỉnh bằng ffmpeg.

## Yêu cầu hệ thống

- Node.js 20+ (đã test với v25)
- ffmpeg + ffprobe cài sẵn trên máy, có trong `PATH` (kiểm tra bằng `ffmpeg -version`)
- Tài khoản Google Flow đã đăng nhập tại **Cài đặt → Flow** (`/settings/flow`) — nhập cookie + access_token của phiên Google Flow, dùng để gọi Veo (video) + Gemini/Flow-image (ảnh)

## Cài đặt

```bash
npm install
```

Module **Livestream Script** (`/livestream`) dùng Playwright (headless browser) làm tầng fetch dự
phòng cho các link render bằng JS — cần cài thêm browser Chromium (chỉ 1 lần):

```bash
npx playwright install chromium
```

## Cấu hình biến môi trường

Copy file mẫu rồi điền token:

```bash
cp .env.example .env.local
```

Điền các biến vào `.env.local`:

```bash
# Tuỳ chọn — mặc định lưu tại <project>/data/projects
PROJECTS_DIR=

# Tuỳ chọn — số job Veo tối đa chạy song song khi "Gen tất cả"
FLOW_MAX_CONCURRENT_JOBS=2

# Tuỳ chọn — thời gian tối đa (ms) chờ 1 job gen video trước khi tự đánh dấu lỗi timeout
FLOW_JOB_TIMEOUT_MS=900000
```

Bước **Storyboard ảnh** (Bước 2) sinh ảnh qua **Google Flow** — dùng chung tài khoản Google Flow đã đăng nhập ở Cài đặt → Flow cho gen video ở Bước 4, không cần cấu hình thêm API key nào riêng:

```bash
# Tuỳ chọn — thời gian tối đa (ms) chờ 1 ảnh storyboard sinh xong
STORYBOARD_IMAGE_TIMEOUT_MS=120000
```

`.env.local` không được commit (đã có trong `.gitignore`).

Module **Livestream Script** dùng thêm 1 model AI hỗ trợ đọc ảnh (vision) để tự đọc ảnh chụp màn hình
sản phẩm khi link bị chặn (VD Shopee) — model text mặc định của `AI_CHAT_API_MODEL` thường KHÔNG hỗ
trợ ảnh, nên cần cấu hình riêng qua gateway đang dùng:

```bash
# VD nếu gateway AI_CHAT_API_URL hỗ trợ model Claude:
AI_VISION_MODEL=cc/claude-haiku-4-5-20251001
```

Để trống nếu không muốn dùng tính năng đọc ảnh — vẫn hoạt động bình thường, chỉ là phải nhập mô tả
sản phẩm thủ công cho các link bị chặn thay vì upload ảnh chụp màn hình.

## Chạy dev

```bash
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000).

## Build production

```bash
npm run build
npm start
```

## Lint

```bash
npm run lint
```

## Cách dùng pipeline

1. **Upload** — tạo project mới: nhập tên, chọn tỷ lệ khung hình (9:16/16:9), upload ảnh sản phẩm, chỉnh sửa template kịch bản (JSON, đã có sẵn mẫu Handobox), nhập mô tả sản phẩm.
2. **Storyboard ảnh** — mỗi cảnh trong template ở Bước 1 có 1 ảnh storyboard tương ứng, sinh qua Google Flow, có thể dùng ảnh sản phẩm làm ảnh tham chiếu để giữ đúng hình dạng/màu sắc. Giúp hình dung trước bố cục/không khí từng cảnh trước khi viết kịch bản chi tiết.
3. **Duyệt kịch bản** — chọn 1 "góc kịch bản" (Unboxing, Problem → Solution, Demo công năng...), bấm **"Sinh nháp bằng AI"** để AI tự thiết kế **cả cấu trúc cảnh** (số lượng, loại cảnh, thời lượng) phù hợp với góc đã chọn — không còn bị bó buộc theo danh sách cảnh cố định trong template (VD: góc "Demo công năng" sẽ bỏ qua cảnh intro, vào thẳng cảnh dùng sản phẩm). Sau đó xem/sửa voiceover, on-screen text, prompt Veo cho từng cảnh, có thể **thêm/xoá cảnh** và **kéo-thả sắp xếp lại thứ tự**.
4. **Gen video** — bấm Gen từng cảnh hoặc "Chạy toàn bộ" để gọi Veo tạo video. Nếu thấy banner đỏ "Google Flow chưa kết nối", cần vào Cài đặt → Flow (`/settings/flow`) đăng nhập/cập nhật lại tài khoản Google Flow trước.
5. **Tải output** — xem/tải video từng cảnh đã gen xong.
6. **Ghép video** — ghép các cảnh đã gen xong + overlay text + nhạc nền (nếu có) thành `final.mp4` bằng ffmpeg (số cảnh tuỳ theo cấu trúc kịch bản đã chọn ở Bước 3).

Dữ liệu mỗi project được lưu tại `data/projects/<project-id>/` (ảnh input, video từng cảnh, video ghép cuối cùng, file trạng thái `project.json`). Thư mục `data/` không commit vào git.

## Crawl sản phẩm Shopee (qua Chrome Extension)

Màn hình `/shopee-crawl` lấy toàn bộ thông tin 1 sản phẩm Shopee (tên, giá, rating, ảnh, mô tả, phân
loại...) và cho phép **khởi tạo luôn** job Livestream hoặc project Video Review từ data đó.
**Không crawl trực tiếp phía server được** — Shopee chặn mọi request tự động (đã kiểm chứng:
fetch thuần, Playwright headless/headful, plugin stealth, kết nối CDP vào Chrome thật — tất cả trả
`error 90309999` hoặc redirect trang verify). API Shopee còn yêu cầu header ký runtime do SDK anti-bot
sinh bằng JS, không giả lập được từ code.

Giải pháp: 1 **Chrome Extension** (`extension/`) chạy ngay trong tab Shopee thật của bạn (đã pass
anti-bot, không dùng CDP nên không bị phát hiện), đọc data rồi POST về app.

1. Cài extension: `chrome://extensions` → bật Developer mode → **Load unpacked** → chọn `extension/`.
   Xem chi tiết trong `extension/README.md`.
2. Mở `/shopee-crawl` → bấm **"Bắt đầu lắng nghe data"**.
3. Mở 1 trang sản phẩm Shopee trong Chrome → bấm icon extension → **"Gửi data"**.
4. Info hiện đầy đủ trên `/shopee-crawl`. Bấm **"Tạo job Livestream"** hoặc **"Tạo project Video Review"**
   để khởi tạo project ngay từ sản phẩm vừa crawl.

**Deploy Ubuntu:** đổi *Endpoint URL* trong popup extension thành `https://your-domain.com/api/shopee/ingest`
(endpoint `POST /api/shopee/ingest` đã bật CORS). Extension vẫn chạy trên máy có Chrome, chỉ nơi nhận
data đổi sang server. Data hiển thị lưu in-memory (reset khi restart server) — đủ cho mục đích test.

## Cấu trúc thư mục

```
app/
  page.tsx                 Trang chủ: danh sách project + form tạo mới
  projects/[id]/page.tsx   Trang pipeline chính (6 bước)
  api/projects/            API routes (tạo project, storyboard, script, gen video, concat, media, reset...)
  api/shopee/ingest/       Nhận data sản phẩm từ Chrome extension (POST) + poll hiển thị (GET)
  shopee-crawl/page.tsx    Màn hình crawl data sản phẩm Shopee + khởi tạo project từ data
components/                UI components (Sidebar, Topbar, 6 step components)
hooks/                     useProjectPolling — poll trạng thái project
lib/
  googleFlow/              Client gọi trực tiếp Google Flow API (video/image gen, auth cookie+access_token)
  ai/                      Client gọi AI API ngoài Flow (chatClient.ts sinh kịch bản)
  ffmpeg/concat.ts         Logic ghép video bằng ffmpeg
  data/                    Đọc/ghi project.json (dùng làm "database" file JSON)
  shopee/                  parseInitialState (bóc data), ingestStore (lưu in-memory), types
extension/                 Chrome Extension (MV3) đọc data sản phẩm từ tab Shopee thật
data/projects/             Dữ liệu từng project (ảnh, video, output) — không commit
public/default-template.json  Template kịch bản mặc định
```

## Xử lý sự cố

- **Banner "Google Flow chưa kết nối"**: vào Cài đặt → Flow (`/settings/flow`), đăng nhập/cập nhật lại tài khoản Google Flow (cookie + access_token). Không phải lỗi ứng dụng.
- **Ghép video báo thiếu scene**: cần gen xong toàn bộ các cảnh (trạng thái "Xong") trước khi ghép, hoặc chấp nhận bỏ qua cảnh chưa xong.
- **ffmpeg not found**: cài ffmpeg (`brew install ffmpeg` trên macOS) và đảm bảo có trong `PATH`.
