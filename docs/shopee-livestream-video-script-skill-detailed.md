# Skill: Shopee Livestream Video Script Generator — Detailed Workflow

> **Ghi chú triển khai (30/08/2026)** — đây là tài liệu SKILL GỐC, giữ nguyên để đối chiếu.
> Bản cài đặt thực tế (Livestream V2) khác có chủ ý ở các điểm sau:
> - **STEP 10 (live comments) KHÔNG triển khai** — Veo dựng chữ tiếng Việt hay sai chính tả, và
>   mục UI livestream đã được gỡ khỏi hướng dẫn veoPrompt. Bỏ hẳn, không phải quên.
> - **INPUT 2 (ảnh phong cách tham chiếu) KHÔNG triển khai** — stage bible tự chốt bối cảnh từ
>   ảnh mẫu + ảnh sản phẩm đang đủ dùng.
> - **STEP 11/12 (physics + claim QA) gộp thành MỘT lượt** và chỉ CẢNH BÁO, không tự viết lại
>   kịch bản — xem `lib/livestream/scriptQa.ts`.
> - **STEP 2 (PRODUCT LOCK)** triển khai ở cấp job, cache lại — xem `lib/livestream/productLock.ts`.
> - **STEP 5 (USP → cảnh demo)** gán bằng code trong bảng cảnh thay vì thêm một lượt gọi AI —
>   xem `assignUspToScenes()` ở `lib/livestream/scriptPromptV2.ts`.
> - **Số cảnh** tính theo giới hạn Veo 4-10s (`computeSegmentDurations`), không theo bảng gợi ý
>   ở STEP INPUT 9.

> Workflow chuẩn: **ảnh MC + ảnh phong cách tham chiếu + ảnh sản phẩm + thông tin sản phẩm → khóa consistency → AIDA → chia cảnh → prompt video chi tiết → 3 câu thoại MC / cảnh → kiểm tra vật lý và claim.**

## 1. Mục tiêu Skill

Skill này dùng để tạo kịch bản video livestream Shopee có thể đưa trực tiếp vào Veo / Flow / Kling / Runway.

Mỗi phân cảnh bắt buộc có:
- **Câu lệnh tạo video**
- **Câu thoại của MC:** đúng **3 câu / cảnh** mặc định

Skill phải đảm bảo:
- Kịch bản theo AIDA.
- MC nhất quán xuyên suốt video.
- Sản phẩm giữ nguyên hình dáng, màu sắc, vật liệu và cấu tạo.
- Không có hành động phi vật lý.
- Không làm sản phẩm tự biến dạng.
- Không tự bịa giá, khuyến mãi hoặc thông số.
- Thoại nghe giống livestream thật, không quá giống TVC.
- Có UI Shopee Live nếu user yêu cầu.

---

# 2. USER GUIDE — Input người dùng cần nhập

## STEP INPUT 1 — Ảnh MC / người mẫu

**Người dùng nhập:**

```text
Ảnh MC:
[Upload 1 hoặc nhiều ảnh]
```

Skill dùng ảnh để khóa:
- Khuôn mặt
- Kiểu tóc
- Kính
- Màu da
- Tuổi ngoại hình
- Trang phục
- Tỷ lệ cơ thể

**Ví dụ theo session:**

```text
Ảnh MC:
Nam người Việt, đầu cạo sát, kính gọng kim loại bạc.
```

---

## STEP INPUT 2 — Ảnh phong cách livestream tham chiếu

**Người dùng nhập:**

```text
Ảnh phong cách:
[Upload ảnh reference]
```

Skill dùng ảnh này để lấy:
- Bố cục livestream
- Tông màu
- Vị trí MC
- Cách bày sản phẩm
- UI livestream
- Badge sale
- Comment
- Hiệu ứng thả tim
- Góc máy

Nếu ảnh có brand khác, chỉ lấy phong cách bố cục, không sao chép brand.

---

## STEP INPUT 3 — Ảnh sản phẩm

**Người dùng nhập:**

```text
Ảnh sản phẩm:
[Upload 1–5 ảnh]
```

