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

  const { base, suffix } = coreParts(model);
  const modeInfix = mode === 'i2v_se' ? 'i2v_s' : mode;
  return `veo_3_1_${modeInfix}_${base}${durationSuffix(duration)}${suffix}${useFl ? '_fl' : ''}`;
}

export interface GenerateVideoParams {
  account: FlowAccount;
  accessToken: string;
  prompt: string;
  aspect: VideoAspect;
  model: VeoModel;
  projectId: string;
  duration: number;
  refPaths?: string[];
  startPath?: string;
  endPath?: string;
}

export interface GenerateVideoResult {
  job_id: string;
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
  const seed = Math.floor(Math.random() * 1_000_000);

  const hasRef = params.refPaths && params.refPaths.length > 0;
  const hasStart = !!params.startPath;
  const hasEnd = !!params.endPath;

  let endpoint: string;
  let mode: VideoMode;
  let request: Record<string, unknown>;
  const common = { aspectRatio, textInput, seed, metadata: {} };

  if (hasRef) {
    endpoint = '/v1/video:batchAsyncGenerateVideoReferenceImages';
    mode = 'r2v';
    const referenceImages = [];
    for (const refPath of params.refPaths!) {
      const mediaId = await uploadImageFile(params.accessToken, params.projectId, refPath);
      referenceImages.push({ mediaId, imageUsageType: 'IMAGE_USAGE_TYPE_ASSET' });
    }
    request = { ...common, referenceImages };
  } else if (hasStart && hasEnd) {
    endpoint = '/v1/video:batchAsyncGenerateVideoStartAndEndImage';
    mode = 'i2v_se';
    const startMediaId = await uploadImageFile(params.accessToken, params.projectId, params.startPath!);
    const endMediaId = await uploadImageFile(params.accessToken, params.projectId, params.endPath!);
    request = {
      ...common,
      startImage: { mediaId: startMediaId, cropCoordinates: { top: 0, left: 0, bottom: 1, right: 1 } },
      endImage: { mediaId: endMediaId, cropCoordinates: { top: 0, left: 0, bottom: 1, right: 1 } },
    };
  } else if (hasStart) {
    endpoint = '/v1/video:batchAsyncGenerateVideoStartImage';
    mode = 'i2v_s';
    const startMediaId = await uploadImageFile(params.accessToken, params.projectId, params.startPath!);
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

  const body = await buildVideoBody(params, {
    requests: [{ ...request, videoModelKey }],
    useV2ModelConfig: true,
  });

  const res = await apiRequest(endpoint, {
    accessToken: params.accessToken,
    json: body,
    timeoutMs: 60_000,
  });
  const data = await readJson<VideoWorkflowResponse>(res);
  return { job_id: extractMediaId(data) };
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
  return {
    status: mapped,
    phase: raw,
    error: mapped === 'error' ? status.failureReason || raw : undefined,
  };
}
