# Cách tạo ảnh bằng ChatGPT không qua API — luồng implement

Tài liệu này mô tả **cơ chế thật** dùng để tự động tạo ảnh bằng ChatGPT trong
app POD Ultimate Kit (Tauri + Rust + WebView2), để có thể implement lại ở
stack khác. Đây **không phải** gọi OpenAI API — đây là **browser automation**:
mở một trình duyệt (WebView) đã đăng nhập thật vào chatgpt.com, tiêm JavaScript
vào trang để giả lập người dùng gõ prompt/bấm gửi, rồi lấy ảnh kết quả ra khỏi
DOM.

## 0. Vì sao không gọi API thẳng

OpenAI chặn request HTTP thuần bằng Cloudflare Turnstile + hệ thống chống bot
riêng — token chống bot chỉ sinh được trong một trình duyệt thật đã đăng nhập.
Vì vậy **không có cách gọi network trực tiếp** để tạo ảnh miễn phí qua tài
khoản ChatGPT thường (Plus) mà không dùng OpenAI API trả tiền riêng. Giải pháp
duy nhất còn lại: điều khiển một trình duyệt thật.

Rủi ro đã biết: toàn bộ cơ chế phụ thuộc vào cấu trúc DOM/selector hiện tại
của chatgpt.com — mọi lần OpenAI đổi giao diện có thể làm automation vỡ (cần
sửa lại selector/logic scrape).

## 1. Kiến trúc tổng quan

```
┌─────────────────────┐     invoke (IPC)      ┌──────────────────────────┐
│  App UI (React/JS)  │ ─────────────────────► │  Backend process (Rust)  │
│  - form nhập prompt │ ◄───────────────────── │  - job queue (SQLite)    │
└─────────────────────┘     events/callback    │  - worker loop / account │
                                                 └────────────┬─────────────┘
                                                              │ mở & điều khiển
                                                              ▼
                                          ┌───────────────────────────────────┐
                                          │  WebView ẩn, đã login chatgpt.com  │
                                          │  (1 process/profile RIÊNG mỗi acc) │
                                          │  ← JS tiêm vào: gõ prompt, bấm gửi,│
                                          │    scrape ảnh kết quả khỏi DOM     │
                                          └───────────────────┬───────────────┘
                                                               │ invoke ngược lại
                                                               ▼
                                                    trả kết quả (base64 ảnh)
                                                    về Rust qua callback/IPC
```

Framework gốc dùng **Tauri 2** (Rust backend + WebView2 embedded làm cả UI
chính lẫn "trình duyệt ẩn" điều khiển ChatGPT). Có thể thay bằng
**Electron + BrowserView/BrowserWindow ẩn** hoặc **Playwright/Puppeteer với 1
browser context persistent** — điểm mấu chốt là công cụ đó phải:

1. Cho mở nhiều browser context/profile **độc lập cookie** (multi-account).
2. Cho **tiêm JavaScript** vào trang đang mở và lấy kết quả JS trả về.
3. Cho JS tiêm **gọi ngược** vào code điều khiển (IPC hoặc tương đương) khi
   xong việc — vì quá trình tạo ảnh của ChatGPT chạy bất đồng bộ, kéo dài
   hàng chục giây đến vài phút, không thể "eval và đợi return" 1 lần.

## 2. Multi-account: mỗi tài khoản một profile độc lập

**Bắt buộc** để nhiều tài khoản chạy song song mà không đụng cookie nhau.

- Mỗi account có 1 UUID, và 1 thư mục riêng:
  `<app_data_dir>/accounts/<account_id>/webview/` — đây chính là
  `data_directory` (Tauri) / tương đương `userDataDir` (Puppeteer) /
  `storageState` riêng (Playwright) khi tạo browser context cho account đó.
- Vì mỗi account có `data_directory` riêng, cookie/localStorage của account A
  hoàn toàn không lẫn với account B — cho phép **N account đăng nhập và chạy
  automation song song thật sự**, không tài khoản nào ảnh hưởng tài khoản
  khác.
- Metadata account (id, label, provider) lưu trong SQLite bảng `accounts`;
  trạng thái "đã đăng nhập" (`connected`) được suy ra bằng cách đọc lại file
  cookie đã lưu (`accounts/<id>/cookies.json`) — **không** hỏi trực tiếp
  WebView mỗi lần (WebView có thể chưa mở).

