/**
 * Đồng bộ ảnh input livestream (sản phẩm/mẫu/background) lên Cloudflare R2 để không mất khi
 * deploy/đổi server. Local vẫn là bản làm việc (Google Flow đọc file local làm refPaths r2v khi gen
 * video/ảnh), R2 là bản bền vững + nguồn khôi phục. Chỉ áp cho ảnh MỚI — ảnh cũ giữ nguyên local.
 *
 * URL R2 được lưu trong job.imageR2Urls (key = relPath, xem lib/livestream/types.ts). Mọi thao tác
 * best-effort: R2 chưa cấu hình (R2_ENABLED=false) hoặc lỗi mạng → no-op/null, KHÔNG chặn flow chính.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWithinJob, jobInputsDir } from './paths';
import { uploadFileToR2, deleteFromR2 } from '../r2/client';

/** Key object trên R2 cho 1 ảnh — relPath đã có tiền tố 'inputs/'. */
export function r2KeyForImage(slug: string, relPath: string): string {
  return `livestream/${slug}/${relPath}`;
}

/** Suy content-type từ đuôi file ảnh; mặc định image/jpeg. */
export function contentTypeForImage(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

/**
 * Upload 1 ảnh local (theo relPath) lên R2. Trả về URL public hoặc null (R2 tắt / lỗi / file thiếu).
 * Caller lưu URL vào job.imageR2Urls[relPath].
 */
export async function uploadImageToR2(slug: string, relPath: string): Promise<string | null> {
  return uploadFileToR2(
    resolveWithinJob(slug, relPath),
    r2KeyForImage(slug, relPath),
    contentTypeForImage(relPath)
  );
}

/** Xoá object ảnh trên R2 — best-effort, nuốt lỗi. Caller tự xoá key khỏi job.imageR2Urls. */
export async function deleteImageFromR2(slug: string, relPath: string): Promise<void> {
  await deleteFromR2(r2KeyForImage(slug, relPath));
}

/**
 * Đảm bảo ảnh có mặt ở LOCAL trước khi gen (Google Flow đọc file local làm refPaths). Nếu file local
 * đã tồn tại → no-op. Nếu mất (server mới sau deploy) mà có r2Url → tải từ R2 về đúng chỗ. Lỗi tải
 * được nuốt + log; call-site tự báo lỗi gen nếu ảnh thực sự thiếu.
 */
export async function ensureLocalImage(
  slug: string,
  relPath: string,
  r2Url: string | null | undefined
): Promise<void> {
  const absPath = resolveWithinJob(slug, relPath);
  try {
    await fs.access(absPath);
    return; // đã có local
  } catch {
    // không có local → thử tải từ R2
  }
  if (!r2Url) return; // không có bản R2 để khôi phục
  try {
    const res = await fetch(r2Url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(jobInputsDir(slug), { recursive: true });
    await fs.writeFile(absPath, buffer);
  } catch (err) {
    console.error(`[imageR2] tải lại ảnh ${relPath} từ R2 thất bại:`, err);
  }
}
