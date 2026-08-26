/**
 * Sinh video qua các endpoint batchAsyncGenerateVideo* + poll status
 * (aisandbox-pa.googleapis.com).
 */

import crypto from 'node:crypto';
import { apiRequest, readJson, RECAPTCHA_ACTION_VIDEO } from './client';
import { acquireRecaptchaContext } from './recaptcha';
import { uploadImageFile } from './upload';
import { FlowApiError } from './errors';
import type { FlowAccount } from './authStore';
import type { VeoModel } from '../types';

export type VideoAspect = '16:9' | '9:16';

const VIDEO_ASPECT_MAP: Record<VideoAspect, string> = {
  '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE',
  '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT',
};

export type VideoMode = 't2v' | 'i2v_s' | 'i2v_se' | 'r2v' | 'edit';

interface CoreParts {
  base: string;
  suffix: string;
}

function coreParts(model: VeoModel): CoreParts {
  switch (model) {
    case 'veo_3_1_quality':
      return { base: 'quality', suffix: '' };
    case 'veo_3_1_fast':
      return { base: 'fast', suffix: '' };
    case 'veo_3_1_lite':
      return { base: 'lite', suffix: '' };
    case 'veo_3_1_lite_low_priority':
      return { base: 'lite', suffix: '_low_priority' };
    case 'abra':
      return { base: 'abra', suffix: '' };
  }
}

/** duration 8s là mặc định → bỏ hậu tố; 4/6/10s thêm _Ns. */
function durationSuffix(duration: number): string {
  return duration === 8 ? '' : `_${duration}s`;
}

/**
 * Dùng tier `lite_low_priority` cho mode r2v (thay vì `lite` thường).
 *
 * Đổi về false nếu Google thu lại quyền tier này (403 PUBLIC_ERROR_MODEL_ACCESS_DENIED) — 403
 * không được thử biến thể khác nên sẽ giết cả lần gen, phải sửa tay tại đây.
 * Đặt env FLOW_R2V_LOW_PRIORITY=false để tắt nhanh trên production mà không cần deploy.
 */
const R2V_USE_LOW_PRIORITY = (process.env.FLOW_R2V_LOW_PRIORITY ?? 'true').toLowerCase() !== 'false';

/**
 * Dựng videoModelKey (best-effort, reverse-engineered — xem GoogleFlow.postman_collection.json).
 * - core tier: quality/fast/lite/lite_low_priority/abra.
 * - mode infix: t2v (text), i2v_s (start image), i2v_se (start+end, thêm _fl), r2v (reference),
 *   edit (abra edit).
 * - Có thể override toàn bộ qua env FLOW_VIDEO_MODEL_KEY_OVERRIDE khi key thực tế khác.
 */
export function resolveVideoModelKey(
  model: VeoModel,
  mode: VideoMode,
  duration: number,
  useFl: boolean
): string {
  const override = process.env.FLOW_VIDEO_MODEL_KEY_OVERRIDE;
  if (override && override.trim()) return override.trim();

  if (model === 'abra') {
    // Omni Flash: key đơn giản `abra_<mode>`, edit dùng `abra_edit` (xác minh trong collection).
    if (mode === 'edit') return 'abra_edit';
    return `abra_${mode}${durationSuffix(duration)}${useFl ? '_fl' : ''}`;
  }

  // Mode reference-to-video (r2v — @Characters/ảnh người mẫu) của Veo 3.1 KHÔNG có tier
  // fast/quality (Google trả 404 NOT_FOUND), nên tier luôn bị ép về lite bất kể model job chọn.
  //
  // Dùng `_low_priority`: XÁC MINH THỰC NGHIỆM 2026-08-26 — gen thật qua production, Google chấp
  // nhận `veo_3_1_r2v_lite_low_priority` và render xong bình thường. Ghi chú cũ (2026-08-25) nói
  // tier này trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED đã KHÔNG còn đúng: quyền tài khoản đổi theo
  // thời gian, nên đây là điều cần đo lại chứ không phải hằng số.
  //
  // Vì sao chọn low_priority: nó tiêu tốn quota chậm hơn tier lite thường — với job livestream
  // hàng chục đoạn thì đây là khác biệt giữa chạy hết block và cụt giữa chừng vì hết quota.
  // Đánh đổi: hàng đợi ưu tiên thấp nên thời gian chờ render có thể lâu hơn.
  //
  // Nếu Google thu lại quyền (403 trở lại), đổi cờ này về false là quay lại hành vi cũ ngay;
  // 403 KHÔNG được fallback tự động (xem modelKeyCandidates) nên phải sửa ở đây.
  if (mode === 'r2v') {
    const tier = R2V_USE_LOW_PRIORITY ? 'lite_low_priority' : 'lite';
    return `veo_3_1_r2v_${tier}${durationSuffix(duration)}`;
  }

  const { base, suffix } = coreParts(model);
  const modeInfix = mode === 'i2v_se' ? 'i2v_s' : mode;
  return `veo_3_1_${modeInfix}_${base}${durationSuffix(duration)}${suffix}${useFl ? '_fl' : ''}`;
}

