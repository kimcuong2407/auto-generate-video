# Đồng nhất sản phẩm trong video output — chẩn đoán & nâng cấp

## Vấn đề gốc

Project `ban-chai-co-lung-nhat-ban-jyoohome-size--d5ee92` cho ra video mà sản phẩm **đổi màu giữa chừng**:
2 cảnh đầu bàn chải hiện màu **xanh mint + lông trắng**, cảnh cuối lại **trắng + lông vàng kem** (đúng ảnh
thật do người dùng cung cấp).

### Gốc rễ (đã xác minh)

1. AI viết `veoPrompt`/prompt storyboard qua `generateScriptText` → chạy trên **model text** (VD `deepseek-v4-pro`)
   **KHÔNG nhìn được ảnh** (xem `lib/mcp/flowJobs.ts`).
2. Dữ liệu text mô tả sản phẩm **thiếu màu thật**: `product.material=""`, `product.colors` chứa tên biến thể
   ("Cọ Lưng NB08") chứ không phải màu vật lý.
3. → AI **bịa** ra "pale mint-green matte plastic handle, white foam brush head" và nhét vào prompt.
4. Text bịa sai này **lấn át ảnh reference thật** khi Flow sinh ảnh (image model ưu tiên text prompt hơn
   ảnh tham chiếu). Bằng chứng ngược: cảnh `cta` có prompt "lười" không nhắc màu → bám ảnh reference →
   ra **đúng** màu trắng/vàng kem.

## Ba hướng khắc phục

| Hướng | Nội dung | Trạng thái |
|---|---|---|
| 1 | Cho AI **nhìn** ảnh thật (vision) để lấy mô tả màu/chất liệu/hình dạng chính xác | ✅ Đã làm |
| 2 | **Chặn** AI bịa màu trong system prompt, ép dùng cụm trung tính khi không chắc | ✅ Đã làm |
| 3 | **Tăng trọng số** ảnh reference khi sinh ảnh (giảm ảnh hưởng của text) | 📄 Document (chưa làm) |

## Đã làm (Hướng 1 + 2)

- **Trường mới `ProductInfo.visualDescription`** (`lib/types.ts`): lưu mô tả hình ảnh thật do AI vision đọc,
  tách biệt khỏi `material`/`colors` người dùng nhập. Mặc định `''` (không phá project cũ).
- **Helper vision `extractVisualDescription(imageAbsPaths)`** (`lib/data/productVisionExtract.ts`): đọc tối đa
  4 ảnh sản phẩm qua `AI_VISION_MODEL`, trả về 1 đoạn mô tả THỊ GIÁC (chỉ màu/chất liệu/hình dạng nhìn thấy,
  không giá/marketing/bối cảnh).
- **Nút thủ công "🔍 AI phân tích ảnh"** ở Bước 1 (`components/steps/UploadStep.tsx` →
  `POST /api/projects/[id]/product-vision`): chạy vision, đổ kết quả vào textarea để người dùng xem/sửa,
  lưu qua PATCH.
- **Tự động chạy khi sinh kịch bản** (`app/api/projects/[id]/script/generate/route.ts`): nếu chưa có
  `visualDescription` và project có ảnh → tự chạy vision, lưu lại, ghép vào prompt. Lỗi vision không chặn luồng
  (chỉ log cảnh báo).
- **Chặn bịa màu trong 2 system prompt**:
  - `BASE_SYSTEM_PROMPT` (script/generate) — thành phần (1) Subject.
  - `SYSTEM_PROMPT` (storyboardPromptGenerate) — phần nhất quán 8 ô.
  - Cả hai: BẮT BUỘC dùng đúng mô tả hình ảnh thật; nếu không có màu đáng tin cậy → dùng
    `"the product shown in the reference image"`.
  - **KHÔNG đụng** `BACKGROUND_SYSTEM_PROMPT` (cố tình không có sản phẩm) và `aiGuidance` từng góc kịch bản.

## Hướng 3 — Tăng độ bám ảnh reference (để dành nâng cấp)

Nếu sau Hướng 1+2 sản phẩm vẫn lệch, đây là các đòn bẩy để image model bám ảnh reference chặt hơn thay vì
chạy theo text prompt. Nơi sửa chính:

- `lib/data/storyboardGenerate.ts` (khoảng dòng 47–63): nơi gom `referenceImagePaths` và gọi
  `generateStoryboardImage({ refPaths, model, ... })`.
- `lib/mcp/flowJobs.ts`: nơi map tham số xuống MCP tool `flow_generate_image` / `flow_start_image`.

### Các lựa chọn (ưu tiên từ rẻ → tốn công)

1. **Chọn lọc & sắp thứ tự ảnh reference**
   - Đặt ảnh **chính diện, rõ nét nhất** làm ảnh reference ĐẦU TIÊN (nhiều model coi ảnh đầu là ảnh chủ đạo).
   - Gửi **ít nhưng chất** (2–3 ảnh sắc nét, đủ góc) thay vì dồn hết ảnh — ảnh mờ/thừa làm loãng tín hiệu.

2. **Dùng ảnh product cutout nền trắng**
   - Tiền xử lý tách nền sản phẩm (remove background) → ảnh reference sạch, model đọc màu/chất liệu chuẩn hơn,
     không bị nền/ánh sáng ảnh gốc gây nhiễu.

3. **Thử image model khác**
   - Hiện `project.storyboard.model` (mặc định `flow-image`). Thử `HARBOR_SEAL` / `GEM_PIX_2` / `NARWHAL` xem
     model nào bám ảnh reference tốt hơn với sản phẩm này.

4. **Reference weight / strength (nếu Flow hỗ trợ)**
   - Kiểm tra `flow_generate_image` có tham số điều chỉnh mức độ ảnh hưởng của ảnh tham chiếu không. Nếu có,
     tăng weight ảnh / giảm ảnh hưởng text. Hiện MCP tool chưa expose tham số này → cần mở rộng ở
     `lib/mcp/flowJobs.ts` khi có.

5. **Prompt "nhẹ" có chủ đích cho phần màu**
   - Với sản phẩm khó, cân nhắc để prompt **không nêu màu cụ thể** (chỉ "the product shown in the reference
     image") và để ảnh reference quyết định màu — đúng như bằng chứng cảnh `cta` ra đúng màu. Hướng 2 đã mở
     đường cho cách này khi không có `visualDescription` đáng tin cậy.

### Gợi ý thứ tự thử

1 → 2 → 5 (rẻ, không đổi hạ tầng) trước; nếu vẫn lệch mới tới 3 → 4 (đổi model / mở rộng MCP tool).