Khuyến nghị:
1. Mặt trước
2. Mặt sau
3. Góc nghiêng
4. Ảnh sử dụng thực tế
5. Ảnh kích thước

Skill phải trích xuất:

```text
PRODUCT_SHAPE
PRODUCT_COLOR
PRODUCT_TEXTURE
PRODUCT_SIZE
PRODUCT_COMPONENTS
PRODUCT_HANDLE
PRODUCT_HANGING_METHOD
PRODUCT_USAGE
```

---

## STEP INPUT 4 — Tên sản phẩm

```text
Tên sản phẩm:
Bông Tắm Tròn Tạo Bọt 3D
```

---

## STEP INPUT 5 — Ưu điểm sản phẩm

```text
Ưu điểm:
- Hỗ trợ tẩy da chết nhẹ nhàng
- Làm sạch bụi bẩn và tế bào sừng già
- Tạo bọt tốt
- Tiết kiệm sữa tắm
- Bề mặt mềm
- Massage cơ thể
```

---

## STEP INPUT 6 — Thông tin sản phẩm

```text
Tên đầy đủ:
Công dụng:
Chất liệu:
Kích thước:
Màu sắc:
Đối tượng sử dụng:
Cách sử dụng:
Cách bảo quản:
Lưu ý:
```

**Ví dụ theo session:**

```text
Tên:
Bông Tắm Tẩy Tế Bào Chết Tạo Bọt Tự Nhiên

Công dụng:
Làm sạch, massage cơ thể, hỗ trợ loại bỏ tế bào chết.

Kích thước:
Khoảng 10–15 cm.

Đối tượng:
Phù hợp nhiều loại da.

Bảo quản:
Rửa sạch, vắt nhẹ, treo nơi khô ráo thoáng mát.
```

---

## STEP INPUT 7 — Nền tảng

```text
Nền tảng:
Shopee Live
```

Mặc định: `Shopee Live`

---

## STEP INPUT 8 — Thời lượng

```text
Thời lượng:
60 giây
```

Mặc định: `60 giây`

---

## STEP INPUT 9 — Số phân cảnh

```text
Số phân cảnh:
10
```

Mặc định: `10 cảnh`

Gợi ý:
- 30s → 5–6 cảnh
- 45s → 7–8 cảnh
- 60s → 10 cảnh
- 90s → 12–15 cảnh
- 120s → 15–20 cảnh

---

## STEP INPUT 10 — Số câu thoại MC mỗi cảnh

```text
Số thoại MC / cảnh:
3
```

Mặc định: `3 câu`

---

## STEP INPUT 11 — Thông tin kênh livestream

```text
Tên kênh:
Follower:
Người xem:
```

**Ví dụ theo session:**

```text
Tên kênh:
Homebox - Thế Giới Tiện Ích

Follower:
117k follow

Người xem:
1K đang xem
```

---

## STEP INPUT 12 — Khuyến mãi

```text
Khuyến mãi:
```

Ví dụ:
- Mua 1 tặng 1
- Freeship
- Voucher 20%
- Giá live

Nếu user không cung cấp, không tự bịa.

---

## STEP INPUT 13 — CTA

```text
CTA:
```

Ví dụ:
- Comment HỒNG hoặc XANH
- Bấm sản phẩm đang ghim
- Chốt đơn trên live

---

# 3. FORM USER NHẬP NHANH

```text
### 1. Sản phẩm
Tên sản phẩm:

Ưu điểm:
-
-
-

Thông tin:
- Công dụng:
- Chất liệu:
- Kích thước:
- Màu sắc:
- Cách dùng:
- Cách bảo quản:

### 2. Hình ảnh
Ảnh MC:
[upload]

Ảnh sản phẩm:
[upload]

Ảnh phong cách livestream:
[upload — optional]

### 3. Video
Nền tảng:
Shopee Live

Thời lượng:
60 giây

Số cảnh:
10

Số thoại MC mỗi cảnh:
3

### 4. Livestream
Tên kênh:

Follower:

Người xem:

Khuyến mãi:

CTA:
```

