/**
 * Bóc tách dữ liệu sản phẩm thô (text crawl Shopee) → các ô của form /livestream-v2/new.
 *
 * Dùng ở nút "Tạo kịch bản Shopee V2" của trang shopee-crawl: crawl chỉ cho sẵn ~9/18 ô, và
 * `advantages` map thô từ description sẽ lẫn thông số kỹ thuật. Một lượt AI ở đây lấp thêm
 * usage/material/size/audience và lọc advantages về đúng ưu điểm demo được bằng hình.
 */
import { chatCompletion } from '../ai/chatClient';
import { extractJson } from '../ai/jsonExtract';
import { V2_FIELD_EXTRACT_SYSTEM_PROMPT } from './promptDefaultsV2';
import type { LivestreamV2Fields } from './types';

export { V2_FIELD_EXTRACT_SYSTEM_PROMPT } from './promptDefaultsV2';

const EMPTY: LivestreamV2Fields = {
  name: '',
  advantages: [],
  usage: '',
  material: '',
  size: '',
  colors: '',
  audience: '',
  howToUse: '',
  storage: '',
};

/** Chuẩn hoá output AI — thiếu/sai kiểu trường nào thì về rỗng, không để undefined lọt vào form. */
function normalize(parsed: Partial<LivestreamV2Fields>): LivestreamV2Fields {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    name: str(parsed.name),
    advantages: Array.isArray(parsed.advantages)
      ? parsed.advantages.map((a) => String(a).trim()).filter(Boolean).slice(0, 8)
      : [],
    usage: str(parsed.usage),
    material: str(parsed.material),
    size: str(parsed.size),
    colors: str(parsed.colors),
    audience: str(parsed.audience),
    howToUse: str(parsed.howToUse),
    storage: str(parsed.storage),
  };
}

/**
 * Tách text thô thành các ô form. KHÔNG ném lỗi: AI hỏng/thiếu cấu hình thì trả về bộ rỗng để
 * người dùng vẫn mở được form và tự điền — chặn ở đây chỉ tổ khiến nút bấm không làm gì cả.
 */
export async function extractV2Fields(rawText: string): Promise<LivestreamV2Fields> {
  if (!rawText.trim()) return EMPTY;
  try {
    const raw = await chatCompletion(V2_FIELD_EXTRACT_SYSTEM_PROMPT, rawText);
    return normalize(JSON.parse(extractJson(raw)) as Partial<LivestreamV2Fields>);
  } catch (err) {
    console.error('[v2FieldExtract] tách field thất bại:', (err as Error).message);
    return EMPTY;
  }
}
