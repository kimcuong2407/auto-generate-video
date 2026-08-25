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
  visualDescription?: string,
  /** Khối "sân khấu cố định" của buổi live (formatStageBibleBlock) — bỏ trống nếu chưa chốt được. */
  stageBibleBlock?: string,
  /** Vị trí sản phẩm trong buổi live, để LLM viết câu chuyển tiếp thay vì mở màn lại từ đầu. */
  position?: { index: number; total: number; prevProductName?: string }
): string {
  const visualBlock = visualDescription
    ? `\n\nMô tả ngoại hình sản phẩm (từ ảnh thật, dùng để mô tả cầm/thao tác chân thực):\n${visualDescription}`
    : '';
  const bibleBlock = stageBibleBlock ? `${stageBibleBlock}\n\n` : '';
  // Sản phẩm thứ 2 trở đi nằm GIỮA buổi live, không phải mở màn — nếu không nói rõ, LLM luôn viết
  // lại lời chào "Chào mọi người đã vào live" khiến ghép lại thành nhiều buổi live rời rạc.
  const positionBlock = position
    ? position.index === 0
      ? `Đây là sản phẩm MỞ ĐẦU (1/${position.total}) của buổi live — được phép chào khán giả.\n\n`
      : `Đây là sản phẩm thứ ${position.index + 1}/${position.total} trong buổi live ĐANG diễn ra${
          position.prevProductName ? ` (vừa giới thiệu xong "${position.prevProductName}")` : ''
        }.\nTUYỆT ĐỐI KHÔNG chào lại khán giả, KHÔNG mở màn lại buổi live. Đoạn đầu tiên PHẢI là câu CHUYỂN TIẾP tự nhiên sang sản phẩm mới (VD "tiếp theo đây mình có...", "còn món này nữa nè..."), như đang nói liền mạch từ sản phẩm trước.${
          position.index === position.total - 1
            ? '\nĐây cũng là sản phẩm CUỐI — đoạn cuối cùng khép lại cả buổi live.'
            : '\nĐây CHƯA phải sản phẩm cuối — đoạn cuối chốt đơn ngắn gọn rồi dẫn sang sản phẩm kế, KHÔNG chào tạm biệt kết thúc live.'
        }\n\n`
    : '';
  // Ràng buộc SỐ TỪ tường minh cho từng đoạn: chỉ nói "khoảng 2-3 từ/giây" thì LLM luôn viết dư
  // (đo thực tế: 24/24 đoạn ra 3.4-4.0 từ/s), Veo đọc không kịp trong 8s nên cắt cụt câu cuối.
  // 2.5 từ/s là nhịp nói tiếng Việt tự nhiên; trần cứng đặt ở 2.75 từ/s.
  const wordBudget = durations
    .map((d, i) => `  - Đoạn ${i + 1} (${d}s): tối đa ${Math.floor(d * 2.75)} từ (lý tưởng ${Math.round(d * 2.5)} từ)`)
    .join('\n');
  return `${bibleBlock}${positionBlock}Mô tả sản phẩm:\n${description}${visualBlock}\n\nViết đúng ${durations.length} đoạn liên tiếp, thời lượng lần lượt (giây): ${durations.join(
    ', '
  )}.\n\nGIỚI HẠN SỐ TỪ BẮT BUỘC cho voiceoverVi từng đoạn (đếm từ, KHÔNG được vượt — vượt là video bị cắt cụt câu):\n${wordBudget}\nViết ngắn gọn, đúng trọng tâm; thà thiếu vài từ còn hơn thừa.\n\nTrả về đúng ${durations.length} phần tử trong "segments", đúng thứ tự tương ứng với thời lượng đã cho.`;
}
