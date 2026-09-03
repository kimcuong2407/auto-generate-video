import { maxWordsFor } from './segmentSanitize';
import { isBlockEnabled } from './promptBlocks';
import { LIVESTREAM_V2_SYSTEM_PROMPT } from './promptDefaultsV2';
import { buildLivestreamV2UserPrompt } from './scriptPromptV2';
import type { LivestreamJob, LivestreamV2Input } from './types';


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
  job: Pick<LivestreamJob, 'scriptSystemPromptOverride'>,
  /** Có = job V2 (tab Livestream Shopee) → dùng prompt AIDA theo skill thay cho prompt V1. */
  v2Input?: LivestreamV2Input | null
): string {
  const override = job.scriptSystemPromptOverride;
  if (override && override.trim()) return override;
  return v2Input ? LIVESTREAM_V2_SYSTEM_PROMPT : LIVESTREAM_SYSTEM_PROMPT;
}

/**
 * Chọn đúng bộ user prompt cho job: V2 (AIDA + form Shopee) nếu có v2Input, ngược lại V1.
 *
 * Gom vào 1 hàm để mọi call-site (route sinh script, route preview) chỉ có MỘT nhánh rẽ — preview
 * mà lệch prompt thật thì bản xem trước thành vô nghĩa, đúng thứ nó sinh ra để chặn.
 */
export function buildScriptUserPrompt(args: {
  description: string;
  durations: number[];
  v2Input?: LivestreamV2Input | null;
  visualDescription?: string;
  stageBibleBlock?: string;
  position?: { index: number; total: number; prevProductName?: string };
  /** Khối khoá ngoại hình sản phẩm (formatProductLockBlock) — chỉ job V2 dùng. */
  productLockBlock?: string;
  /**
   * Các khối người dùng đã TẮT (job.disabledPromptBlocks) — xem lib/livestream/promptBlocks.ts.
   * Bỏ trống = bật hết, đúng hành vi trước khi có tính năng này.
   */
  disabledBlocks?: readonly string[];
}): string {
  const {
    description,
    durations,
    v2Input,
    visualDescription,
    stageBibleBlock,
    position,
    productLockBlock,
    disabledBlocks,
  } = args;
  return v2Input
    ? buildLivestreamV2UserPrompt(
        description,
        durations,
        v2Input,
        visualDescription,
        stageBibleBlock,
        position,
        productLockBlock,
        disabledBlocks
      )
    : buildLivestreamUserPrompt(
        description,
        durations,
        visualDescription,
        stageBibleBlock,
        position,
        disabledBlocks
      );
}

export function buildLivestreamUserPrompt(
  description: string,
  durations: number[],
  visualDescription?: string,
  /** Khối "sân khấu cố định" của buổi live (formatStageBibleBlock) — bỏ trống nếu chưa chốt được. */
  stageBibleBlock?: string,
  /** Vị trí sản phẩm trong buổi live, để LLM viết câu chuyển tiếp thay vì mở màn lại từ đầu. */
  position?: { index: number; total: number; prevProductName?: string },
  /** Khối đã tắt — xem promptBlocks.ts. Bỏ trống = bật hết. */
  disabledBlocks?: readonly string[]
): string {
  const visualBlock =
    visualDescription && isBlockEnabled(disabledBlocks, 'sc_visual')
    ? `\n\nMô tả ngoại hình sản phẩm (từ ảnh thật, dùng để mô tả cầm/thao tác chân thực):\n${visualDescription}`
    : '';
  const bibleBlock =
    stageBibleBlock && isBlockEnabled(disabledBlocks, 'sc_bible') ? `${stageBibleBlock}\n\n` : '';
  // Sản phẩm thứ 2 trở đi nằm GIỮA buổi live, không phải mở màn — nếu không nói rõ, LLM luôn viết
  // lại lời chào "Chào mọi người đã vào live" khiến ghép lại thành nhiều buổi live rời rạc.
  const positionBlock = position && isBlockEnabled(disabledBlocks, 'sc_position')
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
  // Trần cứng lấy từ maxWordsFor() — đúng ngưỡng findOverlongSegments() dùng để chấm, nếu 2 chỗ
  // lệch nhau thì LLM viết "đúng" theo prompt vẫn bị chấm là vượt. Mốc lý tưởng đặt dưới trần ~10%.
  const wordBudget = durations
    .map((d, i) => `  - Đoạn ${i + 1} (${d}s): tối đa ${maxWordsFor(d)} từ (lý tưởng ${Math.round(maxWordsFor(d) * 0.9)} từ)`)
    .join('\n');
  return `${bibleBlock}${positionBlock}Mô tả sản phẩm:\n${description}${visualBlock}\n\nViết đúng ${durations.length} đoạn liên tiếp, thời lượng lần lượt (giây): ${durations.join(
    ', '
  )}.\n\nGIỚI HẠN SỐ TỪ BẮT BUỘC cho voiceoverVi từng đoạn (đếm từ, KHÔNG được vượt — vượt là video bị cắt cụt câu):\n${wordBudget}\nViết ngắn gọn, đúng trọng tâm; thà thiếu vài từ còn hơn thừa.\n\nTrả về đúng ${durations.length} phần tử trong "segments", đúng thứ tự tương ứng với thời lượng đã cho.`;
}
