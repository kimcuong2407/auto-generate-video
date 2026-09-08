/**
 * Resolve + download media từ Google Flow về đĩa.
 *
 * 2026-09: endpoint /fx/api/trpc/media.getMediaUrlRedirect đã chết cùng kiến trúc cũ. URL tải
 * giờ lấy qua RPC batchexecute `as29s` (xem flowRpc.ts) — cùng một rpcid cho cả ảnh lẫn video.
 * Signed URL (flow-content.google) không cần cookie khi GET nhưng có `Expires` ~6 giờ, nên
 * phải tải ngay, đừng cache lại dùng sau.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchRetry } from './client';
import { rpcMediaUrl } from './flowRpc';
import { FlowApiError } from './errors';
import type { FlowBatchCreds } from './authStore';

/** Lấy signed URL tải media. `prefer` chọn nhánh video hay ảnh khi cả hai cùng có. */
export async function resolveMediaUrl(
  creds: FlowBatchCreds,
  projectId: string,
  mediaId: string,
  prefer: 'video' | 'image' = 'video'
): Promise<string> {
  const { imageUrl, videoUrl } = await rpcMediaUrl({ creds, projectId, mediaId });
  const url = prefer === 'video' ? videoUrl || imageUrl : imageUrl || videoUrl;
  if (!url) {
    throw new FlowApiError(
      `Chưa có URL tải cho media ${mediaId} — job có thể chưa render xong, hoặc URL đã hết hạn.`
    );
  }
  return url;
}

/** Tải media (signed URL) về đường dẫn tuyệt đối. Trả chính destPath. */
export async function downloadUrlTo(url: string, destAbsPath: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60_000);
  try {
    const res = await fetchRetry(url, { signal: controller.signal });
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
export async function downloadMedia(
  creds: FlowBatchCreds,
  projectId: string,
  mediaId: string,
  destAbsPath: string,
  prefer: 'video' | 'image' = 'video'
): Promise<string> {
  const url = await resolveMediaUrl(creds, projectId, mediaId, prefer);
  return downloadUrlTo(url, destAbsPath);
}
