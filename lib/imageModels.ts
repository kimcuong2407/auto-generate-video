/**
 * Constants gen ảnh dùng chung CẢ server (data layer) LẪN client (dropdown UI) — tách khỏi
 * lib/constants.ts vì file đó import 'node:path' (không bundle được cho client component).
 */

// Model ảnh mặc định cho mọi bước gen ảnh (storyboard, background project, background
// livestream) — Google Flow (Veo), dùng chung 1 default cho cả 3 field model.
// (Từng mặc định OmniRoute/ChatGPT-web, đổi vì pool account chatgpt-web trên OmniRoute
// lỗi 401 "Authentication failed for all eligible image-provider accounts".)
export const DEFAULT_STORYBOARD_MODEL = 'flow-image';

/**
 * Model gen ảnh qua ChatGPT web CHẠY TRÊN CHÍNH SERVER NÀY (Playwright điều khiển Chromium
 * đã đăng nhập — xem lib/chatgptImage/). Khác hẳn 'chatgpt-web/gpt-5.5' vốn đi qua pool
 * account của OmniRoute; pool đó đã lỗi 401 nên có bản tự chạy này để không phụ thuộc bên thứ ba.
 *
 * KHÔNG chứa "/" — nhánh rẽ provider ở flowJobs.ts kiểm hằng này TRƯỚC khi kiểm dấu "/".
 */
export const CHATGPT_LOCAL_MODEL = 'chatgpt-local';

/**
 * Model gen ảnh qua ChatGPT web chạy trên CHROME CỦA NGƯỜI DÙNG, điều khiển bằng extension
 * (extension-chatgpt/) thay vì Playwright trên server.
 *
 * Vì sao có thêm đường này bên cạnh CHATGPT_LOCAL_MODEL: bản Playwright cần một profile Chrome
 * đã đăng nhập nằm sẵn trên server, mà tạo được profile đó thì tắc cả ba đường — copy profile
 * từ macOS không ăn (cookie mã hoá bằng khoá Keychain), gửi cookie qua extension không đủ
 * (token còn ở localStorage/IndexedDB + Cloudflare gắn phiên với fingerprint), còn login qua
 * X11 thì phải làm lại mỗi lần ChatGPT đá phiên. Chạy thẳng trong Chrome người dùng đang mở
 * thì không vướng rào nào trong số đó vì đó là trình duyệt thật đã đăng nhập.
 *
 * Đánh đổi: máy người dùng phải mở Chrome (có extension + tab chatgpt.com) thì job mới chạy;
 * không thì job nằm chờ trong queue.
 *
 * KHÔNG chứa "/" — nhánh rẽ provider ở flowJobs.ts kiểm hằng này TRƯỚC khi kiểm dấu "/".
 */
export const CHATGPT_EXTENSION_MODEL = 'chatgpt-extension';

// Các option provider gen ảnh hiển thị ở UI (StoryboardStep, JobImagePanel) — value là chuỗi
// `model` thực gửi xuống generateStoryboardImage(): có "/" → OmniRoute, không có → Google Flow.
export const IMAGE_MODEL_OPTIONS = [
  { value: 'chatgpt-web/gpt-5.5', label: 'ChatGPT (OmniRoute)' },
  { value: CHATGPT_LOCAL_MODEL, label: 'ChatGPT (tài khoản riêng)' },
  { value: CHATGPT_EXTENSION_MODEL, label: 'ChatGPT (qua extension Chrome)' },
  { value: 'flow-image', label: 'Veo model' },
] as const;

/**
 * Ảnh sản phẩm mặc định làm reference khi gen ảnh (nếu người dùng chưa tự chọn).
 *
 * KHÔNG lấy đơn giản phần tử [0]: ảnh đầu tiên trên sàn TMĐT gần như luôn là ảnh bìa
 * marketing — dán badge "chính hãng 100%", khung viền, logo shop, nhiều màu tương phản.
 * Model gen ảnh bám theo ref sẽ nuốt luôn đám đồ hoạ đó, hoặc bị nhiễu tới mức vẽ lệch
 * hình dáng sản phẩm thật. Ảnh thứ 2 trở đi thường là ảnh chụp studio nền sạch — ref tốt
 * hơn hẳn. Chỉ rơi về [0] khi project vỏn vẹn 1 ảnh.
 *
 * ponytail: heuristic theo vị trí, đủ dùng vì thứ tự ảnh sàn TMĐT rất ổn định. Nâng cấp
 * bằng cách cho AI vision chấm chọn ảnh nền sạch nhất nếu về sau thấy chọn sai.
 */
export function defaultProductReferenceImage(productImages: string[]): string | undefined {
  return productImages[1] ?? productImages[0];
}
