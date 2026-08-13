import fs from 'node:fs/promises';
import path from 'node:path';
import { chatCompletion } from '../ai/chatClient';

/**
 * Đọc ảnh sản phẩm THẬT bằng AI vision để lấy mô tả HÌNH ẢNH chính xác (màu sắc vật lý,
 * chất liệu, hình dạng, tỉ lệ) — dùng cho luồng project thường (Veo Pipeline).
 *
 * Vì sao cần: model text mặc định (AI_CHAT_API_MODEL) KHÔNG nhìn được ảnh, nên khi viết
 * veoPrompt/storyboard nó tự BỊA màu/chất liệu (VD "mint-green handle" trong khi sản phẩm
 * thật cán trắng). Hàm này chạy riêng qua AI_VISION_MODEL để "chốt" đặc điểm thật, rồi được
 * nhét vào prompt làm nguồn màu/chất liệu đáng tin cậy.
 *
 * Khác productVision.ts của livestream (chỉ đọc 1 ảnh chụp màn hình để lấy name+description
 * marketing): hàm này đọc NHIỀU ảnh sản phẩm và chỉ tập trung mô tả THỊ GIÁC, bỏ qua
 * giá/ưu đãi/bối cảnh.
 */

const VISION_SYSTEM_PROMPT = `Bạn là trợ lý mô tả hình ảnh sản phẩm cho khâu dựng video.

Nhiệm vụ: nhìn kỹ các ảnh sản phẩm được cung cấp (đây đều là CÙNG 1 sản phẩm chụp từ nhiều
góc/biến thể), rồi viết 1 đoạn mô tả THỊ GIÁC súc tích bằng tiếng Việt về ĐÚNG những gì nhìn
thấy, phục vụ việc mô tả lại sản phẩm khi sinh ảnh/video.

BẮT BUỘC mô tả (chỉ những gì THỰC SỰ nhìn thấy trong ảnh):
- Màu sắc VẬT LÝ chính xác của từng bộ phận (VD: cán màu trắng, đầu cọ lông màu vàng kem).
- Chất liệu bề mặt (nhựa bóng/mờ, kim loại, vải, silicon, lông mềm...).
- Hình dạng, cấu tạo, các bộ phận tách rời, tỉ lệ/kích thước tương đối giữa các bộ phận.
- Chi tiết đặc trưng dễ nhận ra (lỗ treo, khớp nối, hoa văn, logo dập nổi...).

TUYỆT ĐỐI KHÔNG:
- KHÔNG bịa/suy diễn màu sắc, chất liệu, chi tiết KHÔNG nhìn thấy rõ trong ảnh.
- KHÔNG mô tả giá, khuyến mãi, đánh giá sao, thương hiệu, chữ marketing trên ảnh.
- KHÔNG mô tả bối cảnh/nền/người mẫu — chỉ mô tả bản thân sản phẩm.
- KHÔNG bọc trong markdown, KHÔNG xuống dòng thừa. Trả về DUY NHẤT 1 đoạn văn mô tả.`;

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * Số ảnh tối đa gửi cho model vision. Gửi vài ảnh đại diện là đủ để chốt màu/chất liệu;
 * gửi quá nhiều làm payload nặng, chậm và tốn token vô ích.
 */
const MAX_VISION_IMAGES = 4;

/**
 * Đọc danh sách ảnh sản phẩm (đường dẫn TUYỆT ĐỐI) → trả về đoạn mô tả thị giác.
 * Caller tự resolve đường dẫn (VD projectInputsDir + basename) và tự quyết định có
 * bọc try/catch hay không.
 *
 * @throws nếu chưa cấu hình AI_VISION_MODEL hoặc không đọc được ảnh nào.
 */
export async function extractVisualDescription(imageAbsPaths: string[]): Promise<string> {
  const visionModel = process.env.AI_VISION_MODEL || '';
  if (!visionModel) {
    throw new Error(
      'Chưa cấu hình AI_VISION_MODEL trong .env.local (model AI hỗ trợ đọc ảnh, VD: cc/claude-haiku-4-5-20251001)'
    );
  }

  const picked = imageAbsPaths.slice(0, MAX_VISION_IMAGES);
  const images: { mimeType: string; base64: string }[] = [];
  for (const abs of picked) {
    try {
      const buffer = await fs.readFile(abs);
      const ext = path.extname(abs).toLowerCase();
      const mimeType = IMAGE_MIME[ext] || 'image/jpeg';
      images.push({ mimeType, base64: buffer.toString('base64') });
    } catch {
      // Bỏ qua ảnh không đọc được (file thiếu/hỏng) — vẫn dùng các ảnh còn lại.
    }
  }

  if (images.length === 0) {
    throw new Error('Không đọc được ảnh sản phẩm nào để phân tích');
  }

  const raw = await chatCompletion(
    VISION_SYSTEM_PROMPT,
    'Nhìn các ảnh và mô tả thị giác sản phẩm theo yêu cầu.',
    { model: visionModel, images }
  );

  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ');
}
