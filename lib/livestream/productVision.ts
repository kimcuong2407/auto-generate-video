import fs from 'node:fs/promises';
import path from 'node:path';
import { chatCompletion } from '../ai/chatClient';
import { extractJson } from '../ai/jsonExtract';

const VISION_SYSTEM_PROMPT = `Bạn là trợ lý đọc ảnh chụp màn hình trang sản phẩm (từ sàn TMĐT như
Shopee/Lazada/TikTok Shop, hoặc ảnh chụp bất kỳ trang bán hàng nào).

Nhiệm vụ: đọc kỹ ảnh được cung cấp, xác định đây là ảnh chụp 1 SẢN PHẨM DUY NHẤT, rồi trả về:
- name: tên sản phẩm chính xác nhất có thể đọc được từ ảnh
- description: mô tả tổng hợp súc tích (đặc điểm, chất liệu, màu sắc, tính năng nổi bật, giá/ưu đãi
  nếu nhìn thấy trong ảnh, đối tượng sử dụng...) — đủ chi tiết để dùng làm input viết lời thoại quảng
  cáo sau này. CHỈ dùng thông tin thực sự đọc được/nhìn thấy trong ảnh, KHÔNG bịa thêm.

Nếu ảnh không đủ rõ để xác định tên sản phẩm, đặt name là mô tả ngắn chung (VD "Sản phẩm chưa rõ tên").

Trả về DUY NHẤT 1 JSON object hợp lệ, không kèm markdown/giải thích, đúng format:
{"name":"...","description":"..."}`;

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export interface ExtractedProduct {
  name: string;
  description: string;
}

/**
 * Đọc ảnh chụp màn hình trang sản phẩm bằng AI vision — cách duy nhất thực sự đáng tin cậy
 * để tự động lấy thông tin sản phẩm từ các nền tảng chặn scraping (VD Shopee), vì không phụ
 * thuộc việc fetch/render trang mà dùng ảnh người dùng tự chụp.
 */
export async function extractProductFromImage(imageAbsPath: string): Promise<ExtractedProduct> {
  const visionModel = process.env.AI_VISION_MODEL || '';
  if (!visionModel) {
    throw new Error(
      'Chưa cấu hình AI_VISION_MODEL trong .env.local (model AI hỗ trợ đọc ảnh, VD: cc/claude-haiku-4-5-20251001)'
    );
  }

  const ext = path.extname(imageAbsPath).toLowerCase();
  const mimeType = IMAGE_MIME[ext] || 'image/jpeg';
  const buffer = await fs.readFile(imageAbsPath);

  const raw = await chatCompletion(VISION_SYSTEM_PROMPT, 'Đọc ảnh và trích xuất thông tin sản phẩm.', {
    model: visionModel,
    images: [{ mimeType, base64: buffer.toString('base64') }],
  });

  const parsed = JSON.parse(extractJson(raw)) as Partial<ExtractedProduct>;
  return {
    name: (parsed.name || '').trim() || 'Sản phẩm chưa rõ tên',
    description: (parsed.description || '').trim(),
  };
}
