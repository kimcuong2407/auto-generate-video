# Hướng dẫn prompt video REVIEW sản phẩm bằng Veo / Google Flow

Bản chuyển thể từ guide "video quảng cáo" gốc, viết lại cho đúng thể loại **review sản phẩm ngắn**
(TikTok/Reels/TikTok Shop) — khớp với 10 góc kịch bản đã có sẵn trong `lib/scriptAngles.ts` và các
system prompt đang chạy thật (`app/api/projects/[id]/script/generate/route.ts`,
`lib/livestream/promptDefaults.ts`). Dùng khi viết prompt thủ công trên Google Flow, hoặc để hiểu
AI trong app đang sinh `veoPrompt` theo logic nào.

---

## 0. Vì sao review khác quảng cáo — và ràng buộc kỹ thuật không đổi

| | Quảng cáo (ad) | Review |
|---|---|---|
| Trọng tâm | Sản phẩm là ngôi sao, hình ảnh chỉn chu | **Người review** là ngôi sao, sản phẩm là bằng chứng |
| Cảm giác cần đạt | Đẹp, cao cấp, "được dàn dựng" | **Chân thực, chưa qua dàn dựng**, giống quay bằng điện thoại |
| Rủi ro lớn nhất | Sản phẩm/nhãn bị vẽ lại sai | Sản phẩm sai **+ mặt người review đổi giữa các cảnh** |
| Cấu trúc | Hook → Reveal → Demo → Proof → CTA cố định | Tuỳ **góc kịch bản** (unbox/so sánh/before-after/Q&A...) |
| "Quá mượt" | Là mục tiêu | Là **lỗi** — khán giả nghi ngờ AI ngay |

Ràng buộc kỹ thuật Veo vẫn giữ nguyên như guide gốc, không đổi:

- Veo tối đa **8s/clip**, bắt buộc 8s nếu muốn 1080p hoặc dùng reference image → **1 clip = 1 cảnh
  trong mảng `scenes`** của project.
- **Ingredients to Video** nhận tối đa 3 ảnh reference (chủ thể / bối cảnh / style).
- Thoại đặt sau dấu **hai chấm** trong ngoặc kép (`saying: "..."`) — colon syntax, đã kiểm chứng
  ngăn Veo tự sinh phụ đề đè lên video. Đây là cú pháp `SYSTEM_PROMPT` trong app đang dùng.
- Hệ thống tự lấy **khung hình cuối** của clip trước làm khung hình đầu của clip sau
  (image-to-video chaining) — mọi cảnh từ cảnh 2 trở đi phải mô tả hành động **tiếp nối trực tiếp**,
  không bắt đầu bằng tư thế khác.

---

## 1. Hai "Bible" cần chốt trước khi viết prompt

Review có **hai** chủ thể phải giữ nhất quán xuyên suốt, không phải một:

### PRODUCT_LOCK (giống ad, không đổi)

```
PRODUCT_LOCK:
- Tên/nhãn hiển thị trên bao bì: "..."   ← ghi đúng chữ, Veo hay bịa chữ
- Hình dạng, màu/chất liệu, chi tiết bất biến
- Kích thước tham chiếu, cầm 1 tay hay 2 tay
```

Trong app: đây chính là trường `product.visualDescription` — AI vision đọc ảnh thật rồi mô tả, ưu
tiên tuyệt đối so với `material`/`colors` người dùng tự gõ (xem `docs/product-consistency-upgrade.md`).
Nếu không chắc màu, dùng cụm trung tính `"the product shown in the reference image"` thay vì đoán —
đoán sai còn tệ hơn không đoán.

### REVIEWER_LOCK (mới, quan trọng hơn cả PRODUCT_LOCK)

Người review là gương mặt đại diện cho độ tin cậy — đổi mặt/trang phục giữa 2 cảnh là hỏng cả video,
nặng hơn lỗi lệch màu sản phẩm.

```
REVIEWER_LOCK:
- Giới tính, tuổi ước lượng, kiểu tóc/màu tóc, vóc dáng
- Trang phục CỤ THỂ (kiểu dáng + màu) — không đổi giữa các cảnh dù video dài
- Đặc điểm nhận diện riêng: kính, hình xăm, trang sức...
- Chất giọng: giới tính giọng, âm vực, tốc độ nói, tông cảm xúc chủ đạo
- Tư thế cố định: NGỒI tại bàn suốt video (không đứng dậy/đi lại giữa cảnh) — chỉ tay và
  thân trên chuyển động
```

