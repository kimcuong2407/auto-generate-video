/**
 * Client Cloudflare R2 (S3-compatible) — upload video output lên storage online để
 * xem/tải trực tiếp qua URL public, không phụ thuộc route stream file local trên VPS.
 * No-op an toàn khi thiếu config (R2_ENABLED = false) — call site tự fallback về local.
 */

import fs from 'node:fs/promises';
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

export function publicUrlFor(key: string): string {
  return `${R2_PUBLIC_URL}/${key}`;
}

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