---

# 4. PROMPT CHI TIẾT CỦA TỪNG STEP

## STEP 1 — ANALYZE INPUT

**Prompt:**

```text
Bạn là Product Input Analyzer.

Hãy đọc toàn bộ dữ liệu và ảnh tham chiếu được cung cấp.

Trích xuất dữ liệu thành:

PRODUCT_NAME
PRODUCT_CATEGORY
PRODUCT_FEATURES
PRODUCT_BENEFITS
PRODUCT_USAGE
PRODUCT_MATERIAL
PRODUCT_SIZE
PRODUCT_COLORS
PRODUCT_COMPONENTS
PRODUCT_STORAGE
MC_VISUAL_REFERENCE
STYLE_REFERENCE
PLATFORM
VIDEO_DURATION
SCENE_COUNT
DIALOGUE_COUNT_PER_SCENE
CHANNEL_NAME
FOLLOWER_COUNT
VIEWER_COUNT
PROMOTION
CTA

Quy tắc:
1. Không tự bịa dữ liệu.
2. Phân biệt rõ FEATURE và BENEFIT.
3. Nếu text và ảnh mâu thuẫn về đặc điểm vật lý, ưu tiên ảnh sản phẩm.
4. Trường thiếu dữ liệu ghi UNKNOWN.
5. Không biến claim marketing thành claim y tế.
```

---

## STEP 2 — ANALYZE PRODUCT VISUALLY

**Prompt:**

```text
Bạn là Product Visual Consistency Analyst.

Dựa trên ảnh sản phẩm, mô tả CHỈ các đặc điểm có thể quan sát được:

1. Hình dạng tổng thể
2. Tỷ lệ kích thước
3. Texture bề mặt
4. Màu sắc
5. Các bộ phận cố định
6. Phần cầm
7. Dây treo / suction nếu thật sự nhìn thấy
8. Mức biến dạng hợp lý khi chịu lực
9. Những phần tuyệt đối không được thay đổi

Sau đó tạo PRODUCT LOCK.

Không suy đoán cấu tạo bên trong.
Không tự thêm bộ phận.
```

**Ví dụ:**

```text
PRODUCT LOCK:
- Bông dạng tròn 3D
- Texture xốp mềm
- Màu pastel hồng hoặc xanh nhạt
- Có chi tiết cầm ở chính giữa
- Giữ nguyên độ dày
- Không tự xuất hiện cán dài
- Không biến thành xơ mướp dạng dài
- Không tự đổi màu
```

---

## STEP 3 — BUILD MC LOCK

**Prompt:**

```text
Bạn là Character Consistency Director.

Dựa trên ảnh MC, tạo CHARACTER LOCK gồm:
- kiểu tóc
- kính
- trang phục
- đặc điểm khuôn mặt nổi bật
- tỷ lệ cơ thể
- tư thế livestream
- framing

Giữ nhận diện hoàn toàn nhất quán giữa các cảnh.
```

**Ví dụ session:**

```text
CHARACTER LOCK:
- MC nam
- Đầu cạo sát
- Kính gọng kim loại bạc
- Áo polo đen
- Ngồi sau bàn livestream
- Nhìn vào điện thoại / camera
```

---

## STEP 4 — BUILD ENVIRONMENT LOCK

**Prompt:**

```text
Bạn là Livestream Art Director.

Tạo ENVIRONMENT LOCK từ style reference và yêu cầu user.

Bao gồm:
- phòng livestream bán chuyên tại nhà
- bàn trưng bày
- vị trí tripod
- background
- ánh sáng
- màu chủ đạo
- framing
- UI Shopee Live
- comment
- hearts
- pinned product

Giữ căn phòng giống nhau xuyên suốt video.
Không tự thêm thương hiệu khác từ style reference.
```

---

## STEP 5 — EXTRACT USP

**Prompt:**

