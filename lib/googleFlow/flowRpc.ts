/**
 * 4 RPC batchexecute của Google Flow (upload / gen video / poll / lấy URL).
 *
 * Google gỡ hẳn REST + Bearer (aisandbox-pa.googleapis.com) vào 2026-09; mọi thao tác gen
 * giờ đi qua batchexecute trên chính flow.google.com với payload là MẢNG LỒNG, không phải
 * JSON có tên trường. Toàn bộ chỉ số dưới đây đọc từ HAR gen thật (docs/flow.google.com.har,
 * 2026-09-08) — không có tài liệu nào khác để đối chiếu, nên mỗi hằng số đều ghi rõ nguồn.
 *
 * Auth = cookie + `at` (xem authStore.batchCredsOf). reCAPTCHA token nằm TRONG payload,
 * không phải header như kiến trúc cũ.
 */

import crypto from 'node:crypto';
import { batchExecute } from './client';
import { FlowApiError } from './errors';
import type { FlowBatchCreds } from './authStore';

/** rpcid quan sát được trong HAR. */
export const RPC_UPLOAD_IMAGE = 'maseQ';
export const RPC_GENERATE_VIDEO = 'eb1hJf';
export const RPC_POLL = 'jwpduf';
export const RPC_MEDIA_URL = 'as29s';

/**
 * Hằng số `22` ở vị trí [1] của clientContext.
 *
 * Xuất hiện y hệt trong CẢ maseQ lẫn eb1hJf của HAR — nhiều khả năng là mã tool PINHOLE
 * (kiến trúc cũ gửi `tool: 'PINHOLE'` ở đúng vị trí tương ứng). Gửi cố định như trang thật.
 */
const CLIENT_TOOL_CODE = 22;

/**
 * Trạng thái job trong response poll, đọc tại [5][8][0].
 *
 * XÁC MINH: trong HAR, job b5b1f743 giữ giá trị 2 suốt 8 lần poll rồi chuyển 3 ở lần thứ 9,
 * đúng lúc as29s bắt đầu trả URL video. Không quan sát được mã lỗi (không có job nào fail
 * trong HAR) — nên mọi giá trị lạ được coi là 'running' thay vì đoán bừa là lỗi: đoán sai
 * thành 'error' sẽ giết job đang chạy bình thường, đoán sai thành 'running' chỉ tốn thêm
 * vài vòng poll rồi timeout ở tầng trên.
 */
const STATE_RUNNING = 2;
const STATE_DONE = 3;

/** Đường dẫn mảng lồng — tách hằng số để chỗ sửa khi Google đổi layout là DUY NHẤT. */
const PATH_POLL_JOBS = [2] as const;
const PATH_JOB_STATE = [5, 8, 0] as const;
const PATH_MEDIA_IMAGE_URL = [5, 10] as const;
const PATH_MEDIA_VIDEO_URL = [7, 0, 8] as const;
const PATH_UPLOAD_MEDIA_ID = [0, 0] as const;
const PATH_GEN_OPERATIONS = [3] as const;

/** Đọc mảng lồng theo chỉ số, trả null nếu đường dẫn không tồn tại (Google đổi layout). */
function at(root: unknown, path: readonly number[]): unknown {
  let cur: unknown = root;
  for (const i of path) {
    if (!Array.isArray(cur) || cur.length <= i) return null;
    cur = cur[i];
  }
  return cur ?? null;
}

/** UUID hoa — trang thật gửi dạng này ở các trường tracking id. */
function uuidUpper(): string {
  return crypto.randomUUID().toUpperCase();
}

/**
 * clientContext dùng chung cho maseQ và eb1hJf.
 * Vị trí [10] là mảng chứa reCAPTCHA token; các slot null ở giữa là trường trang thật bỏ trống.
 */
function clientContext(projectId: string, recaptchaToken: string): unknown[] {
  return [null, CLIENT_TOOL_CODE, null, null, null, projectId, null, null, null, null, [recaptchaToken, 1]];
}

