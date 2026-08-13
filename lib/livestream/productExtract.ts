import { chatCompletion } from '../ai/chatClient';
import { extractJson } from '../ai/jsonExtract';

const EXTRACT_SYSTEM_PROMPT = `Bạn là trợ lý trích xuất thông tin sản phẩm từ văn bản thô (có thể là text
cào từ trang web, mô tả người dùng dán tay, hoặc nội dung 1 dòng trong file liệt kê sản phẩm).

Nhiệm vụ: đọc đoạn text được cung cấp, xác định đây là mô tả của 1 SẢN PHẨM DUY NHẤT, rồi trả về:
- name: tên sản phẩm ngắn gọn, chính xác nhất có thể suy ra từ text
- description: mô tả tổng hợp súc tích (đặc điểm, chất liệu, màu sắc, tính năng nổi bật, giá/ưu đãi nếu có,
  đối tượng sử dụng...) — đủ chi tiết để dùng làm input viết lời thoại quảng cáo sau này, nhưng không thêm
  thông tin bịa đặt không có trong text gốc.

Nếu text quá ít thông tin để xác định tên sản phẩm, đặt name là mô tả ngắn chung (VD "Sản phẩm chưa rõ tên").

Trả về DUY NHẤT 1 JSON object hợp lệ, không kèm markdown/giải thích, đúng format:
{"name":"...","description":"..."}`;

export interface ExtractedProduct {
  name: string;
  description: string;
}

/** Trích xuất tên + mô tả sản phẩm từ 1 đoạn text thô (đã xác định là 1 sản phẩm) qua AI. */
export async function extractProductInfo(rawText: string): Promise<ExtractedProduct> {
  const raw = await chatCompletion(EXTRACT_SYSTEM_PROMPT, rawText);
  const parsed = JSON.parse(extractJson(raw)) as Partial<ExtractedProduct>;
  return {
    name: (parsed.name || '').trim() || 'Sản phẩm chưa rõ tên',
    description: (parsed.description || '').trim(),
  };
}
