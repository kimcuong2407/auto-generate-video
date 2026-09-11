import fs from 'node:fs/promises';
import path from 'node:path';
import { chatCompletion, type ChatImageInput } from '../ai/chatClient';
import { withAiCallContext } from '../ai/callLog';
import { loadPromptSet } from '../livestream/promptStore';

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


/**
 * Đoán mime type từ MAGIC BYTES của chính nội dung file, KHÔNG tin đuôi file.
 *
 * Vì sao: ảnh do provider gen (Google Flow, OmniRoute) luôn được lưu với đuôi `.png`
 * hard-code, nhưng nội dung trả về thường là JPEG. Khai sai media type làm API vision
 * trả HTTP 400 "The image was specified using the image/png media type, but the image
 * appears to be a image/jpeg image" và cả lượt gọi hỏng.
 *
 * Fallback 'image/jpeg' khi không nhận ra chữ ký — giữ nguyên hành vi cũ.
 */
export function sniffImageMime(buf: Buffer): string {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a)
    return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  if (buf.length >= 6 && buf.toString('ascii', 0, 6).match(/^GIF8[79]a$/)) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Số ảnh tối đa gửi cho model vision. Gửi vài ảnh đại diện là đủ để chốt màu/chất liệu;
 * gửi quá nhiều làm payload nặng, chậm và tốn token vô ích.
 */
const MAX_VISION_IMAGES = 4;

/**
 * Đọc danh sách ảnh (đường dẫn TUYỆT ĐỐI) → mảng ChatImageInput để đính kèm vào lượt gọi AI.
 * Ảnh không đọc được (file thiếu/hỏng) bị bỏ qua lặng lẽ — caller tự xử lý trường hợp mảng rỗng.
 */
export async function readImagesAsBase64(absPaths: string[]): Promise<ChatImageInput[]> {
  const images: ChatImageInput[] = [];
  for (const abs of absPaths) {
    try {
      const buffer = await fs.readFile(abs);
      images.push({ mimeType: sniffImageMime(buffer), base64: buffer.toString('base64') });
    } catch {
      // Bỏ qua ảnh không đọc được — vẫn dùng các ảnh còn lại.
    }
  }
  return images;
}

/**
 * Đọc danh sách ảnh sản phẩm (đường dẫn TUYỆT ĐỐI) → trả về đoạn mô tả thị giác.
 * Caller tự resolve đường dẫn (VD projectInputsDir + basename) và tự quyết định có
 * bọc try/catch hay không.
 *
 * @throws nếu chưa cấu hình AI_VISION_MODEL hoặc không đọc được ảnh nào.
 */
export async function extractVisualDescription(
  imageAbsPaths: string[],
  /** Id project để gắn nhãn log (ai_call_logs). Bỏ trống = không ghi log lượt này. */
  projectId = ''
): Promise<string> {
  const visionModel = process.env.AI_VISION_MODEL || '';
  if (!visionModel) {
    throw new Error(
      'Chưa cấu hình AI_VISION_MODEL trong .env.local (model AI hỗ trợ đọc ảnh, VD: cc/claude-haiku-4-5-20251001)'
    );
  }

  // Bỏ ảnh đầu khi có dư ảnh: ảnh [0] trên sàn TMĐT gần như luôn là ảnh bìa marketing (badge
  // "chính hãng 100%", logo shop, khung viền) — nó chiếm suất trong MAX_VISION_IMAGES mà không
  // cho thêm thông tin hình dáng nào, lại kéo model đi mô tả đồ hoạ dán thêm. Xem
  // defaultProductReferenceImage() trong lib/imageModels.ts — cùng một heuristic.
  const usable = imageAbsPaths.length > MAX_VISION_IMAGES ? imageAbsPaths.slice(1) : imageAbsPaths;
  const picked = usable.slice(0, MAX_VISION_IMAGES);
  const images = await readImagesAsBase64(picked);

  if (images.length === 0) {
    throw new Error('Không đọc được ảnh sản phẩm nào để phân tích');
  }

  // Prompt lấy từ registry (bảng ai_prompts) chứ không phải hằng cứng — Mr.D sửa được ở tab
  // Video Review / trang Prompt AI. Bước này chạy ở luồng review nên KHÔNG có tầng riêng theo job.
  const prompts = await loadPromptSet();
  const system = prompts.get('review_product_vision');

  const raw = await withAiCallContext(
    {
      stepKey: 'review_product_vision',
      projectId,
      sourceKind: 'product-review',
      imagePaths: picked.map((p) => path.basename(p)),
      promptScope: prompts.scopeOf('review_product_vision'),
    },
    () =>
      chatCompletion(system, 'Nhìn các ảnh và mô tả thị giác sản phẩm theo yêu cầu.', {
        model: visionModel,
        images,
      })
  );

  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ');
}