## 3. Luồng "Thêm tài khoản" (login lần đầu)

1. UI gọi `add_account(label, provider)` → backend tạo row `accounts` mới
   (UUID), tạo sẵn thư mục `accounts/<id>/`.
2. UI ngay lập tức mở **1 cửa sổ WebView hiển thị** (label `login-<id>`),
   `data_directory` = thư mục riêng của account đó, navigate tới
   `https://chatgpt.com/`. Cửa sổ này **hiện ra thật** để người dùng tự đăng
   nhập bằng mắt/tay (nhập email, mật khẩu, 2FA... — không tự động phần này).
3. Ngay khi cửa sổ mở, backend tiêm sẵn 1 script (`login.js`) vào trang.
   Script này:
   - Poll mỗi 2 giây, tìm `#prompt-textarea` (ô chat thật của ChatGPT) xuất
     hiện trong DOM → coi là "đăng nhập xong, đã vào giao diện chat".
   - Khi tìm thấy, tự gọi ngược `invoke("save_chatgpt_session")`.
   - Cũng gắn 1 nút nổi "✓ Lưu đăng nhập" để người dùng bấm tay nếu muốn lưu
     sớm hơn (gọi cùng lệnh).

   **Điểm quan trọng**: KHÔNG dùng selector textarea chung/generic — chỉ
   `#prompt-textarea` hoặc `[data-testid="composer-text-input"]` mới được
   tính là "đã login", vì trang landing (chưa login) đôi khi có phần tử khác
   dễ bị nhận nhầm, gây lưu session giả (đóng cửa sổ sớm trong khi thực ra
   chưa đăng nhập xong).

4. `save_chatgpt_session` (chạy ở backend, được JS gọi ngược qua IPC):
   - Lấy toàn bộ cookie hiện tại của cửa sổ WebView đó
     (`window.cookies()`/tương đương API cookie của framework).
   - Lọc chỉ giữ cookie thuộc domain `chatgpt.com`/`openai.com`.
   - **Validate thật**: chỉ chấp nhận là "đã login" nếu có ít nhất 1 cookie có
     tên chứa `"session"` (không dấu cách, lowercase-match). Đây là bước quan
     trọng — chỉ ghé chatgpt.com dù *chưa đăng nhập* cũng đã set vài cookie
     (Cloudflare, analytics...), nên "có ≥1 cookie" không đủ để coi là đã
     login; phải có cookie session thật.
   - Nếu hợp lệ: ghi các cookie đó ra file JSON
     `accounts/<id>/cookies.json`, đóng cửa sổ login, khởi động **worker
     loop** cho account này (xem phần 5).
   - Nếu chưa hợp lệ: trả lỗi, không đóng cửa sổ, không lưu gì — người dùng
     tiếp tục đăng nhập.

Kết quả: từ giờ, mở lại cửa sổ WebView với đúng `data_directory` này sẽ tự
động ở trạng thái đã đăng nhập (cookie được browser tự load lại từ profile),
không cần gọi lại API đăng nhập nào — đây chính là lý do "1 profile/account"
đủ để duy trì session lâu dài.

## 4. Job queue — vì sao cần hàng đợi, không gọi thẳng

Yêu cầu tạo ảnh không được gọi automation ngay tại request — vì:

- Nhiều request có thể tới cùng lúc (batch nhiều prompt, nhiều người dùng
  dashboard web).
- Mỗi account chỉ nên chạy **1 lượt tại 1 thời điểm** (không mở nhiều tab gõ
  cùng lúc trên cùng 1 phiên đăng nhập — dễ vỡ do DOM bị 2 script tranh nhau).
- Cần load-balance tự nhiên qua N account đang connected.

Thiết kế: **SQLite làm queue**, bảng `image_jobs`:

```sql
CREATE TABLE image_jobs (
  id TEXT PRIMARY KEY,
  prompt TEXT, model TEXT, aspect TEXT, count INTEGER,
  ref_images_json TEXT,      -- ảnh tham chiếu, base64, dạng JSON array
  style TEXT, transparent_bg INTEGER,
  kind TEXT,                 -- 'design' hoặc 'mockup'
  status TEXT,               -- queued | running | done | error
  output_path TEXT, error TEXT,
  image_paths_json TEXT,      -- kết quả: đường dẫn file local đã lưu
  image_urls_json TEXT,       -- (optional) URL public nếu có upload lên storage ngoài
  account_id TEXT,            -- account nào đã/đang xử lý job này
  created_at, updated_at, started_at, finished_at, attempts INTEGER
);
```