Nếu góc kịch bản là **"Cầm sản phẩm + voiceover, không lộ mặt"** (`hand-hold-voiceover` trong
`scriptAngles.ts`), bỏ hẳn REVIEWER_LOCK — chỉ cần khoá **bàn tay** (màu da, móng tay/không sơn,
trang sức nếu có) vì đây là chủ thể duy nhất lặp lại trong khung hình. Đổi lại: né được toàn bộ rủi ro
"đổi mặt giữa các cảnh" — một cách hợp lý để giảm rủi ro khi không có ảnh người mẫu tốt.

### Bộ ảnh nền tảng

| Ảnh | Nội dung | Dùng cho |
|---|---|---|
| P1 | Sản phẩm cut-out, nền trắng, 3/4 view, chiếm 70-80% khung | slot "object" mọi cảnh |
| P2 | Packshot sản phẩm, ánh sáng thật | cảnh cận cảnh sản phẩm |
| P3 | Bối cảnh trống (bàn, phòng, kệ) — **chưa có sản phẩm/người** | slot "scene" |
| P4 | Style plate: tông màu/ánh sáng/grain thật của video review đời thường | slot "style" |
| P5 | Người review: chân dung + nửa người, **đúng outfit sẽ dùng cho mọi cảnh** | slot "character" (bỏ qua nếu góc `hand-hold-voiceover`) |
| P6 | Cận cảnh bàn tay không trang sức lạ, tông da tự nhiên | slot "object" cho góc chỉ-tay |

> Nếu quay POV cầm điện thoại (selfie style), P5 nên chụp **đúng tư thế đưa tay dài ra như đang tự
> quay** — Veo bám ảnh reference gần với hành động mô tả trong prompt hơn ảnh khác dáng.

---

## 2. Chọn góc kịch bản → cấu trúc cảnh & bộ ref cần chuẩn bị

Review **không có 1 khung cảnh cố định** như ad (Hook/Reveal/Demo/Proof/CTA). Cấu trúc phụ thuộc góc
kịch bản đã chọn ở Bước 2 của app (`lib/scriptAngles.ts`). Bảng dưới quy đổi nhanh góc → nhịp cảnh →
ảnh ref trọng tâm:

| Góc kịch bản | Nhịp cảnh chính | Ref trọng tâm |
|---|---|---|
| Unboxing | Mở hộp (bắt buộc mở đầu) → khám phá phụ kiện → thử nhanh → CTA | P1, P3, P5 |
| Problem → Solution | Nêu vấn đề (không mở hộp) → đưa sản phẩm vào như giải pháp → demo → CTA+giá | P1, P5 |
| Review trung thực | Giới thiệu "đã dùng được [X thời gian]" → điểm mạnh → **điểm yếu (bắt buộc)** → chấm điểm+CTA | P1, P2, P5 |
| So sánh A/B | Đặt câu hỏi phân vân → mỗi tiêu chí 1 cảnh (2-4 cảnh) → kết luận+CTA | P1, P5 |
| Test/thử thách | Tuyên bố thử thách (hook luôn) → thử nghiệm tăng kịch tính → kết quả+CTA | P1, P5 |
| Before-After | Cảnh "before" (bắt buộc mở đầu) → dùng sản phẩm → "after" tương phản → CTA | P1, P3 |
| Storytelling | Theo dòng thời gian câu chuyện, sản phẩm chỉ xuất hiện tự nhiên 1-2 khoảnh khắc | P1, P3, P5 |
| Q&A | Nêu lý do làm video → mỗi câu hỏi 1 cảnh (3-5) → tổng hợp+CTA | P1, P5 |
| **Chỉ tay + voiceover** | Tay đưa sản phẩm vào khung (hook) → tay thao tác lộ chi tiết → (tuỳ chọn) tay mời chốt đơn | P1, **P6**, KHÔNG P5 |
| Demo công năng | Demo tính năng ấn tượng nhất ngay (hook, không intro) → mỗi cảnh 1 tính năng → chốt tổng thể+CTA | P1, P5 |

Mỗi cảnh vẫn theo nguyên tắc **1 clip = 1 nhịp duy nhất**: một chuyển động camera, một hành động. Với
review, "một hành động" thường là *một câu nói + một cử chỉ tay* — đừng nhồi thêm cử chỉ thứ hai chỉ
để cảnh đỡ tĩnh, đó là nguyên nhân chính gây morph tay/sản phẩm.

---

## 3. Công thức prompt — 7 khối (khớp đúng logic AI trong app)