/** 1 ảnh reference kèm mediaId Flow đã biết (cache) — bỏ trống nếu chưa từng upload. */
export interface RefImageInput {
  path: string;
  mediaId?: string;
}

export interface GenerateVideoParams {
  account: FlowAccount;
  accessToken: string;
  prompt: string;
  aspect: VideoAspect;
  model: VeoModel;
  projectId: string;
  duration: number;
  refImages?: RefImageInput[];
  startImage?: RefImageInput;
  endImage?: RefImageInput;
  /** Seed cố định (VD dùng chung cả job) — nếu bỏ trống, random như trước. */
  seed?: number;
}

export interface GenerateVideoResult {
  job_id: string;
  /** mediaId của các ảnh vừa upload MỚI (chưa có trong cache) — caller lưu lại để tái dùng lần sau. */
  uploadedMediaIds: Record<string, string>;
}

/** Trả mediaId có sẵn nếu đã cache, ngược lại upload rồi ghi nhận vào `uploaded`. */
async function resolveMediaId(
  accessToken: string,
  projectId: string,
  ref: RefImageInput,
  uploaded: Record<string, string>
): Promise<string> {
  if (ref.mediaId) return ref.mediaId;
  const mediaId = await uploadImageFile(accessToken, projectId, ref.path);
  uploaded[ref.path] = mediaId;
  return mediaId;
}

interface VideoWorkflowResponse {
  workflows?: Array<{ name?: string; metadata?: { primaryMediaId?: string } }>;
  operations?: Array<{ operation?: { name?: string } }>;
}

/** Tạo batchId + sessionId + recaptchaContext dùng chung cho các endpoint video. */
async function buildVideoBody(params: GenerateVideoParams, extra: Record<string, unknown>) {
  const recaptchaContext = await acquireRecaptchaContext(params.account.id, RECAPTCHA_ACTION_VIDEO);
  const sessionId = `;${Date.now()}`;
  const batchId = crypto.randomUUID();
  return {
    mediaGenerationContext: {
      batchId,
      audioFailurePreference: 'BLOCK_SILENCED_VIDEOS',
    },
    clientContext: {
      ...recaptchaContext,
      projectId: params.projectId,
      tool: 'PINHOLE',
      userPaygateTier: 'PAYGATE_TIER_TWO',
      sessionId,
    },
    ...extra,
  };
}

/** Extract pending mediaId từ response workflow/operation. */
function extractMediaId(data: VideoWorkflowResponse): string {
  const mediaId = data.workflows?.[0]?.metadata?.primaryMediaId ?? data.operations?.[0]?.operation?.name;
  if (!mediaId) {
    throw new FlowApiError('Generate video không trả về mediaId để theo dõi');
  }
  return mediaId;
}

/**
 * Sinh video — chọn endpoint theo input:
 * - refPaths → ReferenceImages, start+end → StartAndEndImage, start → StartImage, else Text.
 */