- **Submit job**: `generate_images_core(args)` → check có ít nhất 1 account
  `connected` → `INSERT ... status='queued'` → phát signal "có job mới"
  (dùng 1 `Notify`/condvar để đánh thức các worker đang idle ngay, thay vì
  chờ tới lượt poll tiếp theo) → trả về `job_id` ngay (không đợi ảnh xong).

- **Claim job** (mỗi account một worker loop riêng, chạy vô hạn):
  ```
  loop {
    if account chưa có cookie hợp lệ → sleep 3s, continue
    job = claim_next_job(account_id)   // xem transaction bên dưới
    if job có → run_image_job(job)     // tạo ảnh thật, có thể mất vài phút
    else → chờ (signal "có job mới" HOẶC timeout 2s), rồi loop lại
  }
  ```

  `claim_next_job` phải atomic để N worker (N account) không giành nhau 1 job:
  ```sql
  BEGIN;
  SELECT id, ... FROM image_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1;
  -- rồi ngay trong CÙNG transaction:
  UPDATE image_jobs SET status='running', account_id=?, attempts=attempts+1
    WHERE id=? AND status='queued';
  COMMIT;
  -- nếu UPDATE ảnh hưởng 0 dòng (worker khác đã giành job này trước) → coi như không có job, thử job tiếp theo ở lượt sau
  ```
  Đây chính là "ai rảnh giành trước" — vừa là round-robin tự nhiên giữa các
  account đang idle, vừa tận dụng tối đa số account đang connected mà không
  cần lịch phân công cứng.

## 5. Một lượt tạo ảnh thật (`run_image_job` / `chatgpt_generate_one`)

Với **1 job** đã được 1 account claim:

1. **Khoá tuần tự riêng cho account đó** (mutex/async lock, KHÔNG khoá toàn
   cục) — đảm bảo account này chỉ chạy 1 lượt automation tại 1 thời điểm,
   nhưng account khác chạy song song hoàn toàn tự do.

2. **Mở/lấy lại cửa sổ WebView của account** (label riêng, ví dụ `auto-<id>`)
   — nếu account có URL hội thoại (`conversation`) đã dùng lần trước (lưu ở
   file `accounts/<id>/last_conversation.txt`), navigate thẳng vào đó để
   **tái sử dụng cùng 1 thread chat** cho các job liên tiếp (giữ context, và
   tránh phải mở conversation mới mỗi lần). Nếu chưa có, mở
   `https://chatgpt.com/` (thread mới).

   Cửa sổ này **có thể ẩn hoàn toàn** (invisible) trong vận hành bình thường
   — chỉ hiện lên khi người dùng bật cờ "debug" để soi automation đang chạy
   gì. Ẩn/hiện đơn giản là toggle visibility của window, không ảnh hưởng tới
   automation.

3. **Chờ trang sẵn sàng** (`wait_ready`, poll tối đa ~45s):
   - Tiêm 1 đoạn JS nhỏ, đọc trạng thái trang, trả 1 trong 4 giá trị:
     - `"ready"` — tìm thấy `#prompt-textarea` → composer đã sẵn sàng.
     - `"missing"` — path là `/c/<id>` (1 conversation cụ thể) nhưng body chứa
       text kiểu "conversation not found" → conversation đã bị xoá, cần xoá
       URL đã lưu và mở lại trang gốc `chatgpt.com/`.
     - `"login"` — thấy nút login hoặc text "log in"/"welcome back" → cookie
       đã hết hạn, cần người dùng đăng nhập lại (coi là lỗi *fatal*, dừng
       ngay không retry vô ích).
     - còn lại → `"pending"`, tiếp tục poll.

