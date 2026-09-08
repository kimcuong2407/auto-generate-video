/**
 * Sinh ảnh qua batchGenerateImages (aisandbox-pa.googleapis.com).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { FlowApiError } from './errors';
import type { FlowAccount } from './authStore';
import type { RefImageInput } from './videoGen';

export type ImageAspect = '16:9' | '9:16' | '1:1' | '3:4' | '4:3';

const ASPECT_MAP: Record<ImageAspect, string> = {
  '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
  '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
  '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR',
  '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE',
};

const KNOWN_IMAGE_MODELS = ['flow-image', 'HARBOR_SEAL', 'GEM_PIX_2', 'NARWHAL'];

/** Model ảnh mặc định của Google Flow (batchGenerateImages). */
function resolveImageModel(model?: string): string {
  if (model && KNOWN_IMAGE_MODELS.includes(model) && model !== 'flow-image') return model;
  return 'NARWHAL';
}

export interface GenerateImageParams {
  account: FlowAccount;
  accessToken: string;
  prompt: string;
  aspect: ImageAspect;
  model?: string;
  projectId: string;
  refImages?: RefImageInput[];
  count?: number;
}

export interface GenerateImageResult {
  dir: string;
  paths: string[];
  uploadedMediaIds: Record<string, string>;
}

const TMP_DIR = path.join(process.cwd(), 'data', 'tmp', 'flow-image');

/**
 * Đọc kích thước ảnh từ header JPEG/PNG (không cần dependency/spawn process).
 * Trả null nếu không nhận dạng được — caller coi như "không kiểm tra được", không chặn luồng.
 */
function readImageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: 8 byte signature, rồi chunk IHDR có width/height ở offset 16/20.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: duyệt các marker segment tới SOFn (0xC0-0xCF, trừ C4/C8/CC) — chứa height/width.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * Google trả ảnh SAI tỉ lệ so với imageAspectRatio đã yêu cầu một cách không ổn định (cùng
 * prompt/ref/tham số, lúc ra dọc lúc ra ngang). Ảnh storyboard được nạp thẳng làm khung hình
 * khởi điểm khi gen video, nên ảnh lệch tỉ lệ buộc Veo crop/reframe — hỏng bố cục ngay khung
 * đầu. Ném lỗi để caller đánh "failed" và người dùng Retry, thay vì âm thầm nhận ảnh sai.
 */
function assertAspect(buf: Buffer, aspect: ImageAspect): void {
  const size = readImageSize(buf);
  if (!size || !size.width || !size.height) return;
  const [w, h] = aspect.split(':').map(Number);
  if (!w || !h) return;
  const want = w / h;
  const got = size.width / size.height;
  // Dung sai 12%: đủ rộng cho lệch vài pixel do model làm tròn, đủ chặt để bắt dọc↔ngang.
  if (Math.abs(got - want) / want > 0.12) {
    throw new FlowApiError(
      `Google trả ảnh sai tỉ lệ: yêu cầu ${aspect} nhưng nhận ${size.width}x${size.height}. Bấm Retry để gen lại.`
    );
  }
}

/**
 * Sinh ảnh — CHƯA PORT sang batchexecute.
 *
 * 2026-09: Google gỡ REST batchGenerateImages cùng kiến trúc Bearer. Luồng video đã chuyển
 * sang RPC batchexecute (xem flowRpc.ts), nhưng HAR hiện có (docs/flow.google.com.har) chỉ
 * ghi được thao tác UPLOAD ảnh có sẵn, không có lần nào gen ảnh từ prompt — nên rpcid và
 * hình dạng payload của text→image vẫn chưa biết.
 *
 * Ném lỗi tường minh thay vì gọi host đã chết: đường cũ trả 401 "Expected OAuth 2 access
 * token", một thông báo dẫn thẳng người đọc đi sửa nhầm phần đăng nhập.
 *
 * Để hoàn thiện: capture HAR một lần gen ảnh trên flow.google.com, lấy rpcid + payload, rồi
 * viết rpcGenerateImage trong flowRpc.ts theo đúng khuôn rpcGenerateVideo.
 */
export async function generateImage(_params: GenerateImageParams): Promise<GenerateImageResult> {
  throw new FlowApiError(
    'Gen ảnh qua Google Flow chưa khả dụng: Google đã đổi sang giao thức batchexecute và ' +
      'phần text→image chưa được port (thiếu HAR của thao tác gen ảnh). Gen video vẫn chạy bình thường.'
  );
}

/** Chỉ dùng cho scripts/check-image-aspect.ts. */
export const __testables = { readImageSize, assertAspect };
