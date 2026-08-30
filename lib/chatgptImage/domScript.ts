/**
 * TOÀN BỘ selector + logic DOM của chatgpt.com nằm trong file này, không rải nơi khác.
 *
 * Vì sao gom một chỗ: OpenAI đổi giao diện định kỳ và mọi lần đổi đều có thể làm automation
 * vỡ. Khi vỡ, chỉ phải sửa file này — runner.ts (điều phối Playwright) không chứa selector nào.
 *
 * Các hàm ở đây là chuỗi được `page.evaluate()` chạy TRONG TRANG, nên chúng không được
 * tham chiếu bất cứ thứ gì ngoài phạm vi bản thân (không import, không biến module).
 */

/** Selector ô nhập chat thật — cũng chính là dấu hiệu "đã đăng nhập". */
export const COMPOSER_SELECTOR = '#prompt-textarea, [data-testid="composer-text-input"]';

/** Trạng thái trang đọc được trước khi thao tác. */
export type PageState = 'ready' | 'login' | 'pending';

/**
 * Đọc trạng thái trang. Chạy trong trang, trả 1 trong 3 giá trị.
 *
 * Điểm quan trọng (theo doc mục 3): CHỈ #prompt-textarea / composer-text-input mới được tính
 * là đã login. Trang landing chưa login cũng có ô nhập trông giống, dùng selector textarea
 * chung sẽ nhận nhầm → tưởng đã login rồi chết ở bước sau mà không hiểu vì sao.
 */
export function readPageState(composerSelector: string): PageState {
  if (document.querySelector(composerSelector)) return 'ready';
  const text = (document.body?.innerText || '').toLowerCase();
  if (
    document.querySelector('[data-testid="login-button"]') ||
    /log in|sign up|welcome back|đăng nhập/.test(text)
  ) {
    return 'login';
  }
  return 'pending';
}

/** Chữ ký nhận dạng 1 ảnh: src + alt. */
export type ImageSignature = string;

/**
 * Chụp baseline TRƯỚC khi bấm gửi: mọi ảnh đang có + số lượt hội thoại.
 *
 * KHÔNG dùng width/height làm chữ ký (doc mục 8): ảnh cũ có thể chưa load xong kích thước
 * thật lúc chụp, lát nữa load xong là chữ ký đổi → ảnh cũ bị tưởng là ảnh mới.
 */
export function captureBaseline(): { images: ImageSignature[]; turnCount: number } {
  const images = Array.from(document.querySelectorAll('img')).map(
    (img) => `${img.getAttribute('src') || ''}|${img.getAttribute('alt') || ''}`
  );
  const turnCount = document.querySelectorAll('[data-message-author-role]').length;
  return { images, turnCount };
}

/**
 * Ảnh này có phải ảnh kết quả thật không — 4 điều kiện PHẢI đúng hết (doc mục 10).
 *
 * Tách hàm thuần để self-check chạy được không cần browser: đây là logic dễ hỏng âm thầm
 * nhất trong cả luồng. Lọt 1 ảnh sai thì app lưu nhầm avatar/ảnh ref/ảnh của lượt chat trước
 * làm kết quả, mà KHÔNG có lỗi nào được ném ra.
 */
export function isResultImage(img: {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Ảnh nằm trong lượt của assistant (không phải ảnh user vừa đính kèm). */
  inAssistantTurn: boolean;
  /** Ảnh nằm SAU lượt user vừa gửi (không phải ảnh cũ trong lịch sử). */
  afterCurrentUserTurn: boolean;
}): boolean {
  if (!img.inAssistantTurn) return false;
  if (!img.afterCurrentUserTurn) return false;
  // Loại avatar/icon/emoji nhỏ. Ảnh gen thật luôn lớn hơn nhiều.
  if (img.naturalWidth <= 256 || img.naturalHeight <= 256) return false;

  const src = img.src || '';
  // Loại theo tên trước khi nhận theo pattern: 1 avatar vẫn có thể nằm trong lượt assistant.
  if (/avatar|favicon|profile|emoji|icon|sprite/i.test(src)) return false;

  return (
    src.startsWith('blob:') ||
    src.startsWith('data:image/') ||
    /\/backend-api\/(files|estuary|content)/.test(src) ||
    /oaiusercontent/.test(src)
  );
}

/**
 * Ghép prompt cuối gửi cho ChatGPT (doc mục 7).
 *
 * "Chỉ trả về ảnh, không hỏi lại" là câu bắt buộc: thiếu nó ChatGPT rất hay hỏi làm rõ
 * yêu cầu thay vì vẽ, và lượt đó trôi hết timeout mà không ra ảnh nào.
 */
export function buildPrompt(params: {
  prompt: string;
  aspect: '9:16' | '16:9';
  hasRefImages: boolean;
}): string {
  const lines = [`Tạo một hình ảnh, tỉ lệ khung hình ${params.aspect}.`];
  if (params.hasRefImages) lines.push('Dựa trên các ảnh tham chiếu đã đính kèm.');
  lines.push('Chỉ trả về ảnh, không hỏi lại.', '', params.prompt);
  return lines.join('\n');
}

/** Chỉ để self-check import — không dùng ở runtime. */
export const __testables = { isResultImage, buildPrompt, readPageState };