```text
Bạn là E-commerce Product Strategist.

Từ PRODUCT_FEATURES và PRODUCT_BENEFITS,
chọn tối đa 5 USP phù hợp nhất cho livestream.

Ưu tiên:
1. Có thể chứng minh bằng hình ảnh.
2. Giải quyết pain point.
3. Hiểu được trong vài giây.
4. Demo an toàn.
5. Không cần claim y tế.

Với mỗi USP trả:

USP:
WHY IT MATTERS:
VISUAL DEMO:
SAFE WORDING:
```

---

## STEP 6 — CREATE AIDA STORY ARC

**Prompt:**

```text
Bạn là Short-form Livestream Script Planner.

VIDEO_DURATION = {VIDEO_DURATION}
SCENE_COUNT = {SCENE_COUNT}

Phân bổ theo AIDA:

ATTENTION: 15–20%
INTEREST: 30–35%
DESIRE: 25–30%
ACTION: 15–20%

Mỗi cảnh ghi:
- mục tiêu
- USP
- hành động MC
- visual demo
- câu nối sang cảnh tiếp theo

Chưa viết prompt video đầy đủ ở bước này.
```

**Với 10 cảnh mặc định:**

```text
Cảnh 1–2: Attention
Cảnh 3–5: Interest
Cảnh 6–8: Desire
Cảnh 9–10: Action
```

---

## STEP 7 — PLAN PHYSICAL ACTION

**Prompt:**

```text
Bạn là Physical Action Director cho AI video.

Dựa trên từng scene plan,
hãy chọn hành động đơn giản, thực tế, dễ sinh video.

Ưu tiên:
- cầm
- xoay
- đặt
- nhấc
- chỉ
- ấn nhẹ
- làm ướt
- xoa
- massage trên cẳng tay

Mỗi cảnh:
- 1 hành động chính
- tối đa 1 hành động phụ

Loại bỏ nếu:
- tay xuyên vật thể
- sản phẩm phải tự bay
- sản phẩm đổi cấu tạo
- quá nhiều chuyển động cùng lúc
- động tác cơ thể không tự nhiên
```

---

## STEP 8 — GENERATE DETAILED VIDEO PROMPT

**Prompt:**

```text
Bạn là AI Video Prompt Director.

Viết prompt video hoàn chỉnh cho SCENE {N}.

INPUT:
PLATFORM = {PLATFORM}
DURATION = {SCENE_DURATION}
CHARACTER_LOCK = {CHARACTER_LOCK}
PRODUCT_LOCK = {PRODUCT_LOCK}
ENVIRONMENT_LOCK = {ENVIRONMENT_LOCK}
SCENE_GOAL = {SCENE_GOAL}
ACTION = {ACTION}
USP = {USP}

Prompt phải gồm:

1. Format
   - dọc 9:16
   - photorealistic
   - livestream e-commerce

2. Character
   - giữ nguyên CHARACTER LOCK

3. Environment
   - giữ nguyên ENVIRONMENT LOCK

4. Product
   - giữ nguyên PRODUCT LOCK

5. Camera
   - shot size
   - focus
   - camera movement

6. Physical action
   - mô tả từng bước
   - chuyển động chậm, tự nhiên

7. Livestream UI
   - chỉ thêm UI cần thiết

8. Negative constraints
   - không biến dạng tay
   - không thêm ngón
   - không đổi sản phẩm
   - không teleport
   - không xuyên vật thể
   - không tự đổi màu
   - không chuyển động phi vật lý
```

---

## STEP 9 — GENERATE 3 MC DIALOGUES

**Prompt:**

```text
Bạn là MC Shopee Live Script Writer.

Viết ĐÚNG 3 câu thoại cho scene.

INPUT:
AIDA_STAGE = {AIDA_STAGE}
SCENE_GOAL = {SCENE_GOAL}
USP = {USP}
VISUAL_ACTION = {ACTION}
PREVIOUS_SCENE = {PREVIOUS_SCENE}
NEXT_SCENE = {NEXT_SCENE}

Quy tắc:
1. Đúng 3 câu.
2. Câu ngắn, tự nhiên.
3. Giọng Shopee Live.
4. Không viết như TVC.
5. MC nói đúng hành động đang diễn ra.
6. Không tự bịa công dụng.
7. Không tự bịa giá/khuyến mãi.
8. CTA mạnh chủ yếu ở phần Action.

Cấu trúc:
Câu 1: Hook / nối cảnh
Câu 2: Thông tin chính
Câu 3: Benefit / interaction / bridge
```