Viết thành **một đoạn văn liền mạch**, đủ 7 nội dung sau (không cần ghi nhãn ra prompt):

```
(1) Subject   — REVIEWER_LOCK y hệt mọi cảnh (hoặc chỉ bàn tay nếu góc không lộ mặt) + PRODUCT_LOCK,
                đang NGỒI tại bàn cố định.
(2) Action    — một cử chỉ tay duy nhất, tiếp nối trực tiếp hành động kết cảnh trước (từ cảnh 2 trở đi).
                Ràng buộc tay/chân: đúng 2 tay 2 chân, không cầm nhiều vật cùng lúc, không cử chỉ
                nhiều khớp (đếm ngón, xoè ngón, ký hiệu tay).
(3) Scene     — bối cảnh quay chung đã chốt (1 lần, lặp lại y nguyên mọi cảnh).
(4) Style     — cỡ cảnh, góc máy, chuyển động máy — NẾU là góc chủ quan/selfie, thêm đúng cú pháp
                "(thats where the camera is)" ngay sau vị trí camera.
(5) Dialogue  — "<mô tả giọng REVIEWER_LOCK>, speaks in Vietnamese, saying: \"<thoại nguyên văn>\""
                — bắt buộc dấu hai chấm trước ngoặc kép, không dịch sang tiếng Anh.
(6) Sounds    — 1 câu bắt đầu "Audio:" mô tả âm thanh nền cụ thể, tránh nhạc nền chung chung.
(7) Technical — "no subtitles, no captions, no on-screen text" + "natural hand anatomy, exactly two
                hands, exactly two arms, no extra limbs" + từ khoá chống giả trân (mục 3.1).
```

### 3.1 Từ khoá bắt buộc để KHÔNG giống quảng cáo

Đây là khác biệt lớn nhất so với ad — thêm chủ động vào mọi prompt review:

- **Dùng**: `shot on iPhone`, `handheld`, `natural imperfections`, `authentic`, `unretouched`,
  `realistic skin texture`, `candid`, `slightly grainy, film-like`.
- **Tránh tuyệt đối**: `perfect`, `flawless`, `glossy`, `pristine`, `studio-perfect`, `hyper-smooth`,
  `CGI`, `3D render`, `waxy skin`.
- Chuyển động máy: ưu tiên `slight handheld shake` thay vì `smooth gimbal` — máy quá mượt là dấu hiệu
  đầu tiên khán giả nhận ra "video AI, không phải review thật".

### Ví dụ hoàn chỉnh — cảnh "điểm yếu" trong góc Review trung thực

> A woman in her late twenties with shoulder-length wavy brown hair, wearing the same cream oversized
> tee as previous scenes, sits at a sunlit wooden desk, phone-camera framing from the chest up, holding
> the phone at arm's length (thats where the camera is), her arm visible at the frame edge. She picks up
> the matte-black 250ml serum bottle with its kraft-paper label and gold cap — continuing directly from
> setting it down in the previous scene — and turns it slightly to show the pump mechanism sticking
> slightly on the first press, natural movement, slightly grainy, film-like, shot on iPhone, authentic
> unretouched skin texture. The woman has a calm, slightly husky mid-range voice, speaks in Vietnamese,
> saying: "Điểm mình chưa thích là cái vòi bơm hơi cứng, phải ấn hai lần mới ra đủ." Audio: quiet room
> tone, faint pump click, no background music. Technical: no subtitles, no captions, no on-screen text,
> natural hand anatomy, exactly two hands, exactly two arms, no extra limbs.

---

## 4. Xử lý lỗi sản phẩm/người không khớp ảnh reference

Nguyên tắc gốc không đổi: Veo **vẽ lại** chủ thể từ ảnh ref làm gợi ý, không dán ảnh vào. Review có
**hai** chủ thể cần giữ (sản phẩm + reviewer) nên rủi ro nhân đôi — áp dụng cùng cách xử lý cho cả hai:

