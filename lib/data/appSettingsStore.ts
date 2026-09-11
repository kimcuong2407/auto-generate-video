import fs from 'node:fs';
import path from 'node:path';
import type { VeoModel } from '../types';

const APP_SETTINGS_PATH = path.join(process.cwd(), 'data', 'app-settings.json');

export interface AppSettings {
  /** Model AI chat (9router) người dùng chọn ở màn hình cấu hình. Null = dùng AI_CHAT_API_MODEL trong .env.local. */
  chatModel: string | null;
  /**
   * Model Veo dùng chung cho MỌI luồng gen video (product review + livestream).
   * Null = tôn trọng model lưu trong từng project/job như trước.
   */
  veoModel: VeoModel | null;
  /**
   * Provider gen ảnh dùng chung cho MỌI luồng gen ảnh (storyboard, background project,
   * background livestream). Null = tôn trọng model lưu trong từng project/job như trước.
   */
  imageModel: string | null;
  /**
   * Chế độ debug: dừng lại xin xác nhận TRƯỚC mỗi bước gọi AI trong lượt sinh script, kèm đúng
   * prompt sắp gửi. Tắt (mặc định) = chạy một mạch như cũ.
   *
   * Cờ TOÀN HỆ THỐNG chứ không theo job: mục đích là soi pipeline lúc chưa tin tưởng, duyệt xong
   * thì tắt một lần cho mọi job — không phải thứ cần bật lẻ từng job.
   */
  debugConfirmSteps: boolean;
  /**
   * Gọi Google Flow qua app Orino Flow (MCP) thay vì batchexecute trực tiếp.
   *
   * Tắt (mặc định) = giữ nguyên luồng cũ, không đổi gì. Bật = mọi lệnh tạo project / gen video /
   * gen ảnh Flow đi qua MCP, dùng phiên đăng nhập của app Orino (không cần cookie/reCAPTCHA
   * cấu hình trong app này).
   *
   * Cờ TOÀN HỆ THỐNG, cùng lý do với debugConfirmSteps: đây là chọn đường đi tới Google, không
   * phải thuộc tính của từng job.
   */
  useMcp: boolean;
}

export function readAppSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(APP_SETTINGS_PATH, 'utf-8');
    const data = JSON.parse(raw) as Partial<AppSettings>;
    return {
      chatModel: data.chatModel || null,
      veoModel: data.veoModel || null,
      imageModel: data.imageModel || null,
      debugConfirmSteps: data.debugConfirmSteps === true,
      useMcp: data.useMcp === true,
    };
  } catch {
    return { chatModel: null, veoModel: null, imageModel: null, debugConfirmSteps: false, useMcp: false };
  }
}

export function writeAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...readAppSettings(), ...patch };
  fs.mkdirSync(path.dirname(APP_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}
