# Workflow 11 system prompt của module livestream

Tài liệu vận hành cho registry prompt ở `lib/livestream/promptSteps.ts` — mô tả **bước nào chạy lúc
nào, đọc prompt từ đâu, hỏng thì chuyện gì xảy ra**. Dùng khi cần sửa prompt mà không muốn phá luồng
gen, hoặc khi debug kiểu "sửa prompt rồi mà video vẫn như cũ".

Nơi sửa prompt:
- `/settings/prompts` — bản mặc định **toàn hệ thống**, mọi job dùng chung.
- Panel prompt trong trang job (`components/livestream/PromptSettingsPanel.tsx`) — bản **riêng job**,
  luôn thắng bản mặc định.

---

## 0. Cơ chế chung: 3 tầng resolve

Mọi bước lấy prompt qua `promptSet.get(step)` — `lib/livestream/promptStore.ts:47`:

```
bản riêng của job   (ai_prompts.job_slug = '<slug>')
  → bản mặc định toàn hệ thống  (job_slug = '')
    → hằng trong code  (fallbackFor, lib/livestream/promptSteps.ts)
```

Hai chỗ dễ viết sai, đã xử lý sẵn — đừng "tối ưu" lại:

| Điểm | Vì sao |
|---|---|
| Dùng `has()` chứ **không** `\|\|` | Body rỗng là lựa chọn hợp lệ nghĩa **"tắt hẳn"** (quan trọng nhất với `negative_video`). Dùng `\|\|` sẽ nuốt chuỗi rỗng và rơi ngược về mặc định. |
| Bước `script` có **hai** hằng mặc định | V1 = `LIVESTREAM_SYSTEM_PROMPT`, V2 AIDA Shopee = `LIVESTREAM_V2_SYSTEM_PROMPT`. Chọn theo cờ `isV2`; chọn sai thì nút "khôi phục mặc định" trả về prompt của phiên bản kia. |

**`loadPromptSet()` đọc một lần ở đầu mỗi lượt gen** (snapshot), **không cache TTL**. Lý do: app chạy
nhiều process PM2, mỗi process giữ cache riêng → sửa prompt xong bấm gen ngay sẽ ăn bản cũ hay bản mới
tuỳ request rơi vào process nào, lỗi ngẫu nhiên không tái hiện được. Snapshot cũng đúng ngữ nghĩa: gen
32 đoạn mà sửa prompt giữa chừng thì kết quả không bị lai 2 phiên bản.

**`perJob: false`** = bước chạy **trước khi job tồn tại** nên không có job để override — chỉ sửa được
bản mặc định toàn hệ thống.

---

## 1. Giai đoạn tạo job — 3 bước (`perJob: false`)

| # | Bước | Kích hoạt | Code |
|---|---|---|---|
| 1 | `extract` | Dán text thô Shopee / nhập tay → chuẩn hoá tên + mô tả | `lib/livestream/productExtract.ts:17` |
| 2 | `vision_screenshot` | Tải ảnh chụp màn hình trang bán (link bị chặn) → AI đọc ảnh điền tên + mô tả | `lib/livestream/productVision.ts:33` |
| 3 | `v2_field_extract` | Form tạo job V2 → tách text thô thành các ô form (ưu điểm, chất liệu, size, đối tượng…) | `lib/livestream/v2FieldExtract.ts:53` |

Cả 3 đều **không ném lỗi**: AI hỏng hoặc thiếu cấu hình thì trả bộ rỗng để người dùng vẫn mở được form
và tự điền. Chặn ở đây chỉ tổ khiến nút bấm không làm gì cả.

---

## 2. Giai đoạn sinh script — 6 bước tuần tự

Toàn bộ nằm trong **một** request SSE: `app/api/livestream/[id]/script/generate/route.ts`.
Snapshot prompt ở dòng 96, sau đó chạy theo đúng thứ tự dưới đây.

### 4. `product_visual` — mô tả ngoại hình sản phẩm

`route.ts:120`. Chỉ chạy khi job có ảnh sản phẩm đã chọn. Đọc **tất cả** ảnh ref chứ không chỉ ảnh
đầu — các góc còn lại mới cho thấy mặt sau / ngăn / cách đeo. Tính **1 lần cho cả job** vì
`selectedRefImagePaths` dùng chung mọi sản phẩm.

Ảnh dùng ở bước này = giao của `job.scriptRefPaths` (ảnh Mr.D tick trong modal) với
`selectedRefImagePaths`. Phải giao vì lượt này chỉ tả **ngoại hình sản phẩm** — đưa ảnh mẫu/ảnh nền
vào sẽ ra mô tả người hoặc căn phòng.

Best-effort: thiếu `AI_VISION_MODEL`, chưa chọn ảnh, lỗi mạng đều bỏ qua, **không** chặn sinh script.

### 5. `product_lock` — khoá ngoại hình sản phẩm