1. **Đừng để Veo tự vẽ** — với cảnh cận cảnh sản phẩm/mặt là tâm điểm, dựng ảnh tĩnh hoàn chỉnh bằng
   Nano Banana trước (product + reviewer đã ghép đúng), duyệt kỹ, rồi mới đưa vào Veo ở chế độ
   **Image-to-Video**/**Frames to Video** — drift thấp hơn hẳn Ingredients.
2. **Giới hạn chuyển động của cả sản phẩm lẫn khuôn mặt**: máy locked hoặc rung nhẹ tại chỗ, không xoay
   360°, không đổi từ cận cảnh sang toàn cảnh trong 1 clip.
3. **Một ảnh = một góc**, một slot = một chủ thể. Đừng nhét cả ảnh chân dung lẫn ảnh full-body của cùng
   reviewer vào 2 slot khác nhau — model sẽ trung bình hoá thành 2 người hơi khác nhau.
4. **Chữ trên nhãn gần như không giữ được bằng prompt** — bố cục để tay che một phần nhãn, hoặc overlay
   logo thật ở hậu kỳ nếu cần chuẩn xác tuyệt đối.
5. **Khoá canonical look sớm**: gen 4 variant cho cảnh đầu tiên (mở hộp/hook) → chọn frame có cả mặt
   reviewer lẫn sản phẩm đúng nhất → dùng làm first frame cho mọi cảnh sau qua image-to-video chaining.
   Sai đều nhau qua các cảnh khó nhận ra hơn nhiều so với mỗi cảnh lệch một kiểu.
6. **Cách né triệt để lỗi mặt đổi**: chọn góc kịch bản `hand-hold-voiceover` khi không có ảnh reviewer
   tốt — bỏ hẳn REVIEWER_LOCK, chỉ còn 1 chủ thể (sản phẩm + bàn tay) cần giữ nhất quán.

---

## 5. Bảng lỗi thường gặp (bản review)

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Video "trông quá quảng cáo", mất cảm giác review thật | Ánh sáng/chuyển động máy quá mượt, thiếu từ khoá chân thực | Thêm `handheld`, `natural imperfections`, `slightly grainy`; đổi `smooth gimbal` → `slight handheld shake` |
| Mặt reviewer đổi giữa các cảnh | Mỗi cảnh mô tả REVIEWER_LOCK khác từ ngữ, hoặc dùng nhiều ảnh ref khác góc | Dùng **nguyên văn** 1 đoạn REVIEWER_LOCK cho mọi cảnh; 1 ảnh P5 duy nhất |
| Reviewer đột nhiên đứng dậy/đổi vị trí giữa cảnh | Thiếu ràng buộc tư thế trong Action | Luôn nhắc "NGỒI tại bàn, chỉ tay/thân trên chuyển động" |
| Chữ trên nhãn biến dạng | Camera chuyển động + sản phẩm nhỏ trong khung | Locked/rung nhẹ, sản phẩm ≥30% khung, giữ yên 2s |
| Xuất hiện phụ đề tự động | Thiếu colon syntax hoặc thiếu negative | `saying: "..."` + luôn có `no subtitles, no captions, no on-screen text` |
| Cảnh sau không tiếp nối cảnh trước (giật, đổi tư thế đột ngột) | Không mô tả rõ tư thế kết cảnh trước khi viết cảnh sau | Viết cảnh sau bắt đầu đúng bằng tư thế/vị trí cảnh trước kết thúc (image-to-video chaining) |
| Biểu cảm/giọng điệu giả tạo, "quá tươi cười" | Thiếu chỉ dẫn micro-expression tự nhiên | Thêm micro-expression cụ thể (hơi cau mày, dừng 1 nhịp trước khi nói) thay vì "smiling happily" chung chung |
| Vật thể/người nhân đôi | 2 slot ref cùng chủ thể | Mỗi slot Ingredients một vai trò riêng biệt |

---

## 6. Checklist chạy nhanh

1. [ ] Chọn 1 góc kịch bản trong 10 góc có sẵn (`lib/scriptAngles.ts`) — quyết định luôn cấu trúc cảnh
2. [ ] Viết PRODUCT_LOCK (hoặc lấy từ `visualDescription` đã có) + REVIEWER_LOCK (bỏ qua nếu chọn góc
       chỉ-tay)
3. [ ] Chuẩn bị ảnh nền tảng P1–P6 theo góc đã chọn (bảng mục 2)
4. [ ] Với mọi cảnh có sản phẩm/mặt là tâm điểm: dựng ảnh tĩnh cảnh đó trước bằng Nano Banana, duyệt
       xong mới animate
5. [ ] Viết prompt theo 7 khối (mục 3), luôn nhắc lại nguyên văn REVIEWER_LOCK + PRODUCT_LOCK, luôn có
       từ khoá chống giả trân (mục 3.1)
6. [ ] Gen 4 variant cảnh đầu → khoá canonical frame cho cả mặt lẫn sản phẩm
7. [ ] Export last frame mỗi cảnh làm first frame cảnh sau (chaining)
8. [ ] Hậu kỳ: overlay logo/nhãn thật nếu cần chuẩn xác tuyệt đối
