/**
 * Resolve + download media từ Google Flow về đĩa.
 *
 * getMediaUrlRedirect trả 3xx → header `Location` là signed CDN URL (flow-content.google).
 * Signed URL không cần cookie khi GET; phải fetch KHÔNG theo redirect để đọc Location trước.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { labsRequest, readJson } from './client';
import { FlowApiError } from './errors';

/** Lấy signed URL tải media (không follow redirect). */
export async function resolveMediaUrl(cookie: string, mediaId: string): Promise<string> {
  const res = await labsRequest(`/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}`, {
    cookie,
  });
  const location = res.headers.get('location');
  if (location) return location;
  // Fallback: đọc body JSON nếu endpoint trả URL trong body thay vì redirect.
  const data = await readJson<{ url?: string; redirectUrl?: string }>(res).catch(() => ({}));
  const url = data.url || data.redirectUrl;
  if (!url) {
    throw new FlowApiError(`Không lấy được URL tải cho media ${mediaId}`);
  }
  return url;
}

/** Tải media (signed URL) về đường dẫn tuyệt đối. Trả chính destPath. */
export async function downloadUrlTo(url: string, destAbsPath: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new FlowApiError(`Tải media thất bại HTTP ${res.status}`, res.status);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
    await fs.writeFile(destAbsPath, buf);
    return destAbsPath;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve + tải media về destAbsPath. */
export async function downloadMedia(cookie: string, mediaId: string, destAbsPath: string): Promise<string> {
  const url = await resolveMediaUrl(cookie, mediaId);
  return downloadUrlTo(url, destAbsPath);
}