`lib/livestream/productLock.ts:95`. **Chỉ job V2** (prompt V1 không có chỗ nhận khối này).

Chốt cứng `shape / color / material / size` từ ảnh thật rồi ép mọi cảnh tả đúng món hàng đó.
**Có cache + fingerprint**: đã chốt và input chưa đổi thì không gọi AI lại.

Vì sao cần cache: trước đây `describeProductAppearance` chạy lại từ đầu mỗi lần sinh script và không
lưu ở đâu, nên sinh lại 1 sản phẩm lẻ ra mô tả khác lần trước — cùng món hàng mà `veoPrompt` tả khác
nhau giữa các sản phẩm.

Trả `null` → user prompt rơi về dùng `visualDescription` như cũ, không chặn.

### 6. `stage_bible` — chốt sân khấu buổi live

`lib/livestream/stageBible.ts:78`. **Bước quyết định nhất, và là bước duy nhất có thể làm dừng cả
pipeline.**

Chốt người dẫn / bối cảnh / góc máy / giọng **1 lần cho cả job**. Vì sao bắt buộc: route gọi LLM
**riêng cho từng sản phẩm**, mỗi lần là một context độc lập nên LLM tự bịa người dẫn + phòng + giọng
khác nhau → ghép lại thành nhiều buổi live rời rạc thay vì một buổi live thống nhất.

Bước này gửi **thẳng ảnh** cho model (ảnh mẫu + ảnh sản phẩm + ảnh nền), không chỉ mô tả bằng chữ.
Trước đây chỉ nhận `visualDescription` nên model chưa bao giờ nhìn thấy ảnh mẫu và mặc định bịa ra
"woman" dù ảnh mẫu là nam.

**Tự phát hiện stale** qua `inputsFingerprint` (ảnh mẫu + ảnh sản phẩm + ảnh nền + danh sách sản
phẩm + `scriptRefPaths`) → tự chốt lại dù caller không force. Không có ngoại lệ này thì job đã sinh
script xong bị kẹt vĩnh viễn với người dẫn sai: mọi sản phẩm `scriptStatus='done'` nên "Sinh script
tất cả" không còn target, mà sinh lại từng sản phẩm lẻ thì theo thiết kế vẫn giữ bible cũ.

Xử lý lỗi khác hẳn 5 bước còn lại:

| Tình huống | Hành vi |
|---|---|
| `force=true` (bấm "Chốt lại sân khấu") mà lỗi | Gửi `fatal`, **dừng hẳn, không sinh script** |
| Không force mà lỗi | Gửi `stage_bible_missing` cảnh báo, chạy tiếp best-effort |

Vì sao `force` phải fatal: nuốt lỗi ở đây là hỏng nặng nhất — caller nhận `null` → user prompt **mất
hẳn** khối sân khấu → LLM rơi về "tự chốt người dẫn" và bịa ra người khác, trong khi UI báo thành
công. Đã xảy ra 3 lần liên tiếp trên job production 825314 (32/32 đoạn ra người dẫn nữ dù bible tả
nam).

### 7. `script` — sinh kịch bản

`route.ts:98` (lấy template) + `route.ts:190` (fill + gọi). Vòng lặp **mỗi sản phẩm một lượt gọi LLM**.

System prompt được `fillPromptParams` thay các biến `${...}` theo **từng sản phẩm** — nên phải fill
trong vòng lặp, không fill sẵn ngoài. Bảng biến: `lib/livestream/promptParamsDefs.ts`

`ten_sanpham` · `mota_sanpham` · `thoiluong` · `so_doan` · `uu_diem` · `nen_tang` · `ten_kenh` ·
`khuyen_mai` · `cta` · `so_sanpham` · `vi_tri_sanpham`

User prompt ghép từ: mô tả sản phẩm + `stageBibleBlock` + `productLockBlock` + `visualDescription` +
vị trí trong buổi live. Vị trí tính trên **toàn bộ** sản phẩm của job (không phải trong `targets`) —
gen lại 1 sản phẩm lẻ vẫn phải biết nó nằm giữa buổi live để viết câu chuyển tiếp, không chào lại.

### 8. `shorten` — rút gọn lời thoại quá dài

`route.ts:221`. Chạy ngay sau khi parse JSON, **trước** khi ghi DB. Đoạn nào vượt nhịp nói thì ép AI
viết lại ngắn hơn, **tối đa 2 vòng**.

Vì sao sửa ngay tại đây thay vì chỉ cảnh báo: lời thoại dài quá nhịp thì Veo đọc không kịp, cắt cụt
câu cuối — mà bắt người dùng bấm sinh lại thì lần sinh lại vẫn hay dư.

→ Ghi vào job bằng `mergeSegmentsKeepingVideos` (giữ video của đoạn AI viết ra y hệt cũ; gán thẳng
`segments` sẽ đưa mọi đoạn về idle, mất sạch video đã gen và đốt lại quota Veo), đặt
`scriptStatus='done'`.

