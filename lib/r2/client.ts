/**
 * Client Cloudflare R2 (S3-compatible) — upload video output lên storage online để
 * xem/tải trực tiếp qua URL public, không phụ thuộc route stream file local trên VPS.
 * No-op an toàn khi thiếu config (R2_ENABLED = false) — call site tự fallback về local.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_URL,
  R2_ENABLED,
} from '../constants';

let cachedClient: S3Client | null = null;

function client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return cachedClient;
}

/** md5 của 1 file, đọc theo stream để không nạp cả video vào RAM. */
export async function md5File(absPath: string): Promise<string> {
  const hash = crypto.createHash('md5');
  for await (const chunk of createReadStream(absPath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Suy ngược key R2 từ URL public đã lưu — để xoá đúng object cũ khi key mang hash nội dung
 * và mỗi bản là một key riêng. Trả null nếu URL không thuộc bucket này (cấu hình đổi, URL
 * ngoài) — caller bỏ qua thay vì xoá nhầm.
 */
export function keyFromPublicUrl(url: string | null | undefined): string | null {
  // R2_PUBLIC_URL rỗng (chưa cấu hình) → prefix thành "/" và mọi path tương đối sẽ khớp,
  // dẫn tới suy ra key bừa. Chặn sớm.
  if (!url || !R2_PUBLIC_URL) return null;
  const prefix = `${R2_PUBLIC_URL}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length).split('?')[0];
  return key || null;
}

export function publicUrlFor(key: string): string {
  return `${R2_PUBLIC_URL}/${key}`;
}

/**
 * Cache-control cho MỌI object upload lên R2.
 *
 * Vì sao cần: key ở đây CỐ ĐỊNH theo vai trò (final.mp4, segments/001_seg-01.mp4, ảnh input) và
 * bị GHI ĐÈ mỗi lần gen/ghép lại — URL không bao giờ đổi. Không gửi cache-control thì trình duyệt
 * tự suy heuristic từ last-modified và cache rất dai với thẻ <video>: người dùng ghép lại xong,
 * server + R2 đều đã là bản mới, nhưng trình duyệt vẫn phát bản cũ đã tải.
 *
 * `no-cache` KHÔNG có nghĩa "không cache" — nó cho phép lưu nhưng bắt revalidate với server trước
 * mỗi lần dùng. File không đổi thì trả 304 (không tốn băng thông), file đã đổi thì tải bản mới.
 * Đúng thứ cần cho object bị ghi đè tại chỗ.
 */
const R2_CACHE_CONTROL = process.env.R2_CACHE_CONTROL || 'no-cache';

/**
 * Upload 1 file local lên R2. Trả về URL public, hoặc null nếu R2 chưa cấu hình
 * hoặc upload thất bại (lỗi được nuốt — best-effort, không chặn flow chính gọi hàm này).
 */
export async function uploadFileToR2(
  localAbsPath: string,
  key: string,
  contentType: string
): Promise<string | null> {
  if (!R2_ENABLED) return null;
  try {
    const body = await fs.readFile(localAbsPath);
    await client().send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: R2_CACHE_CONTROL,
      })
    );
    return publicUrlFor(key);
  } catch (err) {
    console.error(`[r2] upload thất bại cho ${key}:`, err);
    return null;
  }
}

/**
 * Đảm bảo file có mặt ở LOCAL trước khi đọc (VD gửi ref ảnh cho Google Flow, đọc ảnh phân
 * tích vision) — nếu mất (project tạo/chạy ở máy khác, share chung DB/R2, hoặc server mới
 * sau deploy) mà có url đã biết thì tải về khôi phục. No-op nếu đã có local hoặc không có
 * url. Lỗi tải bị nuốt + log — caller tự phát hiện file vẫn thiếu (đọc sẽ ENOENT như cũ).
 */
export async function ensureLocalFile(absPath: string, url: string | null | undefined): Promise<void> {
  try {
    await fs.access(absPath);
    return;
  } catch {
    // thiếu local — thử tải lại từ R2
  }
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
  } catch (err) {
    console.error(`[r2] khôi phục local thất bại cho ${absPath}:`, err);
  }
}

/** Xoá 1 object trên R2 — best-effort, nuốt lỗi. */
export async function deleteFromR2(key: string): Promise<void> {
  if (!R2_ENABLED) return;
  try {
    await client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (err) {
    console.error(`[r2] xoá thất bại cho ${key}:`, err);
  }
}