export async function generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult> {
  const aspectRatio = VIDEO_ASPECT_MAP[params.aspect] ?? VIDEO_ASPECT_MAP['16:9'];
  const textInput = { structuredPrompt: { parts: [{ text: params.prompt }] } };
  const seed = params.seed ?? Math.floor(Math.random() * 1_000_000);

  const hasRef = params.refImages && params.refImages.length > 0;
  const hasStart = !!params.startImage;
  const hasEnd = !!params.endImage;
  const uploadedMediaIds: Record<string, string> = {};

  let endpoint: string;
  let mode: VideoMode;
  let request: Record<string, unknown>;
  const common = { aspectRatio, textInput, seed, metadata: {} };

  if (hasRef) {
    endpoint = '/v1/video:batchAsyncGenerateVideoReferenceImages';
    mode = 'r2v';
    const referenceImages = [];
    for (const ref of params.refImages!) {
      const mediaId = await resolveMediaId(params.accessToken, params.projectId, ref, uploadedMediaIds);
      referenceImages.push({ mediaId, imageUsageType: 'IMAGE_USAGE_TYPE_ASSET' });
    }
    request = { ...common, referenceImages };
  } else if (hasStart && hasEnd) {
    endpoint = '/v1/video:batchAsyncGenerateVideoStartAndEndImage';
    mode = 'i2v_se';
    const startMediaId = await resolveMediaId(params.accessToken, params.projectId, params.startImage!, uploadedMediaIds);
    const endMediaId = await resolveMediaId(params.accessToken, params.projectId, params.endImage!, uploadedMediaIds);
    request = {
      ...common,
      startImage: { mediaId: startMediaId, cropCoordinates: { top: 0, left: 0, bottom: 1, right: 1 } },
      endImage: { mediaId: endMediaId, cropCoordinates: { top: 0, left: 0, bottom: 1, right: 1 } },
    };
  } else if (hasStart) {
    endpoint = '/v1/video:batchAsyncGenerateVideoStartImage';
    mode = 'i2v_s';
    const startMediaId = await resolveMediaId(params.accessToken, params.projectId, params.startImage!, uploadedMediaIds);
    request = {
      ...common,
      startImage: { mediaId: startMediaId, cropCoordinates: { top: 0, left: 0, bottom: 1, right: 1 } },
    };
  } else {
    endpoint = '/v1/video:batchAsyncGenerateVideoText';
    mode = 't2v';
    request = { ...common };
  }

  const useFl = mode === 'i2v_se';
  const videoModelKey = resolveVideoModelKey(params.model, mode, params.duration, useFl);

  const res = await requestWithModelKeyFallback(
    endpoint,
    videoModelKey,
    params,
    request,
    mode
  );
  const data = await readJson<VideoWorkflowResponse>(res);
  return { job_id: extractMediaId(data), uploadedMediaIds };
}

/**
 * Các biến thể videoModelKey để thử khi Google trả 404 cho key dựng theo quy tắc.
 *
 * Vì sao cần: videoModelKey là chuỗi reverse-engineered — Google KHÔNG công bố danh sách key
 * hợp lệ, và không phải tổ hợp (mode × tier) nào cũng tồn tại. Key không tồn tại trả về
 * 404 NOT_FOUND giống hệt lỗi "project entity không tồn tại", nên rất dễ chẩn đoán nhầm.
 * Tiền lệ đã biết: r2v CHỈ có tier lite (xem resolveVideoModelKey).
 *
 * Chỉ sinh biến thể ĐỔI DẠNG HẬU TỐ, giữ nguyên tier của người dùng — không tự hạ/nâng tier
 * vì tier quyết định chi phí và chất lượng, đổi ngầm là vượt quyền quyết định của người dùng.
 */
function modelKeyCandidates(baseKey: string): string[] {
  const out = [baseKey];
  // Biến thể `_fl` ("first+last"): collection có veo_3_1_i2v_s_lite_6s_fl.
  if (!baseKey.endsWith('_fl')) out.push(`${baseKey}_fl`);
  // i2v_s + lite: XÁC MINH THỰC NGHIỆM (2026-08-25) — `veo_3_1_i2v_s_lite` và
  // `veo_3_1_i2v_s_lite_fl` đều trả 404; key dùng được là `veo_3_1_i2v_lite`, tức tier lite
  // dùng tên mode RÚT GỌN `i2v` (không có `_s`) trong khi fast/quality dùng `i2v_s`.
  if (baseKey.includes('_i2v_s_')) {
    const short = baseKey.replace('_i2v_s_', '_i2v_');
    out.push(short, `${short}_fl`);
  }
  // KHÔNG thêm biến thể `_low_priority`: tier này tài khoản thường không được cấp quyền →
  // Google trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED (xác minh 2026-08-25). 403 khác 404 ở chỗ
  // nó KHÔNG được thử tiếp, nên một ứng viên 403 lọt vào danh sách sẽ giết cả lần gen.
  return Array.from(new Set(out));
}

/**
 * Gọi endpoint gen video, tự thử các biến thể videoModelKey khi gặp 404.
 *
 * Trả về Response đầu tiên không-404. Nếu mọi biến thể đều 404 thì trả Response 404 CUỐI CÙNG
 * để readJson ném lỗi như bình thường (giữ nguyên hành vi lỗi cũ, không nuốt lỗi) — caller
 * (generateSceneVideo) bắt 404 đó qua isEntityNotFound và tạo lại Flow project.
 *
 * CẢNH GIÁC KHI ĐỌC LOG: 404 ở đây có HAI nguyên nhân hoàn toàn khác nhau, cùng một mã lỗi —
 * (a) videoModelKey không tồn tại thật, (b) Flow PROJECT đã bị Google xoá/hết hạn (mọi key đều
 * 404). Phân biệt bằng chính danh sách này: chỉ MỘT vài biến thể 404 → nghi key; TOÀN BỘ biến
 * thể đều 404 → gần như chắc chắn là project hết hạn, không phải key. Xem log tổng kết bên dưới.
 */