### 9. `script_qa` — kiểm duyệt kịch bản

`route.ts:258`. **Chỉ job V2**, chạy **sau khi đã ghi DB**.

Soi lỗi vật lý + lời quảng cáo quá đà, **chỉ cảnh báo, không tự sửa**. Kịch bản đã ghi vào job rồi;
đây là lớp soát cuối để biết cảnh nào đáng sửa **trước khi đốt quota Veo** — chặn đúng chỗ tốn tiền
nhất. Best-effort: lỗi thì trả mảng rỗng.

---

## 3. Ngoài luồng script — 2 bước

### 10. `background` — gen ảnh nền

`lib/livestream/backgroundGenerate.ts:90`. Ưu tiên `promptOverride` (bản nháp đang sửa trên UI, chưa
lưu) → mới hỏi registry.

Gọi `ensureStageBible(jobId)` chứ **không** đọc thẳng `job.stageBible`: bible cũ có thể đã stale, mà
`bibleBlock` lại ép "copy y nguyên, KHÔNG bịa người dẫn khác" nên mô tả sai đó **thắng cả ảnh mẫu**
đính kèm. Đúng ca đã gặp: ảnh mẫu là nam đầu cua đeo kính, bible cũ tả "athletic woman… high
ponytail" → ảnh nền gen ra là nữ.

Thứ tự reference: **ảnh mẫu đứng đầu**, rồi ảnh sản phẩm, rồi ảnh nền. Trước đây ảnh mẫu bị đẩy cuối
sau N ảnh sản phẩm nên model gần như bỏ qua nó.

### 11. `negative_video` — negative prompt gen video

`lib/livestream/segmentGenerate.ts:215`. **Không phải một lượt gọi AI riêng** — gửi kèm **mỗi** lượt
gen video. Chặn tay thừa / sản phẩm biến hình / MC đứng dậy ngay ở tầng gen, thay vì để `script_qa`
đi bắt lỗi sau khi script đã sinh xong.

Ba trạng thái (giữ nguyên ngữ nghĩa `resolveNegativePrompt` cũ):

| Trạng thái DB | Nghĩa |
|---|---|
| Không có row | Dùng negative prompt mặc định |
| Row có nội dung | Dùng nội dung đó |
| **Row rỗng** | Người dùng chủ động **tắt hẳn** negative prompt |

---

## 4. Sơ đồ tổng

```
TẠO JOB ──► extract │ vision_screenshot │ v2_field_extract      (chỉ tầng global)
                              │
SINH SCRIPT (1 SSE request) ──┤
   loadPromptSet(job.slug) ─── snapshot 1 lần
   ├─ product_visual    1×/job    best-effort
   ├─ product_lock      1×/job    V2 · cache + fingerprint
   ├─ stage_bible       1×/job    cache + tự phát hiện stale
   │                             └─ force mà lỗi ⇒ FATAL, không sinh script
   └─ mỗi sản phẩm:
        script ──► shorten (≤2 vòng) ──► [ghi DB] ──► script_qa (V2, chỉ cảnh báo)
                              │
NGOÀI LUỒNG ──────────────────┤
   ├─ background        ensureStageBible trước khi gen
   └─ negative_video    gửi kèm mỗi lượt gen video
```

---

## 5. Khi sửa prompt cần lưu ý

- **`stage_bible` ảnh hưởng rộng nhất**: quyết định toàn bộ video trông thế nào, là bước duy nhất có
  thể làm dừng pipeline, và `background` phải đồng bộ theo nó.
- **Sửa prompt xong bible cũ vẫn được tái dùng** — fingerprint chỉ theo dõi *ảnh và danh sách sản
  phẩm*, không theo dõi nội dung prompt. Muốn áp prompt mới phải bấm **"Chốt lại sân khấu"**
  (`forceStageBible`), thao tác này sinh lại script cho **mọi** sản phẩm hợp lệ kể cả
  `scriptStatus='done'` — chốt bible mới mà giữ script cũ thì bible mới vô tác dụng.
- **Đổi `key` của bước = phải migrate dữ liệu** trong bảng `ai_prompts`. Nhãn hiển thị (`label`,
  `hint`) đổi thoải mái.
- **Xoá row ≠ ghi row rỗng**: `body=null` xoá row → rơi về tầng dưới; chuỗi rỗng ghi row rỗng nghĩa
  "tắt hẳn".

## 6. Self-check liên quan

```bash
npm run check:prompt-registry    # registry khớp danh sách key
npm run check:prompt-wiring      # mọi bước đều có nơi gọi thật
npm run check:prompt-params      # biến ${...} hợp lệ
npm run check:preview-prompt     # preview khớp chuỗi server gửi đi
npm run check:negative-prompt    # 3 trạng thái của negative_video
npm run check:prompt-ref-images  # bộ ảnh ref của từng bước
```
