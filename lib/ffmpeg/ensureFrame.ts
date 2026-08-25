import fs from 'node:fs/promises';
import path from 'node:path';
import { extractLastFrame } from './frame';

/**
 * Đảm bảo file khung hình cuối (dùng làm start_path chain) có mặt ở local trước khi gen.
 * Frame chỉ nằm trên disk local (không sync R2 như ảnh input) nên sau deploy/đổi server hoặc
 * dọn disk, DB vẫn giữ lastFramePath nhưng file đã mất → generateVideo mở file → ENOENT.
 * Khôi phục bằng cách extract lại từ video: ưu tiên file local, không có thì đọc thẳng URL R2
 * (ffmpeg đọc http được). Trả về false nếu không khôi phục được — caller tự bỏ chain.
 */
export async function ensureLastFrame(
  frameAbsPath: string,
  videoAbsPath: string | null,
  videoUrl: string | null
): Promise<boolean> {
  try {
    await fs.access(frameAbsPath);
    return true;
  } catch {
    // frame mất → thử extract lại
  }

  const sources: string[] = [];
  if (videoAbsPath) {
    try {
      await fs.access(videoAbsPath);
      sources.push(videoAbsPath);
    } catch {
      // video local cũng mất → chỉ còn R2
    }
  }
  if (videoUrl) sources.push(videoUrl);

  for (const source of sources) {
    try {
      await fs.mkdir(path.dirname(frameAbsPath), { recursive: true });
      await extractLastFrame(source, frameAbsPath);
      return true;
    } catch (err) {
      console.error(`[ensureLastFrame] extract lại từ ${source} thất bại:`, err);
    }
  }
  return false;
}
