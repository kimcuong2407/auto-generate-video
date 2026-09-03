import fs from 'node:fs/promises';
import path from 'node:path';
import { chatCompletion } from '../ai/chatClient';
import { readImagesAsBase64, sniffImageMime } from '../data/productVisionExtract';
import { extractJson } from '../ai/jsonExtract';
import { withAiCallContext, type AiCallContext } from '../ai/callLog';

// Re-export prompt mặc định từ module thuần (promptDefaults) để client import được mà không
// kéo theo chatClient/node:fs server-only. Đây vẫn là 1 nguồn sự thật duy nhất.
export { VISION_SYSTEM_PROMPT, PRODUCT_VISUAL_SYSTEM_PROMPT } from './promptDefaults';
import { VISION_SYSTEM_PROMPT, PRODUCT_VISUAL_SYSTEM_PROMPT } from './promptDefaults';
import { loadPromptSet } from './promptStore';

export interface ExtractedProduct {
  name: string;
  description: string;
}

/**
 * Đọc ảnh chụp màn hình trang sản phẩm bằng AI vision — cách duy nhất thực sự đáng tin cậy
 * để tự động lấy thông tin sản phẩm từ các nền tảng chặn scraping (VD Shopee), vì không phụ
 * thuộc việc fetch/render trang mà dùng ảnh người dùng tự chụp.
 */
export async function extractProductFromImage(
  imageAbsPath: string,
  /** Slug job — gắn log vào job để xem được ở job detail. Bỏ trống = phạm vi toàn hệ thống. */
  jobSlug?: string
): Promise<ExtractedProduct> {
  const visionModel = process.env.AI_VISION_MODEL || '';
  if (!visionModel) {
    throw new Error(
      'Chưa cấu hình AI_VISION_MODEL trong .env.local (model AI hỗ trợ đọc ảnh, VD: cc/claude-haiku-4-5-20251001)'
    );
  }

  const buffer = await fs.readFile(imageAbsPath);
  const mimeType = sniffImageMime(buffer);

  const prompts = await loadPromptSet();
  const raw = await withAiCallContext(
    {
      stepKey: 'vision_screenshot',
      jobSlug,
      promptScope: prompts.scopeOf('vision_screenshot'),
      imagePaths: [path.basename(imageAbsPath)],
    },
    () =>
      chatCompletion(prompts.get('vision_screenshot'), 'Đọc ảnh và trích xuất thông tin sản phẩm.', {
        model: visionModel,
        images: [{ mimeType, base64: buffer.toString('base64') }],
      })
  );

  const parsed = JSON.parse(extractJson(raw)) as Partial<ExtractedProduct>;
  return {
    name: (parsed.name || '').trim() || 'Sản phẩm chưa rõ tên',
    description: (parsed.description || '').trim(),
  };
}

/**
 * Đọc các ảnh THẬT của sản phẩm (ref đã chọn, không phải ảnh chụp màn hình trang bán) và mô tả
 * ngoại hình vật lý ngắn gọn (kích thước, chất liệu, cầm 1 tay hay 2 tay...) — dùng bổ sung vào
 * user prompt của bước sinh kịch bản để veoPrompt mô tả cảnh cầm/thao tác sản phẩm chân thực hơn.
 *
 * Nhận NHIỀU ảnh (mọi ảnh Mr.D đã chọn): trước đây chỉ đọc đúng ảnh đầu tiên nên các góc chụp còn
 * lại — thường là góc cho thấy mặt sau/các ngăn/cách đeo — không bao giờ tới được model.
 *
 * @throws nếu chưa cấu hình AI_VISION_MODEL hoặc không đọc được ảnh nào.
 */
export async function describeProductAppearance(
  imageAbsPaths: string[],
  /** System prompt của bước này (registry: bản riêng job → mặc định → hằng). Bỏ trống = hằng. */
  systemPrompt: string = PRODUCT_VISUAL_SYSTEM_PROMPT,
  /** Nhãn để log lượt gọi AI (job nào, prompt tầng nào). Bỏ trống = không ghi log. */
  logCtx?: Omit<AiCallContext, 'stepKey' | 'imagePaths'>
): Promise<string> {
  const visionModel = process.env.AI_VISION_MODEL || '';
  if (!visionModel) {
    throw new Error(
      'Chưa cấu hình AI_VISION_MODEL trong .env.local (model AI hỗ trợ đọc ảnh, VD: cc/claude-haiku-4-5-20251001)'
    );
  }

  const images = await readImagesAsBase64(imageAbsPaths);
  if (images.length === 0) {
    throw new Error('Không đọc được ảnh sản phẩm nào để mô tả ngoại hình');
  }

  const raw = await withAiCallContext(
    { stepKey: 'product_visual', ...logCtx, imagePaths: imageAbsPaths.map((p) => path.basename(p)) },
    () =>
      chatCompletion(
        systemPrompt,
        // Nói rõ đây là CÙNG 1 sản phẩm chụp nhiều góc, nếu không model tả thành nhiều món khác nhau.
        'Các ảnh dưới đây đều là CÙNG 1 sản phẩm chụp từ nhiều góc/biến thể. Mô tả ngoại hình vật lý của sản phẩm đó.',
        { model: visionModel, images }
      )
  );
  return raw.trim();
}
