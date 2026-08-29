# Skill: Shopee Livestream Script Generator

## 1. Mục tiêu

Skill này dùng để tạo **kịch bản livestream Shopee dạng video ngắn** từ thông tin sản phẩm do user cung cấp.

Skill sẽ:
- Phân tích thông tin sản phẩm.
- Xây dựng kịch bản theo mô hình **AIDA**.
- Chia video thành nhiều phân cảnh.
- Mỗi phân cảnh luôn có:
  - **Câu lệnh tạo video**
  - **3 câu thoại của MC**
- Giữ hành động thực tế, tránh chuyển động phi vật lý.
- Giữ nguyên kết cấu, màu sắc và đặc điểm sản phẩm xuyên suốt video.
- Ưu tiên phong cách **livestream bán hàng Shopee chân thực**, dễ dùng với các công cụ tạo video AI như Veo / Flow.

---

# 2. Input user cần cung cấp

## Input bắt buộc

### INPUT_1 — Tên sản phẩm
Ví dụ:

```text
Bông Tắm Tròn Tạo Bọt 3D
```

---

### INPUT_2 — Ưu điểm sản phẩm
User cung cấp danh sách các ưu điểm chính.

Ví dụ:

```text
- Tạo bọt tốt
- Hỗ trợ làm sạch da
- Bề mặt mềm
- Có phần cầm tiện lợi
```

---

### INPUT_3 — Thông tin sản phẩm
Bao gồm các thông tin có thể có:

```text
Tên sản phẩm:
Công dụng:
Chất liệu:
Kích thước:
Màu sắc:
Đối tượng sử dụng:
Cách sử dụng:
Cách bảo quản:
```

Không bắt buộc phải có đầy đủ tất cả trường.

---

## Input tùy chọn

### INPUT_4 — Ảnh người mẫu / MC

Có thể cung cấp:
- 1 ảnh khuôn mặt người mẫu.
- Ảnh toàn thân.
- Ảnh tham chiếu phong cách.

Nếu có ảnh, skill phải yêu cầu giữ:
- Khuôn mặt.
- Kiểu tóc.
- Kính.
- Trang phục.
- Đặc điểm nhận diện.

xuyên suốt tất cả phân cảnh.

---

### INPUT_5 — Ảnh sản phẩm

Khuyến nghị cung cấp từ 1–5 ảnh gồm:

- Mặt trước.
- Mặt sau.
- Góc nghiêng.
- Cách sử dụng.
- Kích thước sản phẩm.

Ảnh sản phẩm là nguồn tham chiếu chính để khóa hình dạng sản phẩm.

---

### INPUT_6 — Thời lượng video

Mặc định:

```text
60 giây
```

Ví dụ khác:

```text
30 giây
45 giây
90 giây
120 giây
```

---

### INPUT_7 — Số phân cảnh

Mặc định:

```text
10 phân cảnh
```

Nếu user không nhập, tự động tính dựa trên thời lượng.

Gợi ý:

| Thời lượng | Số cảnh |
|---|---:|
| 30 giây | 5–6 |
| 45 giây | 7–8 |
| 60 giây | 10 |
| 90 giây | 12–15 |
| 120 giây | 15–20 |

---

### INPUT_8 — Số câu thoại mỗi cảnh

Mặc định:

```text
3 câu thoại / cảnh
```

Nếu user không nhập thì luôn sử dụng 3 câu.

---

### INPUT_9 — Phong cách livestream

Mặc định:

```text
Shopee Live chân thực, bán chuyên tại nhà.
```

Có thể chọn:

```text
Shopee Live
TikTok Shop Live
Studio chuyên nghiệp
Livestream tại nhà
Livestream mỹ phẩm
Livestream đồ gia dụng
Livestream mẹ và bé
```

---

### INPUT_10 — Tên kênh

Ví dụ:

```text
Homebox - Thế Giới Tiện Ích
```

---

### INPUT_11 — Số follower

Ví dụ:

```text
117k follow
```

---

### INPUT_12 — Số người xem

Ví dụ:

```text
1K đang xem
```

---

### INPUT_13 — CTA mong muốn

Ví dụ:

```text
- Comment HỒNG hoặc XANH
- Bấm vào giỏ hàng
- Chốt đơn ngay trên live
- Nhấn vào sản phẩm đang ghim
```

Nếu user không cung cấp, tự tạo CTA phù hợp Shopee Live.

---

### INPUT_14 — Khuyến mãi

Ví dụ:

```text
Mua 1 tặng 1
Freeship
Voucher 20%
Flash Sale
Giá live
```

Nếu không có dữ liệu xác thực, không tự bịa mức giảm giá hoặc giá bán.

---

# 3. Form nhập nhanh cho user

