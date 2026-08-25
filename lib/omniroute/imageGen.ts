/**
 * Sinh ảnh qua OmniRoute (OpenAI-images-compatible), dùng làm provider gen ảnh storyboard/
 * background thay thế khi `storyboard.model` là model OmniRoute (chứa "/", vd
 * "chatgpt-web/gpt-5.5") — xem nhánh rẽ trong lib/googleFlow/flowJobs.ts:generateStoryboardImage.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { mimeFor } from '../googleFlow/upload';

export interface GenerateOmniImageParams {
  prompt: string;
  /** Model OmniRoute, vd "chatgpt-web/gpt-5.5". */
  model: string;
  /**
   * Ảnh tham chiếu (đường dẫn file local) — gửi kèm request /v1/images/generations dạng
   * base64 data URI qua field "image". API chỉ nhận 1 ảnh nên chỉ ảnh đầu tiên được dùng;
   * nếu upload thất bại, upstream tự fallback về text-only (không lỗi).
   */
  refImagePaths?: string[];
  /**
   * Tỉ lệ khung hình mong muốn. Ảnh storyboard được nạp thẳng làm khung hình khởi điểm khi gen
   * video, nên phải cùng tỉ lệ với video — ảnh vuông buộc Veo crop/reframe ngay khung đầu.
   */
  aspect?: '9:16' | '16:9';
  timeoutMs?: number;
}

/** Kích thước gửi API theo tỉ lệ — bội số 8, bám sát các size OpenAI-images thường chấp nhận. */
const SIZE_BY_ASPECT: Record<string, string> = {
  '9:16': '1024x1792',
  '16:9': '1792x1024',
};

const TMP_DIR = path.join(process.cwd(), 'data', 'tmp', 'omni-image');

export async function generateOmniImage(params: GenerateOmniImageParams): Promise<string[]> {
  const baseUrl = (process.env.OMNIROUTE_IMAGE_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.OMNIROUTE_IMAGE_API_KEY || '';
  if (!baseUrl || !apiKey) {
    throw new Error('Chưa cấu hình OMNIROUTE_IMAGE_API_URL / OMNIROUTE_IMAGE_API_KEY');
  }

  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: 1,
    size: (params.aspect && SIZE_BY_ASPECT[params.aspect]) || '1024x1024',
  };

  const refPath = params.refImagePaths?.[0];
  if (refPath) {
    const bytes = await fs.readFile(refPath);
    body.image = `data:${mimeFor(refPath)};base64,${bytes.toString('base64')}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs || 10 * 60_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OmniRoute image API lỗi ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
  const items = data.data || [];
  if (items.length === 0) {
    throw new Error('OmniRoute image API không trả về ảnh nào');
  }

  await fs.mkdir(TMP_DIR, { recursive: true });
  const paths: string[] = [];
  for (const item of items) {
    const dest = path.join(TMP_DIR, `img-${crypto.randomBytes(6).toString('hex')}.png`);
    if (item.b64_json) {
      await fs.writeFile(dest, Buffer.from(item.b64_json, 'base64'));
    } else if (item.url) {
      const imgRes = await fetch(item.url);
      if (!imgRes.ok) throw new Error(`Tải ảnh kết quả từ OmniRoute thất bại: ${imgRes.status}`);
      await fs.writeFile(dest, Buffer.from(await imgRes.arrayBuffer()));
    } else {
      continue;
    }
    paths.push(dest);
  }

  if (paths.length === 0) {
    throw new Error('OmniRoute image API không trả về ảnh hợp lệ');
  }
  return paths;
}