async function requestWithModelKeyFallback(
  endpoint: string,
  baseKey: string,
  params: GenerateVideoParams,
  request: Record<string, unknown>,
  mode: VideoMode
): Promise<Response> {
  const override = process.env.FLOW_VIDEO_MODEL_KEY_OVERRIDE;
  // Người dùng đã ép key qua env → tôn trọng tuyệt đối, không tự thử biến thể khác.
  const candidates = override && override.trim() ? [baseKey] : modelKeyCandidates(baseKey);

  let lastRes: Response | null = null;
  for (const key of candidates) {
    const body = await buildVideoBody(params, {
      requests: [{ ...request, videoModelKey: key }],
      useV2ModelConfig: true,
    });
    const res = await apiRequest(endpoint, {
      accessToken: params.accessToken,
      json: body,
      timeoutMs: 60_000,
    });
    // Chỉ 404 mới đáng thử key khác (key không tồn tại). Mọi status khác — kể cả 403
    // PERMISSION_DENIED — là câu trả lời thật của Google về key này, trả về ngay.
    if (res.status !== 404) {
      if (key !== baseKey) {
        console.log('[videoGen] mode=%s: key "%s" bị 404, dùng được "%s"', mode, baseKey, key);
      }
      return res;
    }
    console.warn('[videoGen] mode=%s: videoModelKey "%s" trả 404', mode, key);
    lastRes = res;
  }
  // Mọi biến thể đều 404 → nhiều khả năng KHÔNG phải do tên key (nếu key sai thì các biến thể có
  // dạng hậu tố khác nhau khó cùng sai), mà do Flow project đã hết hạn. Nói rõ để người đọc log
  // không đi sửa nhầm bảng key — caller sẽ tự tạo project mới và chạy lại.
  console.warn(
    '[videoGen] mode=%s: TẤT CẢ %d biến thể key đều 404 (%s) — thường là Flow project đã hết hạn, không phải key sai. Caller sẽ tạo project mới và thử lại.',
    mode,
    candidates.length,
    candidates.join(', ')
  );
  return lastRes!;
}

export type VideoPollState = 'pending' | 'running' | 'done' | 'error';

export interface VideoPollResult {
  status: VideoPollState;
  phase?: string;
  error?: string;
}

const STATUS_MAP: Record<string, VideoPollState> = {
  MEDIA_GENERATION_STATUS_PENDING: 'pending',
  MEDIA_GENERATION_STATUS_ACTIVE: 'running',
  MEDIA_GENERATION_STATUS_SUCCESSFUL: 'done',
  MEDIA_GENERATION_STATUS_FAILED: 'error',
};

/** Poll trạng thái 1 mediaId đang generate video (không tải file). */
export async function pollVideoStatus(
  accessToken: string,
  projectId: string,
  mediaId: string
): Promise<VideoPollResult> {
  const res = await apiRequest('/v1/video:batchCheckAsyncVideoGenerationStatus', {
    accessToken,
    json: { media: [{ name: mediaId, projectId }] },
    timeoutMs: 30_000,
  });
  const data = await readJson<{
    media?: Array<{ mediaMetadata?: { mediaStatus?: { mediaGenerationStatus?: string; failureReason?: string } } }>;
  }>(res);

  const status = data.media?.[0]?.mediaMetadata?.mediaStatus;
  const raw = status?.mediaGenerationStatus;
  if (!raw) {
    throw new FlowApiError('batchCheckAsyncVideoGenerationStatus không trả về trạng thái');
  }
  const mapped = STATUS_MAP[raw] ?? 'pending';
  if (mapped === 'error') {
    console.error(`[flow] mediaId=${mediaId} FAILED, raw response:`, JSON.stringify(data));
  }
  return {
    status: mapped,
    phase: raw,
    error: mapped === 'error' ? status.failureReason || raw : undefined,
  };
}

/** Chỉ dùng cho scripts/check-model-key.ts — không import ở code chạy thật. */
export const __testables = { modelKeyCandidates };