/** Upload 1 ảnh (base64 nhét thẳng trong payload) → mediaId. */
export async function rpcUploadImage(opts: {
  creds: FlowBatchCreds;
  projectId: string;
  recaptchaToken: string;
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const payload = [
    clientContext(opts.projectId, opts.recaptchaToken),
    opts.bytes.toString('base64'),
    opts.mimeType,
    1,
    null,
    null,
    null,
    null,
    opts.fileName,
    null,
    uuidUpper(),
    uuidUpper(),
  ];
  const res = await batchExecute(RPC_UPLOAD_IMAGE, payload, {
    creds: opts.creds,
    sourcePath: `/project/${opts.projectId}`,
    // Ảnh base64 vài MB: 60s mặc định là quá ngắn khi mạng chậm.
    timeoutMs: 180_000,
  });
  const mediaId = at(res, PATH_UPLOAD_MEDIA_ID);
  if (typeof mediaId !== 'string' || !mediaId) {
    throw new FlowApiError(`Upload ảnh (${RPC_UPLOAD_IMAGE}) không trả mediaId. Response: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return mediaId;
}

/** 1 cảnh cần gen — lặp nhiều phần tử trong cùng 1 request để gen nhiều video một lượt. */
export interface VideoScene {
  prompt: string;
  modelKey: string;
  /** mediaId ảnh đầu (i2v). Bỏ trống = text-to-video. */
  startMediaId?: string;
}

function buildScene(scene: VideoScene): unknown[] {
  return [
    [null, null, [[[scene.prompt]]]],
    scene.modelKey,
    1,
    null,
    // [1] = mediaId ảnh đầu; [5] = cặp trọng số ảnh đầu/cuối. HAR gửi cố định cặp
    // [null, 0.000265…, 1, 0.999734…] kể cả khi chỉ có ảnh đầu, nên gửi y nguyên.
    scene.startMediaId
      ? [null, scene.startMediaId, null, null, null, [null, 0.0002656748140276166, 1, 0.9997343251859724]]
      : null,
    [null, null, null, null, uuidUpper(), uuidUpper()],
  ];
}

/** Gen video → danh sách operationId (1 phần tử cho mỗi scene gửi lên). */
export async function rpcGenerateVideo(opts: {
  creds: FlowBatchCreds;
  projectId: string;
  recaptchaToken: string;
  scenes: VideoScene[];
}): Promise<string[]> {
  if (opts.scenes.length === 0) throw new FlowApiError('rpcGenerateVideo: không có scene nào để gen');

  const payload = [
    opts.scenes.map(buildScene),
    clientContext(opts.projectId, opts.recaptchaToken),
    // [<uuid>, 2] — batch id của lần bấm gen, trang thật gửi kèm hằng 2.
    [uuidUpper(), 2],
  ];
  const res = await batchExecute(RPC_GENERATE_VIDEO, payload, {
    creds: opts.creds,
    sourcePath: `/project/${opts.projectId}`,
    timeoutMs: 120_000,
  });

  const ops = at(res, PATH_GEN_OPERATIONS);
  const ids = Array.isArray(ops)
    ? ops.map((job) => (Array.isArray(job) && typeof job[0] === 'string' ? job[0] : null)).filter((x): x is string => !!x)
    : [];
  if (ids.length === 0) {
    throw new FlowApiError(`Gen video (${RPC_GENERATE_VIDEO}) không trả operationId. Response: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return ids;
}

export type FlowJobState = 'running' | 'done';

/** Poll nhiều operationId cùng lúc → map id → trạng thái. */
export async function rpcPollJobs(opts: {
  creds: FlowBatchCreds;
  projectId: string;
  operationIds: string[];
}): Promise<Record<string, FlowJobState>> {
  const payload = [null, null, [opts.operationIds]];
  const res = await batchExecute(RPC_POLL, payload, {
    creds: opts.creds,
    sourcePath: `/project/${opts.projectId}`,
    timeoutMs: 30_000,
  });

  const jobs = at(res, PATH_POLL_JOBS);
  const out: Record<string, FlowJobState> = {};
  if (Array.isArray(jobs)) {
    for (const job of jobs) {
      const id = Array.isArray(job) ? job[0] : null;
      if (typeof id !== 'string') continue;
      out[id] = at(job, PATH_JOB_STATE) === STATE_DONE ? 'done' : 'running';
    }
  }
  return out;
}

/**
 * Lấy signed CDN URL của media (dùng chung cho cả ảnh lẫn video — cùng 1 rpcid).
 *
 * URL có `Expires` ~6 giờ nên phải tải ngay, không cache lâu.
 */
export async function rpcMediaUrl(opts: {
  creds: FlowBatchCreds;
  projectId: string;
  mediaId: string;
}): Promise<{ imageUrl: string | null; videoUrl: string | null }> {
  const res = await batchExecute(RPC_MEDIA_URL, [opts.mediaId], {
    creds: opts.creds,
    sourcePath: `/project/${opts.projectId}`,
    timeoutMs: 30_000,
  });
  const pick = (path: readonly number[]): string | null => {
    const v = at(res, path);
    return typeof v === 'string' && v.startsWith('http') ? v : null;
  };
  return { imageUrl: pick(PATH_MEDIA_IMAGE_URL), videoUrl: pick(PATH_MEDIA_VIDEO_URL) };
}

/** Chỉ dùng cho scripts/check-flow-rpc.ts. */
export const __testables = { at, buildScene, clientContext, STATE_RUNNING, STATE_DONE };