User có thể copy form sau và điền:

```text
Tên sản phẩm:

Ưu điểm:
- 
- 
- 

Thông tin sản phẩm:
- Công dụng:
- Chất liệu:
- Kích thước:
- Màu sắc:
- Cách dùng:
- Cách bảo quản:

Ảnh sản phẩm:
[upload]

Ảnh MC:
[upload]

Thời lượng video:
60 giây

Số phân cảnh:
10

Số câu thoại mỗi cảnh:
3

Nền tảng:
Shopee Live

Tên kênh:

Follower:

Người xem:

Khuyến mãi:

CTA:
```

---

# 4. Workflow xử lý

## STEP 1 — Đọc và chuẩn hóa input

Phân tích toàn bộ thông tin user cung cấp.

Tách thành:

```text
PRODUCT_NAME
PRODUCT_FEATURES
PRODUCT_USAGE
PRODUCT_SIZE
PRODUCT_MATERIAL
PRODUCT_COLORS
PRODUCT_STORAGE
MC_REFERENCE
PRODUCT_REFERENCE
VIDEO_DURATION
SCENE_COUNT
DIALOGUES_PER_SCENE
PLATFORM
CHANNEL_NAME
FOLLOWER_COUNT
VIEWER_COUNT
PROMOTION
CTA
```

Không tự bịa thông tin kỹ thuật mà user chưa cung cấp.

---

# STEP 2 — Xác định USP

Chọn tối đa 3–5 USP quan trọng nhất.

Ưu tiên:

1. Giải quyết vấn đề gì.
2. Demo được bằng hình ảnh.
3. Có lợi ích rõ ràng.
4. Dễ hiểu trong livestream.
5. Có khả năng thúc đẩy mua hàng.

Ví dụ:

```text
USP 1: Tạo bọt tốt.
USP 2: Bề mặt mềm.
USP 3: Hỗ trợ làm sạch.
USP 4: Dễ cầm.
USP 5: Dễ vệ sinh và bảo quản.
```

---

# STEP 3 — Xây dựng AIDA

Phân bổ các cảnh theo:

## A — Attention

Khoảng 15–20% video.

Mục tiêu:
- Hook.
- Đưa vấn đề.
- Cho sản phẩm xuất hiện sớm.

Ví dụ:

```text
Cảnh 1
Cảnh 2
```

---

## I — Interest

Khoảng 30–35% video.

Mục tiêu:
- Demo.
- Giải thích tính năng.
- Cho khách thấy cách sử dụng.

Ví dụ:

```text
Cảnh 3
Cảnh 4
Cảnh 5
```

---

## D — Desire

Khoảng 25–30% video.

Mục tiêu:
- Chuyển tính năng thành lợi ích.
- Cho thấy trải nghiệm.
- Xử lý thắc mắc của khách.

Ví dụ:

```text
Cảnh 6
Cảnh 7
Cảnh 8
```

---

## A — Action

Khoảng 15–20% video.

Mục tiêu:
- Chốt đơn.
- Comment.
- Bấm sản phẩm.
- Ghim sản phẩm.

Ví dụ:

```text
Cảnh 9
Cảnh 10
```

---

# STEP 4 — Khóa consistency

Trước khi tạo từng cảnh, tạo một bộ quy tắc chung.

## Khóa MC

Phải giữ nguyên:

```text
- Khuôn mặt.
- Kiểu tóc.
- Kính.
- Trang phục.
- Tuổi ngoại hình.
- Tỷ lệ cơ thể.
```

---

## Khóa sản phẩm

Phải giữ nguyên:

```text
- Hình dạng.
- Kích thước.
- Độ dày.
- Màu sắc.
- Chất liệu.
- Texture.
- Tay cầm.
- Dây treo.
- Logo nếu có.
```

Không được:

```text
- Tự mọc thêm bộ phận.
- Biến đổi màu.
- Phình hoặc xẹp bất thường.
- Tự thay đổi kích thước.
- Biến thành sản phẩm khác.
```

---

## Khóa bối cảnh

Giữ nguyên:

```text
- Phòng livestream.
- Bàn.
- Ánh sáng.
- Camera angle.
- Background.
- Điện thoại tripod.
```

trừ khi kịch bản yêu cầu thay đổi shot.

---

# STEP 5 — Quy tắc vật lý

Tất cả hành động phải có khả năng thực hiện trong đời thật.

## Cho phép

```text
Cầm sản phẩm.
Đặt lên bàn.
Xoay nhẹ.
Ấn nhẹ.
Rửa.
Làm ướt.
Massage trên tay.
Cầm 2 sản phẩm.
Chỉ vào sản phẩm.
Chỉ xuống giỏ hàng.
```

