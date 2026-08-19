import type { LivestreamJob } from './types';


// Re-export prompt mặc định từ module thuần (promptDefaults) để giữ 1 nguồn sự thật duy nhất.
// Client component import LIVESTREAM_SYSTEM_PROMPT từ đây vẫn an toàn (file này chỉ import type).
export { LIVESTREAM_SYSTEM_PROMPT } from './promptDefaults';
import { LIVESTREAM_SYSTEM_PROMPT } from './promptDefaults';
/**
 * Trả về system prompt sinh kịch bản thực dùng cho 1 job: prompt người dùng đã chỉnh
 * (scriptSystemPromptOverride) nếu có nội dung, ngược lại dùng LIVESTREAM_SYSTEM_PROMPT mặc
 * định. Là nguồn duy nhất cho cả server (route generate) lẫn client ("Khôi phục mặc định").
 */
export function resolveScriptSystemPrompt(
  job: Pick<LivestreamJob, 'scriptSystemPromptOverride'>
): string {
  const override = job.scriptSystemPromptOverride;
  return override && override.trim() ? override : LIVESTREAM_SYSTEM_PROMPT;
}

export function buildLivestreamUserPrompt(
  description: string,
  durations: number[],
  visualDescription?: string
): string {
  const visualBlock = visualDescription
    ? `\n\nMô tả ngoại hình sản phẩm (từ ảnh thật, dùng để mô tả cầm/thao tác chân thực):\n${visualDescription}`
    : '';
  return `Mô tả sản phẩm:\n${description}${visualBlock}\n\nViết đúng ${durations.length} đoạn liên tiếp, thời lượng lần lượt (giây): ${durations.join(
    ', '
  )}.\n\nTrả về đúng ${durations.length} phần tử trong "segments", đúng thứ tự tương ứng với thời lượng đã cho.`;
}