---

## STEP 10 — ADD LIVE COMMENTS

**Prompt:**

```text
Bạn là Shopee Live Interaction Writer.

Nếu cảnh phù hợp, tạo tối đa 1–3 comment ngắn.

Ví dụ:
“Màu hồng còn không shop?”
“Có màu xanh không?”
“Tạo bọt tốt không shop?”
“Dùng xong treo ở đâu?”
“Chốt 2 cái nhé.”

Comment phải liên quan trực tiếp đến cảnh.
Không spam comment ở mọi cảnh.
```

---

## STEP 11 — PHYSICS VALIDATION

**Prompt:**

```text
Bạn là AI Video Physics QA.

FAIL nếu scene có:
1. Sản phẩm tự bay
2. Tay xuyên sản phẩm
3. Tay có thêm/mất ngón
4. Sản phẩm đổi màu vô lý
5. Sản phẩm thay đổi cấu tạo
6. Sản phẩm phình/xẹp bất thường
7. Bọt xuất hiện trước nước/sữa tắm
8. Teleport
9. Động tác vượt giới hạn khớp
10. Vật trên bàn tự di chuyển

Nếu FAIL:
sửa scene thành hành động đơn giản hơn.
```

---

## STEP 12 — CLAIM VALIDATION

**Prompt:**

```text
Bạn là E-commerce Claim Safety Editor.

Ưu tiên wording:
“Hỗ trợ làm sạch.”
“Giúp tạo bọt.”
“Massage nhẹ nhàng.”
“Giúp loại bỏ bụi bẩn trên bề mặt.”
“Có thể giúp tiết kiệm lượng sữa tắm sử dụng.”

Tránh:
“Không bao giờ kích ứng.”
“Diệt khuẩn 100%.”
“Điều trị...”
“Chữa...”
“Chắc chắn kích thích lưu thông máu.”
```

---

# 5. MASTER CONSISTENCY PREFIX

Dùng ở đầu prompt mỗi cảnh:

```text
Video dọc 9:16, photorealistic Shopee livestream.
Giữ nguyên người mẫu từ ảnh tham chiếu xuyên suốt video.
Giữ nguyên khuôn mặt, tóc, kính, trang phục và tỷ lệ cơ thể.
Giữ nguyên phòng livestream, bàn, ánh sáng và vị trí thiết bị.

Sản phẩm phải giống ảnh tham chiếu về hình dạng,
kích thước, độ dày, màu sắc, texture và cấu tạo.

Không tự sinh thêm bộ phận cho sản phẩm.
Không đổi màu sản phẩm.
Không biến dạng sản phẩm bất thường.
Không làm tay xuyên vật thể.
Không sinh thêm ngón tay.
Không teleport.
Mọi thao tác phải thực hiện được trong đời thật.
```

---

# 6. MASTER NEGATIVE PROMPT

```text
Avoid product deformation.
Avoid changing product geometry.
Avoid changing product color.
Avoid extra handles or missing components.
Avoid malformed fingers.
Avoid extra fingers.
Avoid fused hands.
Avoid object teleportation.
Avoid floating objects.
Avoid impossible joint movement.
Avoid instant foam generation.
Avoid excessive foam.
Avoid sudden scene changes.
Avoid changing the host identity.
Avoid changing clothes.
Avoid changing the room.
```

---

# 7. OUTPUT FORMAT BẮT BUỘC

```markdown
## Cảnh 1 — Attention | 0–6s

**Câu lệnh tạo video:**  
[Prompt chi tiết]

**Câu thoại của MC:**
1. “...”
2. “...”
3. “...”

---

## Cảnh 2 — Attention | 6–12s

**Câu lệnh tạo video:**  
[Prompt chi tiết]

**Câu thoại của MC:**
1. “...”
2. “...”
3. “...”
```