4. **Đính kèm ảnh tham chiếu (nếu có)** — đây là phần automation phức tạp
   nhất, dùng **chuỗi 4 chiến lược fallback** (thử lần lượt, dừng ngay khi 1
   chiến lược thành công):
   a. **Input file trực tiếp**: tìm `<input type="file">` có sẵn trong DOM
      (thường bị ẩn CSS nhưng vẫn tồn tại), set `.files` bằng
      `DataTransfer` chứa các `File` object dựng từ base64, dispatch event
      `input`+`change`.
   b. **Bấm nút "Attach"/"Upload" rồi mới tìm input**: nếu (a) không tìm
      thấy input nào, click các nút có label/aria chứa
      attach/upload/file/paperclip..., đợi 700ms cho input file mới xuất
      hiện trong DOM rồi làm như (a).
   c. **Giả lập paste**: dispatch 1 `ClipboardEvent('paste')` với
      `clipboardData` chứa file, thẳng vào ô composer.
   d. **Giả lập kéo-thả**: dispatch chuỗi event `dragenter/dragover/drop` với
      `DataTransfer` chứa file, vào `<form>` hoặc `document.body`.

   Sau mỗi chiến lược, **verify bằng cách chụp "snapshot trước/sau"**: so
   sánh số lượng `<img>` mới xuất hiện trong vùng composer + số node có
   class/label chứa "attachment/thumbnail/preview" + có tên file xuất hiện
   trong text trang hay không. Poll tối đa 60s để chờ xác nhận đính kèm thật
   sự thành công (không phải chỉ dispatch event xong là coi như thành).

   Nếu bắt buộc phải có ref image (theo yêu cầu người dùng) mà cả 4 chiến
   lược đều fail → **dừng job ngay, không gửi prompt** (tránh gửi thiếu ảnh
   tham chiếu mà ChatGPT vẫn cứ trả lời sai đề).

5. **Chọn model** (nếu UI cho chọn model cụ thể, ví dụ GPT-5.x variant): click
   nút dropdown chọn model, đợi menu mở, tìm item khớp tên (so khớp chính xác
   trước, rồi fallback so khớp "chứa chuỗi"), click item đó. Không có thì bỏ
   qua bước này (dùng model default hiện tại của trang).

6. **Gõ prompt vào composer** — composer của ChatGPT là 1
   `<div contenteditable="true">` (id `prompt-textarea`), KHÔNG phải
   `<textarea>` thường, nên không set `.value` được. Chuỗi fallback 3 bước:
   a. Clear composer (chọn hết nội dung, `execCommand('delete')`), rồi
      dispatch synthetic `ClipboardEvent('paste')` chứa text cần gõ.
   b. Nếu (a) không "dính" (verify bằng đọc lại `innerText` sau vài lần
      poll 100ms), thử `document.execCommand('insertText', false, text)`.
   c. Nếu vẫn không được, set trực tiếp `el.textContent = text` rồi tự
      dispatch `InputEvent('input', {inputType:'insertText'})` để React
      (ChatGPT dùng React) nhận diện có thay đổi và cập nhật state nội bộ.

   Mỗi bước **đều clear composer trước** để tránh 1 chiến lược chạy trễ (do
   async) đè/nối lên kết quả của chiến lược trước, gây lặp text.

7. **Chờ hội thoại "ổn định"** (`waitForConversationSettled`) trước khi bấm
   gửi — quan trọng khi tái sử dụng 1 conversation cũ: các lượt chat cũ (ảnh
   cũ) có thể vẫn đang mount vào DOM ngay sau khi trang load xong, nên phải
   đợi số lượng "message turn" trong DOM đứng yên (không tăng thêm) trong
   vài lần poll liên tiếp rồi mới chụp baseline — nếu chụp quá sớm, ảnh cũ
   (đang mount muộn) dễ bị lầm là ảnh mới sinh ra.

8. **Chụp "before" baseline** ngay trước khi bấm gửi: tập hợp toàn bộ
   `<img>` hiện có + "chữ ký" của từng ảnh (`src + alt`, KHÔNG dùng
   width/height vì ảnh cũ có thể chưa load xong kích thước thật lúc chụp) +
   tập hợp các "message turn" (khối `<article>`/phần tử có
   `data-message-author-role`) hiện có trong DOM.

9. **Bấm nút Send** (`[data-testid="send-button"]`, fallback dispatch
   `KeyboardEvent('Enter')` lên composer nếu không tìm thấy nút).

