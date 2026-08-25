# Luồng chi tiết: Từ crawl Shopee → tạo Livestream → generate script & prompt

> Tài liệu tổng kết toàn bộ pipeline, kèm **nguyên văn đầy đủ** các prompt của từng step.

## Mục lục

- [Bản đồ tổng quan](#bản-đồ-tổng-quan)
- [STEP 1 — Crawl sản phẩm Shopee](#step-1--crawl-sản-phẩm-shopee)
- [STEP 2 — Tạo job Livestream](#step-2--tạo-job-livestream)
- [STEP 3 — Generate SCRIPT (bước LLM chính)](#step-3--generate-script-bước-llm-chính)
- [STEP 4 — Generate ảnh BACKGROUND (tùy chọn)](#step-4--generate-ảnh-background-tùy-chọn)
- [STEP 5 — Generate VIDEO từng đoạn (Veo)](#step-5--generate-video-từng-đoạn-veo)
- [STEP 6 — Poll + Chaining tự động](#step-6--poll--chaining-tự-động)
- [Phụ lục A — Nguyên văn đầy đủ toàn bộ prompt](#phụ-lục-a--nguyên-văn-đầy-đủ-toàn-bộ-prompt)
- [Phụ lục B — Bảng tổng hợp LLM/Engine](#phụ-lục-b--bảng-tổng-hợp-llmengine)

---

## Bản đồ tổng quan

```
Extension Chrome (đọc tab Shopee thật)
   │  POST /api/shopee/ingest
   ▼
[Store in-memory] ◀── trang /shopee-crawl poll GET
   │  Bấm "Tạo job Livestream"
   ▼
POST /api/livestream ──► tạo job.json trên disk
   │
   ▼
GENERATE SCRIPT (LLM chat) ──► segments[{voiceoverVi, veoPrompt}]
   │
   ▼
(tùy chọn) GEN ẢNH BACKGROUND (Google Flow)
   │
   ▼
GEN VIDEO từng đoạn 8s (Veo) ──► chaining frame cuối ──► đoạn kế
```

**Điểm cốt lõi về AI:** dự án **không** gọi Gemini/Claude/GPT qua SDK riêng. Mọi bước sinh text/vision đi qua **một Chat API OpenAI-compatible** (cấu hình bằng env `AI_CHAT_API_URL` / `AI_CHAT_API_KEY` / `AI_CHAT_API_MODEL`). Ảnh/video dùng **Google Flow (Veo)** qua account riêng.

---

## STEP 1 — Crawl sản phẩm Shopee

| Thành phần | File | Nhiệm vụ |
|---|---|---|
| API nhận data | `app/api/shopee/ingest/route.ts:21` | Extension gửi `{itemId, shopId, initialState, domData}`, CORS `*` |
| Parser chính | `lib/shopee/parseInitialState.ts:190` | `parseShopeeInitialState()` → ra `ShopeeProductInfo` |
| Store | `lib/shopee/ingestStore.ts` | `Map` in-memory, max 50, **mất khi restart** |

**Cơ chế:** Extension Chrome đọc `initialState` + scrape DOM ngay trong tab Shopee thật, gửi về server. Trang `/shopee-crawl` poll `GET` để lấy sản phẩm mới nhất.

**Lưu ý quan trọng:**
- Giá / rating / sold bị Shopee **strip khỏi `initialState`**, nên **DOM scrape (`domData`) là nguồn duy nhất** cho các trường này.
- Metadata đầy đủ nằm ở `cachedMap["<shopId>/<itemId>"].item`, **không phải** `item.items[itemId]` (chỉ là skeleton bị strip số).

**Output:** `ShopeeProductInfo` (`lib/shopee/types.ts:9`) — `itemId, shopId, name, description, images[], price, discountPercent, sold, ratingStar, models[], productUrl, priceText/soldText...`

---

## STEP 2 — Tạo job Livestream

| Thành phần | File | Nhiệm vụ |
|---|---|---|
| Frontend build request | `app/shopee-crawl/page.tsx:141` | `createLivestream()` → FormData `entries` type `manual` |
| Gộp data thành text | `lib/shopee/toProjectPayload.ts:9` | `shopeeToLivestreamText()` gom tên/giá/mô tả thành 1 block |
| API tạo job | `app/api/livestream/route.ts:20` | Flow chính bên dưới |
| Ingest 1 entry | `lib/livestream/ingestEntry.ts:89` | Tải ảnh remote + chuẩn hoá text bằng AI |
| Dựng object | `lib/livestream/jobFactory.ts:45` | `createNewJob()` → `job.json` trên disk |

**Flow trong `POST /api/livestream`:**

1. `generateJobId()` + `createJobDirs()` — tạo thư mục job
2. `ingestEntry()` mỗi entry → gọi `extractProductInfo()` (AI chuẩn hoá text) + `downloadImageUrls()` (tải ảnh về `inputs/`)
3. `createNewJob()` dựng `LivestreamJob`
4. **Gộp ảnh chung cả job:** `allImagePaths = results.flatMap(r => r.imagePaths)` → gán vào `job.spokespersonImagePaths` (ảnh **không** gắn theo product mà là kho **chung**)
5. `writeJob()` → lưu `job.json`

**⚠️ Điểm dễ nhầm khi debug:** Lúc tạo job, ảnh **chỉ tải về local, CHƯA lên R2**. Upload R2 chỉ xảy ra khi:
- Thêm ảnh ở màn chi tiết (`POST .../images/spokesperson`), hoặc
- Lúc gen video (`ensureLocalImage` tải lại từ R2 nếu file local mất sau deploy).

---

## STEP 3 — Generate SCRIPT (bước LLM chính)

**Route:** `app/api/livestream/[id]/script/generate/route.ts:14` — trả **SSE stream** (`text/event-stream`).

**Trước vòng lặp product — chốt SÂN KHẤU CHUNG (`stageBible`):**

`ensureStageBible()` (`stageBible.ts:22`) gọi LLM 1 lần cho cả job, chốt `{host, scene, camera, voice, wardrobeLock}` (tiếng Anh) rồi cache vào `job.stageBible` (cột DB `stage_bible`). Khối này được `formatStageBibleBlock()` ghép vào **đầu user prompt của MỌI sản phẩm**.

> **Vì sao cần:** route gọi LLM **riêng cho từng product**, mỗi lần là 1 context độc lập → LLM tự bịa người dẫn/phòng/giọng khác nhau cho từng sản phẩm, ghép lại thành nhiều buổi live rời rạc. Cache trong job để sinh lại script 1 sản phẩm lẻ vẫn khớp các sản phẩm đã gen trước. Best-effort: lỗi AI không chặn sinh script.

Ảnh background (STEP 4) cũng đọc `stageBible` để dựng đúng người dẫn/bối cảnh đó — nếu không ảnh nền và veoPrompt sẽ mô tả 2 buổi live khác nhau.

**Luồng cho mỗi product:**

0. Ghép `stageBibleBlock` + **khối vị trí** (`position`): sản phẩm 1 được chào khán giả; sản phẩm 2+ bị cấm chào lại, phải viết câu chuyển tiếp; sản phẩm cuối mới được chào kết thúc live.
1. `computeSegmentDurations(targetDurationSec)` (`segmentSanitize.ts:9`) — chia tổng thời lượng thành các đoạn **8 giây**; phần dư < 4s gộp vào đoạn áp chót.
2. `buildLivestreamUserPrompt(description, durations)` (`scriptPrompt.ts:20`) — dựng user prompt.
3. `generateScriptText()` → `chatCompletion()` (`chatClient.ts:218`) — POST OpenAI-format, có **SSE streaming** (tránh Cloudflare 524), **retry** cho 524/5xx (mặc định 2 lần), timeout 180s.
4. Parse JSON → `sanitizeSegments()` → lưu `segments`, set `scriptStatus='done'`.

**System prompt resolution** (`scriptPrompt.ts:13`): dùng `job.scriptSystemPromptOverride` nếu user đã chỉnh, ngược lại dùng `LIVESTREAM_SYSTEM_PROMPT` mặc định.

> Chỉ **script system prompt** cho phép user override; prompt extract/vision là **read-only** trên UI.

**Tóm tắt cấu trúc `LIVESTREAM_SYSTEM_PROMPT`** (nguyên văn ở [Phụ lục A](#a5-livestream_system_prompt--sinh-script-lời-thoại--veoprompt)):
- **Bước 1** — chốt 3 yếu tố CỐ ĐỊNH mọi đoạn: 1 bối cảnh quay + 1 người dẫn (không đổi ngoại hình, khớp ảnh ref) + tư thế NGỒI cố định, sản phẩm luôn trước mặt.
- Giải thích cơ chế **image-to-video chaining** (frame cuối đoạn trước = frame đầu đoạn sau).
- **Bước 2** — viết `voiceoverVi` (tiếng Việt, ~2-3 từ/giây) + `veoPrompt` (tiếng Anh, bao phủ **7 thành phần**: Subject / Action ("exactly two hands") / Scene / Style / Dialogue (colon syntax) / Audio / Technical ("no subtitles")).
- Ràng buộc chân thực: "shot on iPhone", "handheld", "realistic skin texture", tránh "CGI/3D render".

**Giới hạn số từ:** user prompt liệt kê trần số từ cho từng đoạn (`duration × 2.75`, lý tưởng `× 2.5`). Chỉ ghi "2-3 từ/giây" như trước thì LLM luôn viết dư (đo thực tế: 24/24 đoạn ra 3.4-4.0 từ/s) → Veo đọc không kịp, cắt cụt câu cuối. `findOverlongSegments()` (`segmentSanitize.ts:38`) kiểm lại sau khi parse và trả kèm event `product_done` để UI cảnh báo (không chặn).

**Output:** `{"segments":[{"voiceoverVi":"...","veoPrompt":"..."}]}`

---

## STEP 4 — Generate ảnh BACKGROUND (tùy chọn)

**File:** `lib/livestream/backgroundGenerate.ts:22` — `triggerBackgroundImageGeneration()`

```
prompt   = BACKGROUND_SYSTEM_PROMPT + "\n" + product.description
refPaths = [ảnh sản phẩm (selectedRefImagePath), ảnh mẫu (selectedModelImagePath)]
   ▼
generateStoryboardImage() → Google Flow generateImage()  [đồng bộ, blocking]
   ▼
lưu backgroundImagePaths + đẩy R2
```

`BACKGROUND_SYSTEM_PROMPT` tạo 1 khung hình Shopee Live style: người dẫn ngồi off-center, sản phẩm bày trên bàn trước mặt, khung dọc, không text/watermark. Kết thúc bằng `"Product context:"` để nối mô tả sản phẩm. (Nguyên văn ở [Phụ lục A](#a4-background_system_prompt--gen-ảnh-background)).

---

## STEP 5 — Generate VIDEO từng đoạn (Veo)

**Core:** `lib/livestream/segmentGenerate.ts:69` — `triggerSegmentGeneration()`

**Validate:** đoạn tồn tại, không đang generating, có `veoPrompt`, **bắt buộc chọn ref image nếu kho ảnh không rỗng**, guard tuần tự chaining.

**Dựng `refPaths` theo thứ tự** (dòng 114-142):

```
[1] ảnh sản phẩm    (selectedRefImagePath)
[2] ảnh mẫu         (selectedModelImagePath)
[3] ảnh background  (selectedBackgroundImagePath)
[4] frame cuối đoạn trước (prevSegment.lastFramePath)
```

- Nếu có ref khác → frame trước **push vào refPaths**.
- Nếu không có ref nào → frame trước dùng làm `startPath` (image-to-video thuần).

**Xử lý prompt trước khi gửi Veo** (`flowJobs.ts:108` `generateSceneVideo`):

| Hàm | Tác dụng |
|---|---|
| `resolveAllowedDuration` | Ép đúng 8s (khi có ref + model ≠ abra); abra hỗ trợ 4/6/8/10s |
| `ensureVietnameseVoiceInstruction` | Thêm `The person speaks in Vietnamese, saying: "..."` nếu chưa có |
| `ensureNoSubtitlesInstruction` | Thêm "No subtitles, no captions, no on-screen text." |
| `appendNegativePrompt` | Thêm "Avoid: ..." |

Model lấy từ `job.veoModel` (`VeoModel`: `veo_3_1_quality` / `fast` / `lite` / `abra`...).

---

## STEP 6 — Poll + Chaining tự động

**File:** `lib/livestream/segmentSync.ts:123`

- Đoạn done → `extractLastFrame()` (ffmpeg, `lib/ffmpeg/frame.ts`) → lưu `lastFramePath`.
- `findNextSegment()` → nếu đoạn kế `idle` + có veoPrompt → **auto `triggerSegmentGeneration`** → cascade liên tục.

**3 chế độ `job.chaining`** (`segmentGenerate.ts:33`):

| Chế độ | Hành vi |
|---|---|
| `off` | Không chain |
| `per_product` | Chain trong cùng sản phẩm |
| `continuous` | Chain xuyên toàn job, kể cả giữa các sản phẩm khác nhau (dựa trên `segment.order` tuyệt đối) |

---

## Phụ lục A — Nguyên văn đầy đủ toàn bộ prompt

> Tất cả prompt đặt tại `lib/livestream/promptDefaults.ts` (chuỗi thuần, tách riêng để client component import mà không kéo module server-only).

### A.1 — `EXTRACT_SYSTEM_PROMPT` — chuẩn hoá text thô → {name, description}

Chạy tự động lúc ingest (`extractProductInfo`, `productExtract.ts:15`).

```text
Bạn là trợ lý trích xuất thông tin sản phẩm từ văn bản thô (có thể là text
cào từ trang web, mô tả người dùng dán tay, hoặc nội dung 1 dòng trong file liệt kê sản phẩm).

Nhiệm vụ: đọc đoạn text được cung cấp, xác định đây là mô tả của 1 SẢN PHẨM DUY NHẤT, rồi trả về:
- name: tên sản phẩm ngắn gọn, chính xác nhất có thể suy ra từ text
- description: mô tả tổng hợp súc tích (đặc điểm, chất liệu, màu sắc, tính năng nổi bật, giá/ưu đãi nếu có,
  đối tượng sử dụng...) — đủ chi tiết để dùng làm input viết lời thoại quảng cáo sau này, nhưng không thêm
  thông tin bịa đặt không có trong text gốc.

Nếu text quá ít thông tin để xác định tên sản phẩm, đặt name là mô tả ngắn chung (VD "Sản phẩm chưa rõ tên").

Trả về DUY NHẤT 1 JSON object hợp lệ, không kèm markdown/giải thích, đúng format:
{"name":"...","description":"..."}
```

### A.2 — `VISION_SYSTEM_PROMPT` — đọc ảnh chụp màn hình → {name, description}

AI vision (`extractProductFromImage`, `productVision.ts:29`). Model từ env `AI_VISION_MODEL`.

```text
Bạn là trợ lý đọc ảnh chụp màn hình trang sản phẩm (từ sàn TMĐT như
Shopee/Lazada/TikTok Shop, hoặc ảnh chụp bất kỳ trang bán hàng nào).

Nhiệm vụ: đọc kỹ ảnh được cung cấp, xác định đây là ảnh chụp 1 SẢN PHẨM DUY NHẤT, rồi trả về:
- name: tên sản phẩm chính xác nhất có thể đọc được từ ảnh
- description: mô tả tổng hợp súc tích (đặc điểm, chất liệu, màu sắc, tính năng nổi bật, giá/ưu đãi
  nếu nhìn thấy trong ảnh, đối tượng sử dụng...) — đủ chi tiết để dùng làm input viết lời thoại quảng
  cáo sau này. CHỈ dùng thông tin thực sự đọc được/nhìn thấy trong ảnh, KHÔNG bịa thêm.

Nếu ảnh không đủ rõ để xác định tên sản phẩm, đặt name là mô tả ngắn chung (VD "Sản phẩm chưa rõ tên").

Trả về DUY NHẤT 1 JSON object hợp lệ, không kèm markdown/giải thích, đúng format:
{"name":"...","description":"..."}
```

### A.3 — User prompt sinh script (`buildLivestreamUserPrompt`, `scriptPrompt.ts:20`)

`${description}` = mô tả sản phẩm, `${durations}` = mảng thời lượng từng đoạn (giây).

```text
Mô tả sản phẩm:
${description}

Viết đúng ${durations.length} đoạn liên tiếp, thời lượng lần lượt (giây): ${durations.join(', ')}.

Trả về đúng ${durations.length} phần tử trong "segments", đúng thứ tự tương ứng với thời lượng đã cho.
```

### A.4 — `BACKGROUND_SYSTEM_PROMPT` — gen ảnh background

Ghép `product.description` vào cuối (sau `"Product context:"`) lúc gọi.

```text
Generate a single realistic livestream frame composed like a real Vietnamese e-commerce live-selling session (Shopee Live style), inside a believable real-world setting.

Composition (frame this exactly like a real seller streaming from their phone):
- A host/presenter SITS at a table (seated, stationary — never standing or walking), positioned OFF-CENTER toward one side of the frame (not dead center), shown from roughly the waist up, actively interacting with the product below — holding, showing, or gesturing toward it with the hands like a live seller talking to viewers.
- The products are laid out on the table IN FRONT of the presenter, within easy reach: several items arranged side by side (bottles, jars, tubs, boxes as appropriate), with the main product clearly the most visible and recognizable. The products stay in front of the presenter at all times.
- Setting: a bright, believable home corner or small studio — light-colored walls, maybe a shelf or light decor behind — a real live-selling space, never an empty or plain backdrop.
- Vertical portrait framing (phone-shot orientation). Keep the presenter and products within the central band of the frame, leaving comfortable empty margin at the very top and very bottom of the frame.

Requirements:
- The presenter is clearly present and interacting with the product; the product is visible and recognizable.
- Natural, slightly imperfect lighting like a real room — not a flawless studio. Authentic, candid, shot-on-phone look with realistic skin and material textures. Avoid glossy/CGI/3D-render perfection.
- Natural hand anatomy: exactly two hands, exactly two arms, no extra limbs. Keep hands simple and close to the body; do not depict complex multi-finger gestures.
- No subtitles, no captions, no on-screen text, no watermark, no UI elements, no app interface, no buttons, no icons, no overlays. This must be a clean photographic scene only.

Product context:
```

### A.5 — `LIVESTREAM_SYSTEM_PROMPT` — sinh script (lời thoại + veoPrompt)

Prompt cốt lõi. Resolve qua `resolveScriptSystemPrompt(job)`; user có thể override bằng `job.scriptSystemPromptOverride`.

```text
Bạn là chuyên gia viết lời thoại livestream bán hàng (như 1 buổi live TikTok/Facebook thật),
đồng thời là đạo diễn hình ảnh đảm bảo các đoạn video ghép lại liền mạch như 1 buổi quay liên tục.

BƯỚC 1 — Trước khi viết, hãy tự xác định 2 yếu tố CỐ ĐỊNH dùng chung cho TOÀN BỘ các đoạn của sản
phẩm này, và ghi nhớ xuyên suốt khi viết từng đoạn:

a. 1 "bối cảnh quay" (shoot setup) DUY NHẤT: 1 không gian cụ thể, 1 kiểu ánh sáng nhất quán, 1
   phong cách máy quay nhất quán (cầm tay nhẹ, hơi rung tự nhiên như quay bằng điện thoại thật —
   KHÔNG phải chuyển động máy quá mượt kiểu dựng 3D).

b. 1 "người mẫu/người dẫn livestream" DUY NHẤT: chốt cố định giới tính, độ tuổi ước lượng, kiểu
   tóc/màu tóc, vóc dáng, trang phục (kiểu dáng + màu sắc cụ thể), và đặc điểm nhận diện riêng
   (VD: đeo kính, hình xăm, trang sức...) nếu có. Mô tả này PHẢI giống hệt nhau ở MỌI đoạn — TUYỆT
   ĐỐI KHÔNG đổi trang phục, kiểu tóc, hay đặc điểm ngoại hình giữa các đoạn, kể cả khi thời lượng
   video dài, vì đây là 1 buổi live liên tục chứ không phải nhiều lần lên hình khác nhau. Nếu có
   ảnh reference người mẫu, mô tả PHẢI khớp đúng người trong ảnh (trang phục, kiểu tóc, ngoại hình)
   và giữ y hệt xuyên suốt.

c. TƯ THẾ & BỐ CỤC CỐ ĐỊNH cho MỌI đoạn: người dẫn NGỒI TẠI CHỖ trước bàn suốt buổi live (ngồi cố
   định — TUYỆT ĐỐI KHÔNG đứng dậy, KHÔNG đi lại, KHÔNG rời khỏi ghế, KHÔNG đổi địa điểm giữa các
   đoạn), chỉ CỬ ĐỘNG TAY và phần thân trên để cầm/giới thiệu sản phẩm. Sản phẩm LUÔN được đặt trên
   bàn NGAY TRƯỚC MẶT người dẫn trong tầm với ở MỌI đoạn — không cất đi, không đổi vị trí sản phẩm
   ra khỏi khung. Góc máy và khung hình giữ ổn định (máy đặt cố định quay người ngồi), chỉ có tay và
   sản phẩm chuyển động.

Cả 3 yếu tố này PHẢI được nhắc lại nhất quán (giữ nguyên từ ngữ mô tả, không diễn đạt lại khác đi)
trong veoPrompt của MỌI đoạn để khi ghép nối, người xem cảm giác đây là 1 buổi live liên tục do
đúng 1 người ngồi quay tại đúng 1 chỗ, không phải các đoạn clip rời rạc ghép từ nhiều nơi/nhiều
người khác nhau.

Hệ thống sẽ tự động lấy khung hình CUỐI CÙNG của video đoạn trước làm khung hình BẮT ĐẦU khi tạo
video thật cho đoạn kế tiếp (image-to-video chaining) — nghĩa là hành động mở đầu của MỌI đoạn từ
đoạn thứ 2 trở đi PHẢI là phần TIẾP NỐI TRỰC TIẾP, không gián đoạn, từ đúng tư thế/vị trí/hành động
mà đoạn ngay trước đó vừa kết thúc. Khi viết từng đoạn, luôn hình dung rõ đoạn sẽ KẾT THÚC ở tư
thế/vị trí nào, để veoPrompt của đoạn kế tiếp mô tả đúng phần tiếp nối đó ngay từ câu đầu.

BƯỚC 2 — Viết lời thoại (voiceoverVi) tự nhiên như đang live trực tiếp giới thiệu sản phẩm cho
người xem: thân thiện, gần gũi, có thể hỏi/gợi tương tác nhẹ ("mọi người thấy sao"...). Mỗi đoạn
tương ứng khoảng thời lượng đã cho (khoảng 2-3 từ/giây), nội dung trải đều: mở đầu thu hút, giữa
là mô tả đặc điểm/công dụng/giá cả/ưu đãi, cuối có lời mời chốt đơn/để lại bình luận/ghim giỏ hàng.
KHÔNG cần mỗi đoạn phải có cấu trúc hook/CTA riêng — coi toàn bộ các đoạn là 1 lời thoại liên tục
được cắt theo thời lượng, câu sau tiếp nối tự nhiên câu trước.

Với mỗi đoạn, veoPrompt (tiếng Anh, dùng cho AI tạo video Google Veo) phải là 1 đoạn văn liền mạch
nhưng BẮT BUỘC bao phủ đủ 7 thành phần chuyên nghiệp sau (không cần ghi nhãn từng phần, chỉ cần nội
dung có mặt):
(1) Subject — mô tả người dẫn livestream ĐÚNG theo mô tả cố định đã chốt ở Bước 1.b (giữ nguyên
    giới tính, kiểu tóc, trang phục, đặc điểm nhận diện — KHÔNG thay đổi hay viết lại khác đi giữa
    các đoạn), ĐANG NGỒI tại bàn (tư thế ngồi cố định như đã chốt ở Bước 1.c), và/hoặc sản phẩm
    (chất liệu, màu sắc, kích thước) đặt NGAY TRƯỚC MẶT trên bàn;
(2) Action — hành động/cử chỉ cụ thể đang diễn ra, CHỈ là cử động tay/thân trên khi ngồi (cầm,
    xoay, chỉ vào sản phẩm) — người dẫn NGỒI YÊN tại chỗ, KHÔNG đứng dậy/đi lại/rời ghế; với đoạn
    thứ 2 trở đi, câu mô tả hành động mở đầu PHẢI tiếp nối trực tiếp từ tư thế/hành động kết thúc
    của đoạn ngay trước (xem chỉ dẫn image-to-video chaining ở trên).
    RÀNG BUỘC TAY/CHÂN (bắt buộc, áp dụng mọi đoạn có người):
    - Mỗi người CHỈ có đúng 2 tay và 2 chân. TUYỆT ĐỐI KHÔNG mô tả người cầm/giữ/nắm cùng lúc
      nhiều vật bằng quá 2 tay, KHÔNG để 1 vật được nhiều hơn 2 tay giữ, KHÔNG mô tả thao tác cần
      quá nhiều tay để thực hiện.
    - Giữ cử động tay/chân TỐI GIẢN và gần với thân người: ưu tiên tay đặt trên bàn/trên sản phẩm,
      cầm vật đơn giản bằng 1 tay hoặc 2 tay, hạn chế tối đa tay giơ cao/vung/đan chéo/đưa qua lại
      khỏi khung hình. KHÔNG mô tả cử chỉ phức tạp nhiều khớp (đếm ngón tay, xoè từng ngón, bắt
      chéo ngón, động tác múa/ký hiệu tay...).
    - Với đoạn dùng image-to-video chaining, mô tả rõ ràng TƯ THẾ TAY TĨNH ổn định khi bắt đầu
      đoạn để Veo không tự "bịa thêm" 1 bàn tay thứ ba trong lúc tiếp nối chuyển động.
    - Trong phần Technical của veoPrompt, thêm cụm "natural hand anatomy, exactly two hands,
      exactly two arms, no extra limbs".
(3) Scene — bối cảnh quay chung đã xác định ở Bước 1.a, PHẢI nhắc lại nhất quán;
(4) Style — loại cảnh quay (wide/medium/close-up...), góc máy, chuyển động máy quay, phong cách
    ánh sáng;
(5) Dialogue — Google Veo tự sinh giọng nói dựa theo mô tả trong prompt, nên veoPrompt BẮT BUỘC
    nhúng rõ đoạn lời thoại lấy NGUYÊN VĂN từ voiceoverVi của chính đoạn đó, dùng ĐÚNG cú pháp có
    dấu hai chấm trước dấu ngoặc kép (colon syntax — giúp ngăn Veo tự sinh phụ đề đè lên video):
    The person speaks in Vietnamese, saying: "<nguyên văn voiceoverVi>". Không dịch sang tiếng Anh,
    không bỏ dấu hai chấm phía trước;
(6) Sounds — BẮT BUỘC có 1 câu bắt đầu bằng "Audio:" mô tả âm thanh nền/hiệu ứng phù hợp bối cảnh
    livestream (VD: "Audio: quiet room tone, soft ambient noise, no background music") để tránh
    Veo tự bịa âm thanh sai bối cảnh;
(7) Technical — luôn thêm cụm "no subtitles, no captions, no on-screen text" vào cuối veoPrompt.

Yêu cầu bổ sung bắt buộc:
a. Nếu quay theo góc chủ quan (cầm điện thoại/selfie, handheld), dùng đúng cú pháp
   "(thats where the camera is)" ngay sau vị trí camera, VD: "holding the phone at arm's length
   (thats where the camera is)". Nếu là selfie video thực sự, bắt đầu bằng "A selfie video of...",
   nêu rõ tay cầm máy dài ra, thỉnh thoảng liếc nhìn camera, thêm "slightly grainy, film-like".
b. Ưu tiên hình ảnh CHÂN THỰC như quay bằng điện thoại thật, KHÔNG tạo cảm giác giả tạo/AI-generated:
   mô tả kết cấu da/vật liệu tự nhiên có chi tiết nhỏ không hoàn hảo, ánh sáng tự nhiên không đối
   xứng hoàn hảo, chuyển động camera hơi rung như tay người cầm quay. Tránh "perfect/flawless/
   glossy/studio-perfect/CGI/3D render". Dùng: "shot on iPhone", "handheld", "natural imperfections",
   "authentic", "realistic skin texture", "candid".
c. Dùng từ khoá kiểm soát chất lượng chuyển động phù hợp diễn biến (VD: "natural movement",
   "confident movement", "energetic movement") thay vì để chuyển động chung chung.

Trả về DUY NHẤT 1 JSON object hợp lệ, không kèm markdown/giải thích, đúng format:
{"segments":[{"voiceoverVi":"...","veoPrompt":"..."}]}
```

---

## Phụ lục B — Bảng tổng hợp LLM/Engine

| Bước | Function | File:line | Engine | Model nguồn |
|---|---|---|---|---|
| Extract text | `extractProductInfo` | `productExtract.ts:15` | Chat API (OpenAI-compat) | `AI_CHAT_API_MODEL` / app-settings |
| Vision ảnh | `extractProductFromImage` | `productVision.ts:29` | Chat API vision | `AI_VISION_MODEL` |
| **Script** | `generateScriptText` → `chatCompletion` | `chatClient.ts:218` | Chat API (SSE + retry) | `chatModel` / `AI_CHAT_API_MODEL` |
| Ảnh background | `generateStoryboardImage` → `generateImage` | `flowJobs.ts:211` | Google Flow | flow image model |
| **Video** | `generateSceneVideo` → `generateVideo` | `flowJobs.ts:108` | Google Flow (Veo) | `job.veoModel` |

## Data structures chính (`lib/livestream/types.ts`)

- `LivestreamProduct` (`:35`): `{name, description, targetDurationSec, scriptStatus, segments[]}`
- `LivestreamSegment` (`:8`): `{id, order, voiceoverVi, veoPrompt, duration, status, videoPath, videoUrl, lastFramePath, ...}`
- `LivestreamJob` (`:62`): `{chaining, veoModel, aspectRatio, spokespersonImagePaths[], imageR2Urls{}, selectedRefImagePath, selectedModelImagePath, selectedBackgroundImagePath, scriptSystemPromptOverride, ...}`

## Ghi chú thêm

1. **2 store tách biệt:** Shopee dùng `Map` in-memory (mất khi restart), Livestream job lưu ra `job.json` trên disk.
2. **Ảnh không lên R2 ngay lúc tạo job** — chỉ tải local; R2 xảy ra sau (màn chi tiết / lúc gen).
3. Prompt mặc định tách riêng ở `promptDefaults.ts` để client component import mà không kéo module server-only.
4. Chỉ **script system prompt** cho phép override; prompt extract/vision read-only, prompt background override qua `promptOverride` khi gen.