## Không cho phép

```text
Sản phẩm tự bay.
Sản phẩm teleport.
Tay xuyên qua vật thể.
Sản phẩm tự đổi màu.
Một tay xuất hiện thêm ngón.
Sản phẩm phình/xẹp vô lý.
Bọt xuất hiện tức thời khi chưa có nước.
Bọt phun như hiệu ứng phép thuật.
Tay xoay ngược khớp.
MC thực hiện động tác ngoài giới hạn cơ thể.
```

---

# STEP 6 — Tạo câu lệnh video cho từng cảnh

Mỗi prompt video phải mô tả tối thiểu:

```text
1. Tỷ lệ video.
2. Phong cách.
3. Người mẫu.
4. Bối cảnh.
5. Camera.
6. Sản phẩm.
7. Hành động của MC.
8. UI livestream nếu cần.
9. Chuyển động.
10. Các giới hạn vật lý.
```

Template:

```text
Video dọc 9:16, phong cách Shopee Live photorealistic.
Giữ nguyên MC từ ảnh tham chiếu.
Giữ nguyên phòng livestream và ánh sáng.
MC đang [ACTION].
Sản phẩm [PRODUCT_NAME] phải giữ nguyên hình dạng, màu sắc,
kích thước và kết cấu như ảnh tham chiếu.
Camera [CAMERA SHOT].
Chuyển động tự nhiên và chậm.
Không biến dạng tay, khuôn mặt hoặc sản phẩm.
Không có hành động phi vật lý.
```

---

# STEP 7 — Viết thoại MC

Mỗi cảnh mặc định có:

```text
3 câu thoại.
```

Cấu trúc khuyến nghị:

### Câu 1
Hook / phản ứng / nối tiếp cảnh trước.

### Câu 2
Thông tin chính.

### Câu 3
Lợi ích / tương tác / dẫn sang cảnh sau.

Ví dụ:

```text
1. “Cả nhà nhìn lượng bọt lên này.”
2. “Mình chỉ dùng một chút sữa tắm thôi mà bọt đã khá đều rồi.”
3. “Như vậy mỗi lần tắm mình cũng tiết kiệm sữa tắm hơn.”
```

---

# STEP 8 — Giữ giọng livestream tự nhiên

Không viết giống TVC quá mức.

Ưu tiên từ:

```text
Cả nhà
Mọi người
Shop
Em này
Món này
Mình
Nhìn này
Đây nhé
Comment
Giỏ hàng
Sản phẩm đang ghim
```

Ví dụ tốt:

```text
“Cả nhà nhìn này, mình chỉ dùng một chút sữa tắm thôi nhé.”
```

Không ưu tiên:

```text
“Sản phẩm mang đến trải nghiệm chăm sóc cơ thể đẳng cấp vượt trội.”
```

vì nghe giống quảng cáo dựng sẵn.

---

# STEP 9 — Thêm tương tác Shopee Live

Có thể thêm trong prompt:

```text
- Floating hearts.
- Comment người xem.
- Viewer counter.
- LIVE badge.
- Tên channel.
- Product pinned.
- Shopping cart.
```

Ví dụ comment:

```text
“Màu hồng còn không shop?”
“Có freeship không?”
“Chốt 2 cái nhé.”
“Da nhạy cảm dùng được không?”
“Còn màu xanh không shop?”
```

Comment phải phù hợp nội dung cảnh.

---

# STEP 10 — Kiểm tra claim

Không biến mô tả marketing thành claim y tế.

Ví dụ nên dùng:

```text
“Hỗ trợ làm sạch da.”
“Massage nhẹ nhàng.”
“Giúp loại bỏ bụi bẩn trên bề mặt.”
“Giúp tạo bọt tốt hơn.”
```

Thận trọng với:

```text
“Điều trị...”
“Chữa...”
“Diệt khuẩn 100%...”
“Lưu thông máu chắc chắn...”
“Không bao giờ gây kích ứng...”
```

Nếu user cung cấp claim mạnh nhưng không có bằng chứng, chuyển sang cách diễn đạt an toàn hơn.

---

# 5. Output bắt buộc

Output phải chia rõ từng cảnh.

Không gộp nhiều cảnh thành một prompt.

Format bắt buộc:

```markdown
### Cảnh 1 — Attention | 0–6s

**Câu lệnh tạo video:**  
[prompt video]

**Câu thoại của MC:**
1. “...”
2. “...”
3. “...”

---

### Cảnh 2 — Attention | 6–12s

**Câu lệnh tạo video:**  
[prompt video]

**Câu thoại của MC:**
1. “...”
2. “...”
3. “...”
```

Tiếp tục đến hết số cảnh.

---