10. **Poll kết quả** — vòng lặp poll mỗi 2 giây, tối đa ~10 phút:
    - Nếu phát hiện text lỗi trên trang (ví dụ "image generation failed") →
      trả lỗi ngay, không chờ hết timeout.
    - Tìm "current user turn" mới: message turn thuộc role `user` xuất hiện
      SAU baseline — đây là điểm mốc để biết ảnh nào nằm SAU nó (thuộc lượt
      trả lời cho đúng prompt vừa gửi), tránh nhầm với ảnh của lượt chat
      trước.
    - Với mỗi `<img>` mới (không có trong baseline theo `src+alt`), lọc theo
      **toàn bộ** điều kiện sau mới coi là "ảnh kết quả thật":
      - Nằm trong 1 message turn có `data-message-author-role="assistant"`
        (không phải ảnh do user vừa tải lên/đính kèm).
      - Nằm SAU "current user turn" mốc ở trên (không phải ảnh cũ trong
        lịch sử conversation).
      - `naturalWidth`/`naturalHeight` > 256px (loại avatar/icon nhỏ).
      - `src` khớp pattern ảnh thật: `blob:...`, hoặc chứa
        `/backend-api/files|estuary|content`, hoặc domain
        `oaiusercontent`, hoặc `data:image/...` — loại `avatar/favicon/
        profile/emoji/icon/sprite` trong URL.
    - Nếu sau ~20s (10 vòng poll) không streaming nữa mà vẫn 0 ảnh, kiểm tra
      xem ChatGPT có trả lời **bằng text** thay vì ảnh không (ví dụ từ chối
      vẽ, hoặc hỏi lại) → nếu có, trả lỗi kèm nội dung text đó luôn (để
      người dùng biết tại sao không ra ảnh) thay vì cứ poll tới hết timeout.
    - Khi có ≥1 ảnh khớp candidate: yêu cầu ảnh đó phải **"ổn định"** qua
      nhiều lần poll liên tiếp trước khi chấp nhận là kết quả cuối (2 lần
      poll nếu xác định được "current user turn" rõ ràng, 4 lần nếu phải
      dùng fallback yếu hơn) — để tránh lấy 1 ảnh placeholder/thumbnail tạm
      thời trong lúc ChatGPT còn đang generate (ảnh preview độ phân giải
      thấp hay đổi `src` liên tục trong khi đang vẽ).
    - Khi ảnh đã ổn định: `fetch(src)` để lấy bytes thật (thử không kèm
      credentials trước, rồi thử `credentials:'include'` nếu fail), nếu cả
      2 đều fail thì fallback vẽ `<img>` ra `<canvas>` rồi `toDataURL()` để
      lấy bytes (dự phòng khi ảnh bị chặn CORS fetch nhưng vẫn render được
      trên trang). Convert sang base64, gọi ngược `invokeResult([{b64, ext}])`.

11. **Timeout**: nếu quá thời gian (10 phút poll JS nội bộ, hoặc 11 phút chờ
    ở phía Rust) mà không có kết quả ổn định → trả lỗi timeout. Nếu suốt quá
    trình có thấy `src` ảnh xuất hiện nhưng không bao giờ "ổn định" được →
    báo lỗi kèm danh sách `src` đã từng thấy (để debug việc tại sao không
    chốt được kết quả).

12. **Trả kết quả về Rust**: JS gọi `invoke("chatgpt_gen_result", {accountId,
    reqId, images, error})`. Phía Rust có 1 map `reqId → oneshot channel`
    (tạo lúc bắt đầu bước tiêm script) — nhận được callback này thì resolve
    đúng channel đó, "wake up" đoạn code Rust đang `await` kết quả.
    **`reqId`** là UUID sinh mới cho **mỗi lượt gọi automation**, dùng để
    match đúng callback với đúng lượt gọi (vì có thể có nhiều account chạy
    song song, mỗi account 1 cửa sổ riêng, nhưng vẫn cần cơ chế định danh
    chắc chắn không nhầm request giữa các lượt liên tiếp trên CÙNG 1 account).

13. **Ghi file, cập nhật DB**: Rust nhận được `(bytes, ext)` → ghi file local
    (`Downloads/POD Ultimate Kit/images/<epoch>_<slug>_<jobShortId>/
    img_NN.<ext>`) → cập nhật `image_jobs.image_paths_json` (append đường
    dẫn) → (tuỳ chọn) upload file đó lên storage ngoài (S3/R2) để có URL
    public, lưu vào `image_urls_json` song song theo đúng index → phát event
    "job progress" cho UI biết có ảnh mới → nếu đã đủ `count` ảnh yêu cầu,
    đánh dấu job `status='done'`.

## 6. Xử lý lỗi & retry

