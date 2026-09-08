/**
 * Upload ảnh lên Google Flow project → mediaId.
 *
 * 2026-09: endpoint REST /v1/flow/uploadImage đã chết cùng kiến trúc Bearer; giờ đi qua
 * RPC batchexecute `maseQ` (xem flowRpc.ts). Khác biệt đáng lưu ý: upload NAY CẦN reCAPTCHA
 * token (trước thì không), nên caller phải mint trước khi gọi.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { rpcUploadImage } from './flowRpc';
import type { FlowBatchCreds } from './authStore';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function mimeFor(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/png';
}

/** Upload 1 file ảnh từ đĩa → mediaId. */
export async function uploadImageFile(
  creds: FlowBatchCreds,
  projectId: string,
  recaptchaToken: string,
  filePath: string
): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return uploadImageBytes(creds, projectId, recaptchaToken, bytes, path.basename(filePath));
}

/** Upload raw image bytes → mediaId. */
export async function uploadImageBytes(
  creds: FlowBatchCreds,
  projectId: string,
  recaptchaToken: string,
  bytes: Buffer,
  fileName: string
): Promise<string> {
  return rpcUploadImage({
    creds,
    projectId,
    recaptchaToken,
    bytes,
    mimeType: mimeFor(fileName),
    fileName,
  });
}
