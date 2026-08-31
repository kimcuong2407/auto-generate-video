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
}

export function readAppSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(APP_SETTINGS_PATH, 'utf-8');
    const data = JSON.parse(raw) as Partial<AppSettings>;
    return {
      chatModel: data.chatModel || null,
      veoModel: data.veoModel || null,
      imageModel: data.imageModel || null,
    };
  } catch {
    return { chatModel: null, veoModel: null, imageModel: null };
  }
}

export function writeAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...readAppSettings(), ...patch };
  fs.mkdirSync(path.dirname(APP_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}
