/**
 * Định danh các KHỐI VĂN BẢN mà server tự ghép thêm vào prompt, cho phép người dùng tắt từng khối.
 *
 * Vì sao cần: Mr.D sửa prompt gen background xuống ~450 ký tự nhưng prompt gửi AI vẫn 2.323 ký tự —
 * server ghép thêm mô tả sản phẩm + sân khấu đã chốt + chú giải ảnh. Các khối đó thêm vào có chủ ý
 * (chống AI bịa người dẫn / đổi món hàng, đều là bug production đã xảy ra) nhưng trước đây là
 * "tất cả hoặc không có gì": muốn bỏ 1 khối phải sửa code.
 *
 * NHỮNG KHỐI KHÔNG CÓ MẶT Ở ĐÂY LÀ CÓ CHỦ ĐÍCH — đó là RÀNG BUỘC KỸ THUẬT, tắt là vỡ luồng gen:
 *   - "Viết đúng N đoạn ... thời lượng lần lượt" và "Trả về đúng N phần tử trong segments":
 *     sanitizeSegments NÉM LỖI khi AI trả thiếu đoạn ("AI chỉ trả về X/N đoạn"), cả lượt gen chết.
 *   - Bảng cảnh AIDA của V2 (scenePlan): là nơi DUY NHẤT mang thời lượng từng cảnh ở V2 (V2 không
 *     có dòng thời lượng riêng như V1) → tắt là sai số cảnh → cùng đường ném lỗi trên.
 *   - Mô tả sản phẩm ở bước sinh kịch bản: không có thì AI không biết viết về cái gì.
 * Không biểu diễn được thì không tắt được — chắc chắn hơn nhận key rồi validate loại ra.
 *
 * Module THUẦN (không import gì có `node:`): client component import trực tiếp để vẽ ô tick, cùng
 * lý do đã ghi ở promptParamsDefs.ts. Kéo module server-only vào đây sẽ vỡ bundle client.
 *
 * `key` LƯU TRONG DB (livestream_jobs.disabled_prompt_blocks) — đổi tên key = phải migrate dữ liệu.
 */

export type PromptBlockStep = 'background' | 'script';

export interface PromptBlockDef {
  key: PromptBlockKey;
  step: PromptBlockStep;
  /** Nhãn ngắn cạnh ô tick. */
  label: string;
  /** Một câu: tắt đi thì mất gì — người dùng cần biết rủi ro TRƯỚC khi bỏ tick. */
  hint: string;
  /** true = chỉ job V2 có khối này; job V1 hiện mờ để khỏi tưởng hỏng. */
  v2Only?: boolean;
}

export const PROMPT_BLOCKS = [
  {
    key: 'bg_product',
    step: 'background',
    label: 'Mô tả sản phẩm',
    hint: 'Tắt = AI chỉ dựa vào ảnh reference để biết món hàng. Thường an toàn ở bước gen ảnh.',
  },
  {
    key: 'bg_bible',
    step: 'background',
    label: 'Sân khấu đã chốt (người dẫn / bối cảnh / góc máy)',
    hint: 'Tắt = ảnh nền có thể ra người dẫn hoặc căn phòng khác với sân khấu đã chốt cho buổi live.',
  },
  {
    key: 'bg_ref_legend',
    step: 'background',
    label: 'Chú giải ảnh reference (ảnh nào là người, ảnh nào là sản phẩm)',
    hint: 'Tắt = AI nhận một chồng ảnh vô danh, không biết ảnh nào cần copy khuôn mặt → dễ ra người lạ.',
  },
  {
    key: 'sc_bible',
    step: 'script',
    label: 'Sân khấu cố định của buổi live',
    hint: 'Khối lớn nhất (~1.100 ký tự). Tắt = mỗi sản phẩm có thể ra người dẫn/bối cảnh khác nhau.',
  },
  {
    key: 'sc_position',
    step: 'script',
    label: 'Vị trí sản phẩm trong buổi live',
    hint: 'Tắt = sản phẩm thứ 2 trở đi sẽ chào khán giả lại từ đầu, ghép lại thành nhiều buổi live rời rạc.',
  },
  {
    key: 'sc_visual',
    step: 'script',
    label: 'Mô tả ngoại hình sản phẩm (AI đọc từ ảnh thật)',
    hint: 'Tắt = lời thoại/veoPrompt tả cảnh cầm, thao tác sản phẩm chung chung hơn.',
  },
  {
    key: 'sc_lock',
    step: 'script',
    label: 'Khoá ngoại hình sản phẩm',
    hint: 'Tắt = sản phẩm có thể đổi màu/hình dáng giữa các cảnh. Đây là lỗi tốn tiền nhất vì phải gen lại video.',
    v2Only: true,
  },
  {
    key: 'sc_advantages',
    step: 'script',
    label: 'Ưu điểm sản phẩm + gán USP theo từng cảnh',
    hint: 'Tắt = AI tự chọn nói ưu điểm nào, không còn ép demo bằng hình ở đúng cảnh đã phân.',
    v2Only: true,
  },
  {
    key: 'sc_v2_input',
    step: 'script',
    label: 'Thông tin buổi live (kênh, follower, khuyến mãi, CTA)',
    hint: 'Tắt = AI không biết tên kênh/khuyến mãi, và MẤT luôn câu cấm bịa giá — dễ nhắc giá sai.',
    v2Only: true,
  },
] as const satisfies readonly PromptBlockDef[];

export type PromptBlockKey =
  | 'bg_product'
  | 'bg_bible'
  | 'bg_ref_legend'
  | 'sc_bible'
  | 'sc_position'
  | 'sc_visual'
  | 'sc_lock'
  | 'sc_advantages'
  | 'sc_v2_input';

/** Các khối của 1 bước, để UI vẽ danh sách ô tick. */
export function blocksForStep(step: PromptBlockStep): readonly PromptBlockDef[] {
  return PROMPT_BLOCKS.filter((b) => b.step === step);
}

/** true nếu chuỗi là block key hợp lệ — validate input từ route trước khi ghi DB. */
export function isPromptBlockKey(v: unknown): v is PromptBlockKey {
  return typeof v === 'string' && PROMPT_BLOCKS.some((b) => b.key === v);
}

/**
 * Khối này có được gửi cho AI không.
 *
 * Danh sách lưu trong DB là các khối BỊ TẮT (không phải khối được bật): mặc định — cột NULL, mảng
 * rỗng, hay job tạo trước khi có tính năng này — đều ra "bật hết", đúng y hành vi cũ. Lưu ngược lại
 * ("khối được bật") thì mọi job cũ có mảng rỗng sẽ thành tắt sạch mọi khối, một hồi quy im lặng.
 *
 * Key lạ trong danh sách (dữ liệu cũ, key đã đổi tên) được BỎ QUA chứ không ném lỗi — nó chỉ khiến
 * một khối vẫn bật, còn ném lỗi ở đây là chặn cả lượt gen vì một dòng dữ liệu rác.
 */
export function isBlockEnabled(
  disabled: readonly string[] | null | undefined,
  key: PromptBlockKey
): boolean {
  return !disabled?.includes(key);
}
