/**
 * Constants gen ảnh dùng chung CẢ server (data layer) LẪN client (dropdown UI) — tách khỏi
 * lib/constants.ts vì file đó import 'node:path' (không bundle được cho client component).
 */

// Model ảnh mặc định cho mọi bước gen ảnh (storyboard, background project, background
// livestream) — Google Flow (Veo), dùng chung 1 default cho cả 3 field model.
// (Từng mặc định OmniRoute/ChatGPT-web, đổi vì pool account chatgpt-web trên OmniRoute
// lỗi 401 "Authentication failed for all eligible image-provider accounts".)
export const DEFAULT_STORYBOARD_MODEL = 'flow-image';

// 2 option provider gen ảnh hiển thị ở UI (StoryboardStep, JobImagePanel) — value là chuỗi
// `model` thực gửi xuống generateStoryboardImage(): có "/" → OmniRoute, không có → Google Flow.
export const IMAGE_MODEL_OPTIONS = [
  { value: 'chatgpt-web/gpt-5.5', label: 'ChatGPT' },
  { value: 'flow-image', label: 'Veo model' },
] as const;