Ở mức job (không phải mức JS bên trong 1 lượt gọi), vòng lặp
`run_image_job` gọi `chatgpt_generate_one` tối đa `count * 2` lần (để bù
trường hợp 1 lượt gọi trả về ít hơn ảnh cần), và phân loại lỗi trả về:

- **Lỗi "fatal"** (dừng retry ngay, không thử lại): lỗi chứa các cụm từ như
  "không upload được ảnh tham chiếu", "timeout", "hết thời gian chờ", "đăng
  nhập" (phiên hết hạn), "kết nối lại", "giao diện" (đổi UI). Match theo
  **substring** trên message lỗi tiếng Việt/Anh cụ thể — nếu bạn viết lại ở
  ngôn ngữ khác, nên đổi cơ chế này thành **error code/enum** thay vì string
  match, để tránh lỗi tinh tế (ví dụ chuỗi có dấu vs không dấu không khớp).
- **Lỗi khác** (ví dụ ChatGPT tạm thời báo lỗi tạo ảnh, hoặc chưa ra ảnh kịp):
  sleep 2s rồi thử lại lượt gọi tiếp theo, tới khi đạt `count` ảnh hoặc hết
  số lần thử.
- Nếu cuối cùng 0 ảnh nào tạo được: xoá thư mục kết quả rỗng, đánh dấu job
  `status='error'` kèm lỗi cuối cùng gặp phải.
- Nếu tạo được 1 phần (ví dụ cần 4 ảnh, chỉ ra được 2): vẫn đánh dấu
  `status='done'` nhưng kèm `error` = lỗi khiến phần còn lại thất bại (job
  "thành công một phần").

## 7. Ghép prompt cuối cùng gửi cho ChatGPT

Prompt người dùng nhập không gửi thẳng — được bọc thêm các chỉ dẫn kỹ thuật:

```
Tạo một hình ảnh, tỉ lệ khung hình {aspect}.
[nếu có ref ảnh] Dựa trên các ảnh tham chiếu đã đính kèm.
[nếu có style] Phong cách thiết kế: {style}.
[nếu transparent_bg=true] Xuất ảnh dạng PNG với nền trong suốt (transparent
background), không vẽ nền/phông sau, chỉ giữ chủ thể chính.
Chỉ trả về ảnh, không hỏi lại.

{prompt gốc của người dùng}
```

Việc "Chỉ trả về ảnh, không hỏi lại" là chỉ dẫn quan trọng — ChatGPT có xu
hướng hỏi lại làm rõ yêu cầu trước khi vẽ nếu không được nhắc thẳng.

## 8. Checklist tối thiểu để implement lại

1. Chọn công cụ điều khiển browser hỗ trợ: multi-profile độc lập cookie +
   tiêm JS + JS gọi ngược được vào code điều khiển (Electron BrowserView,
   Playwright persistent context + `page.exposeFunction`, CDP thủ công...).
2. Model dữ liệu account: id, label, đường dẫn profile riêng, cờ
   "đã đăng nhập" (đọc lại cookie đã lưu, không hỏi trực tiếp mỗi lần).
3. Luồng login: mở cửa sổ thấy được, tiêm script poll tìm composer thật xuất
   hiện → verify có cookie session hợp lệ → lưu cookie ra file/DB → đóng cửa
   sổ.
4. Job queue bằng DB (hoặc in-memory nếu single-process, nhưng SQLite rẻ và
   cho phép nhiều worker claim atomic qua transaction).
5. 1 worker loop/account, khoá tuần tự riêng từng account, các account chạy
   song song độc lập.
6. Script automation theo đúng 13 bước ở mục 5 — quan trọng nhất là: xác định
   đúng "before" baseline trước khi gửi, lọc ảnh kết quả bằng
   role=assistant + sau baseline + kích thước tối thiểu + pattern URL, và
   yêu cầu ảnh "ổn định" qua nhiều lần poll trước khi chốt kết quả.
7. Cơ chế match request↔response qua ID duy nhất (không dựa vào thứ tự gọi),
   vì automation chạy bất đồng bộ và có thể có nhiều lượt gọi chồng nhau
   trên các account khác nhau cùng lúc.
8. Selector DOM của ChatGPT **sẽ đổi theo thời gian** — cách ly toàn bộ
   selector vào 1-2 file riêng (như `automation.js`/`ready.js`/`login.js` ở
   đây) để dễ sửa khi OpenAI đổi giao diện, không rải selector khắp code.