# 6. Quy tắc thoại theo thời lượng

Với cảnh khoảng 6 giây:

```text
3 câu phải ngắn.
Mỗi câu khoảng 5–10 từ nếu cần nói đủ trong 6 giây.
```

Nếu 3 câu dài hơn thời lượng cho phép:

- Không tăng tốc giọng quá mức.
- Rút gọn thoại.
- Hoặc tăng thời lượng cảnh.

Ưu tiên giọng livestream tự nhiên.

---

# 7. Quy tắc camera

Ưu tiên các shot dễ tạo bằng AI:

```text
Medium close-up.
Close-up sản phẩm.
Close-up tay.
Static camera.
Slow push-in.
Slow focus shift.
```

Hạn chế:

```text
Camera quay 360 độ.
Chuyển camera quá nhanh.
Nhiều cut trong một cảnh.
MC vừa đi vừa thao tác phức tạp.
Extreme zoom vào tay.
```

---

# 8. Quy tắc demo sản phẩm

Mỗi USP nên có hình ảnh chứng minh.

Ví dụ:

| USP | Demo |
|---|---|
| Tạo bọt | Cho sữa tắm + nước rồi xoa |
| Mềm | Ấn nhẹ bề mặt |
| Cầm chắc | Cận cảnh phần tay cầm |
| Làm sạch | Massage trên cẳng tay |
| Dễ bảo quản | Rửa + treo khô |

Không chỉ để MC nói mà không có visual tương ứng.

---

# 9. Checklist trước khi trả kết quả

Trước khi output, kiểm tra:

```text
[ ] Đúng số cảnh.
[ ] Đúng thời lượng.
[ ] Có AIDA.
[ ] Mỗi cảnh có Câu lệnh tạo video.
[ ] Mỗi cảnh có đúng 3 câu thoại MC.
[ ] MC nhất quán.
[ ] Sản phẩm nhất quán.
[ ] Không có hành động phi vật lý.
[ ] Không thay đổi kết cấu sản phẩm.
[ ] Demo phù hợp với USP.
[ ] CTA xuất hiện cuối video.
[ ] Không bịa giá hoặc khuyến mãi.
[ ] Không dùng claim y tế không có căn cứ.
```

---

# 10. Ví dụ input

```text
Tên sản phẩm:
Bông Tắm Tròn Tạo Bọt 3D

Ưu điểm:
- Tạo bọt tốt.
- Hỗ trợ làm sạch da.
- Bề mặt mềm.
- Cầm tiện lợi.

Thông tin sản phẩm:
- Kích thước: khoảng 10–15 cm.
- Công dụng: làm sạch, massage cơ thể.
- Bảo quản: rửa sạch và treo nơi thoáng mát.

Ảnh sản phẩm:
Đã upload.

Ảnh MC:
Đã upload.

Thời lượng:
60 giây

Số cảnh:
10

Số câu thoại mỗi cảnh:
3

Nền tảng:
Shopee Live

Tên kênh:
Homebox - Thế Giới Tiện Ích

Follower:
117k

Người xem:
1K

CTA:
Comment HỒNG hoặc XANH và bấm sản phẩm đang ghim.
```

---

# 11. Ví dụ output một cảnh

```markdown
### Cảnh 4 — Interest | 18–24s

**Câu lệnh tạo video:**  
Video dọc 9:16, Shopee Live photorealistic. Giữ nguyên MC,
bối cảnh và sản phẩm từ cảnh trước. Camera close-up vào bàn tay
và Bông Tắm Tròn Tạo Bọt 3D. MC xoa nhẹ bông đã được làm ướt
và có một lượng nhỏ sữa tắm. Bọt xuất hiện dần trên bề mặt theo
đúng vật lý. Không thay đổi hình dạng, màu sắc hoặc kích thước
sản phẩm. Không tạo lượng bọt phi thực tế. Hiển thị comment:
“Shop ơi tạo bọt tốt không?”

**Câu thoại của MC:**
1. “Cả nhà nhìn lượng bọt lên này.”
2. “Mình chỉ dùng một chút sữa tắm thôi nhé.”
3. “Bọt lên đều nên mỗi lần dùng cũng tiết kiệm hơn.”
```

---

# 12. Lệnh kích hoạt Skill

Khi user gửi:

```text
Tạo kịch bản livestream
```

hoặc:

```text
Tạo video Shopee Live cho sản phẩm này
```

hãy:

1. Kiểm tra các input đang có.
2. Nếu thiếu thông tin quan trọng, hỏi user theo **Form nhập nhanh**.
3. Nếu đủ dữ liệu, không hỏi lại.
4. Tạo kịch bản theo STEP 1 → STEP 10.
5. Trả output đúng format từng cảnh.
