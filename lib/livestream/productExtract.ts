import { chatCompletion } from '../ai/chatClient';
import { withAiCallContext } from '../ai/callLog';
import { extractJson } from '../ai/jsonExtract';

// Re-export prompt mặc định từ module thuần (promptDefaults) để client import được mà không
// kéo theo chatClient/node:fs server-only. Đây vẫn là 1 nguồn sự thật duy nhất.
export { EXTRACT_SYSTEM_PROMPT } from './promptDefaults';
import { EXTRACT_SYSTEM_PROMPT } from './promptDefaults';
import { loadPromptSet } from './promptStore';

export interface ExtractedProduct {
  name: string;
  description: string;
}

/** Trích xuất tên + mô tả sản phẩm từ 1 đoạn text thô (đã xác định là 1 sản phẩm) qua AI. */
export async function extractProductInfo(
  rawText: string,
  /**
   * Slug job đang được tạo. Bước này chạy lúc ingest — job đã có slug (sinh ở route trước khi gọi
   * ingestEntry) dù row DB chưa ghi, nên gắn được ngay để log hiện trong job detail.
   */
  jobSlug?: string,
  /**
   * Nhãn V1/V2 do ROUTE truyền xuống, không tự tra.
   *
   * Vì sao: bước này chạy lúc ingest, TRƯỚC khi row livestream_v2_inputs được ghi — gọi
   * resolveLivestreamKind ở đây sẽ gắn 'livestream-v1' cho mọi job V2. Route tạo job là nơi duy
   * nhất biết chắc mình đang tạo luồng nào.
   */
  sourceKind?: string
): Promise<ExtractedProduct> {
  const prompts = await loadPromptSet();
  const raw = await withAiCallContext(
    { stepKey: 'extract', jobSlug, sourceKind, promptScope: prompts.scopeOf('extract') },
    () => chatCompletion(prompts.get('extract'), rawText)
  );
  const parsed = JSON.parse(extractJson(raw)) as Partial<ExtractedProduct>;
  return {
    name: (parsed.name || '').trim() || 'Sản phẩm chưa rõ tên',
    description: (parsed.description || '').trim(),
  };
}