Tiếp tục đến hết video.

---

# 8. EXAMPLE THEO SESSION

## Input

```text
Tên sản phẩm:
Bông Tắm Tròn Tạo Bọt 3D

Ưu điểm:
- Hỗ trợ làm sạch và loại bỏ tế bào sừng
- Tạo bọt tốt
- Tiết kiệm sữa tắm
- Bề mặt mềm
- Dùng massage cơ thể

Thông tin:
- Kích thước khoảng 10–15 cm
- Phù hợp nhiều loại da
- Rửa sạch, vắt nhẹ và treo nơi thoáng mát

MC:
Ảnh nam đầu cạo sát, kính bạc

Ảnh style:
Livestream dọc với MC ở giữa,
background đỏ, sản phẩm phía trước,
có UI live và comment

Nền tảng:
Shopee Live

Thời lượng:
60 giây

Số cảnh:
10

Số thoại:
3 / cảnh

Tên kênh:
Homebox - Thế Giới Tiện Ích

Follower:
117k follow

Viewer:
1K đang xem

CTA:
Comment HỒNG hoặc XANH
```

## Output mẫu 1 scene

```markdown
## Cảnh 4 — Interest | 18–24s

**Câu lệnh tạo video:**  
Video dọc 9:16, photorealistic Shopee Live. Giữ nguyên MC nam
đầu cạo sát, kính gọng kim loại bạc, áo polo đen và cùng phòng
livestream bán chuyên tại nhà. Camera close-up vào bàn tay MC và
Bông Tắm Tròn Tạo Bọt 3D màu hồng. Sản phẩm giữ nguyên hình tròn,
độ dày, texture xốp và phần cầm chính giữa như ảnh tham chiếu.
MC tiếp tục xoa bông đã được làm ướt và có một lượng nhỏ sữa tắm
khoảng 2–3 lần. Bọt trắng hình thành dần và chỉ phủ vừa phải trên
bề mặt. Hiển thị một comment nhỏ: “Shop ơi tạo bọt tốt không?”.
Camera tĩnh, focus vào texture và lớp bọt. Không thay đổi cấu tạo
sản phẩm, không tạo bọt tức thời, không thêm ngón tay, không làm
tay xuyên qua sản phẩm và không có chuyển động phi vật lý.

**Câu thoại của MC:**
1. “Cả nhà nhìn lượng bọt lên này.”
2. “Mình chỉ dùng một chút sữa tắm thôi nhé.”
3. “Bọt lên khá đều nên mỗi lần dùng cũng tiết kiệm hơn.”
```

---

# 9. CHECKLIST

```text
[ ] Đã đọc ảnh MC
[ ] Đã đọc ảnh sản phẩm
[ ] Đã lấy style reference nếu có
[ ] Có PRODUCT LOCK
[ ] Có CHARACTER LOCK
[ ] Có ENVIRONMENT LOCK
[ ] Đúng thời lượng
[ ] Đúng số cảnh
[ ] Đúng AIDA
[ ] Mỗi cảnh có Câu lệnh tạo video
[ ] Mỗi cảnh có đúng 3 câu thoại MC
[ ] Không hành động phi vật lý
[ ] Không đổi kết cấu sản phẩm
[ ] Không tự thêm tính năng
[ ] Không bịa giá
[ ] Không bịa promotion
[ ] Không claim y tế quá mức
[ ] Cảnh cuối có CTA
```

---

# 10. QUICK COMMAND

Sau khi user cung cấp đủ dữ liệu:

```text
Hãy tạo kịch bản hoàn chỉnh theo Shopee Livestream Skill.
```

Pipeline:

```text
INPUT
→ PRODUCT ANALYSIS
→ PRODUCT LOCK
→ CHARACTER LOCK
→ ENVIRONMENT LOCK
→ USP
→ AIDA
→ SCENE PLAN
→ PHYSICAL ACTION
→ VIDEO PROMPT
→ 3 MC DIALOGUES
→ PHYSICS QA
→ CLAIM QA
→ FINAL SCRIPT
```
