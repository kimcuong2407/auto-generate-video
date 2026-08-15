import fs from 'node:fs/promises';
import path from 'node:path';
import { chatCompletion } from '../ai/chatClient';
import { extractJson } from '../ai/jsonExtract';

// Re-export prompt mặc định từ module thuần (promptDefaults) để client import được mà không
// kéo theo chatClient/node:fs server-only. Đây vẫn là 1 nguồn sự thật duy nhất.
export { VISION_SYSTEM_PROMPT } from './promptDefaults';
import { VISION_SYSTEM_PROMPT } from './promptDefaults';

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
