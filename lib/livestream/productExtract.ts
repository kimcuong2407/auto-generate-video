import { chatCompletion } from '../ai/chatClient';
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
export async function extractProductInfo(rawText: string): Promise<ExtractedProduct> {
  const raw = await chatCompletion((await loadPromptSet()).get('extract'), rawText);
  const parsed = JSON.parse(extractJson(raw)) as Partial<ExtractedProduct>;
  return {
    name: (parsed.name || '').trim() || 'Sản phẩm chưa rõ tên',
    description: (parsed.description || '').trim(),
  };
}
