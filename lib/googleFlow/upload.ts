/**
 * Upload ảnh lên Google Flow project (không cần reCAPTCHA) — trả mediaId.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { apiRequest, readJson } from './client';
import { FlowApiError } from './errors';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function mimeFor(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/png';
}

/** Upload 1 file ảnh từ đĩa → mediaId. */
export async function uploadImageFile(
  accessToken: string,
  projectId: string,
  filePath: string
): Promise<string> {
  const bytes = await fs.readFile(filePath);
  return uploadImageBytes(accessToken, projectId, bytes, path.basename(filePath));
}

/** Upload raw image bytes → mediaId. */
export async function uploadImageBytes(
  accessToken: string,
  projectId: string,
  bytes: Buffer,
  fileName: string
): Promise<string> {
  const res = await apiRequest('/v1/flow/uploadImage', {
    accessToken,
    json: {
      clientContext: { projectId, tool: 'PINHOLE' },
      imageBytes: bytes.toString('base64'),
      isUserUploaded: true,
      isHidden: false,
      mimeType: mimeFor(fileName),
      fileName,
    },
  });
  const data = await readJson<{ media?: { name?: string } }>(res);
  const mediaId = data.media?.name;
  if (!mediaId) {
    throw new FlowApiError('uploadImage không trả về mediaId');
  }
  return mediaId;
}
