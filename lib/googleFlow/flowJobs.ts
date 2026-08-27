/**
 * Lớp nghiệp vụ generate — gọi trực tiếp Google Flow API. Giữ nguyên signature
 * nghiệp vụ để các route/poll không phải đổi cách gọi.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { chatCompletion } from '../ai/chatClient';
import type { ChatEventHandler } from '../ai/chatClient';
import type { VeoModel } from '../types';
import { readAppSettings } from '../data/appSettingsStore';
import { resolveActiveAccount, withTokenRetry } from './recaptcha';
import { createProject } from './projects';
import { generateImage } from './imageGen';
import { generateOmniImage } from '../omniroute/imageGen';
import { generateVideo, pollVideoStatus } from './videoGen';
import type { RefImageInput, GenerateVideoResult } from './videoGen';
import { downloadMedia } from './download';
import { FlowApiError } from './errors';
import type { FlowAccount } from './authStore';

export interface FlowStatusResult {
  flow_connected: boolean;
  gemini_connected: boolean;
  projects: unknown[];
  projects_error?: string;
}

export async function getFlowStatus(): Promise<FlowStatusResult> {
  try {
    const account = await resolveActiveAccount();
    const hasToken = !!account.accessToken;
    return {
      flow_connected: hasToken || !!account.cookie,
      gemini_connected: false,
      projects: [],
    };
  } catch (err) {
    return {
      flow_connected: false,
      gemini_connected: false,
      projects: [],
      projects_error: (err as Error).message,
    };
  }
}

/**
 * Chọn duration hợp lệ gần nhất theo giới hạn thật của Google Flow:
 * - Model "abra" (Omni Flash): hỗ trợ 4/6/8/10 giây.
 * - Các model Veo khác: chỉ 4/6/8 giây.
 * - Khi gửi ảnh tham chiếu và model KHÔNG phải abra: Google chỉ chấp nhận đúng 8 giây.
 */
function resolveAllowedDuration(
  requestedDuration: number,
  model: VeoModel,
  hasRefImages: boolean
): number {
  if (model !== 'abra' && hasRefImages) {
    return 8;
  }
  const allowedDurations = model === 'abra' ? [4, 6, 8, 10] : [4, 6, 8];
  // Khi hoà (VD 7s cách đều 6 và 8) → chọn số LỚN hơn (`<=`), không phải số đầu tiên.
  // Vì sao: các key duration ngắn không phải lúc nào cũng được cấp quyền — thực nghiệm
  // 2026-08-25 cho thấy `veo_3_1_i2v_s_lite_6s` trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED
  // trong khi 8s (không hậu tố) chạy bình thường. Chọn dài hơn cũng bám sát thời lượng
  // kịch bản hơn là cắt ngắn lời thoại.
  return allowedDurations.reduce((closest, d) =>
    Math.abs(d - requestedDuration) <= Math.abs(closest - requestedDuration) ? d : closest
  );
}

/** Đảm bảo prompt có chỉ dẫn đọc thoại tiếng Việt. */
function ensureVietnameseVoiceInstruction(veoPrompt: string, voiceoverVi: string): string {
  const lower = veoPrompt.toLowerCase();
  if (lower.includes('vietnamese') || lower.includes('tiếng việt')) {
    return veoPrompt;
  }
  const dialogue = voiceoverVi.trim();
  if (!dialogue) {
    return veoPrompt;
  }
  const escapedDialogue = dialogue.replace(/"/g, "'");
  return `${veoPrompt} The person speaks in Vietnamese, saying: "${escapedDialogue}"`;
}

/** Chặn Veo tự sinh phụ đề/on-screen text. */
function ensureNoSubtitlesInstruction(veoPrompt: string): string {
  const lower = veoPrompt.toLowerCase();
  if (lower.includes('no subtitles')) {
    return veoPrompt;
  }
  return `${veoPrompt} No subtitles, no captions, no on-screen text.`;
}

/** Nhúng negative prompt dưới dạng chỉ dẫn "Avoid". */
function appendNegativePrompt(veoPrompt: string, negativePrompt: string): string {
  const avoid = negativePrompt.trim();
  if (!avoid) {
    return veoPrompt;
  }
  return `${veoPrompt} Avoid: ${avoid}.`;
}

export interface VideoGenInput {
  veoPrompt: string;
  voiceoverVi: string;
  negativePrompt?: string;
  duration: number;
}

/**
 * 404 từ Flow API trên các endpoint theo projectId luôn nghĩa là project (entity) đã bị Google
 * xoá/hết hạn — không resource nào khác 404 được ở các endpoint này.
 */
function isEntityNotFound(err: unknown): boolean {
  return err instanceof FlowApiError && err.code === 404;
}

/** Bỏ mediaId cache khi thử lại trên project mới — ảnh đã upload thuộc project cũ không còn hợp lệ. */
function dropCachedMediaId(ref?: RefImageInput): RefImageInput | undefined {
  return ref ? { path: ref.path } : undefined;
}

export async function generateSceneVideo(
  input: VideoGenInput,
  opts: {
    aspect: '16:9' | '9:16';
    model: VeoModel;
    flowProjectId?: string | null;
    /** Tên dùng tạo lại Flow project nếu project hiện tại bị 404 (entity not found). */
    flowProjectTitle?: string;
    refImages?: RefImageInput[];
    startImage?: RefImageInput;
    endImage?: RefImageInput;
    seed?: number;
  }
): Promise<GenerateVideoResult & { flowProjectId: string }> {
  const account = await resolveActiveAccount();

  // Model global ở /settings/flow đè model lưu trong project/job. Ép tại đây — cửa duy nhất
  // mọi luồng gen video (product review + livestream) đi qua — nên không luồng nào lọt.
  const model = readAppSettings().veoModel || opts.model;

  const refImages = opts.refImages && opts.refImages.length > 0 ? opts.refImages : undefined;
  const duration = resolveAllowedDuration(input.duration, model, !!refImages);
  let prompt = ensureVietnameseVoiceInstruction(input.veoPrompt, input.voiceoverVi);
  prompt = ensureNoSubtitlesInstruction(prompt);
  prompt = appendNegativePrompt(prompt, input.negativePrompt || '');

  if (!opts.flowProjectId) {
    throw new FlowApiError('Chưa có flowProjectId — cần tạo Flow project trước khi gen video');
  }

  const run = (projectId: string, freshUploads: boolean) =>
    withTokenRetry(account, (accessToken) =>
      generateVideo({
        account,
        accessToken,
        prompt,
        aspect: opts.aspect,
        model,
        projectId,
        duration,
        refImages: freshUploads ? refImages?.map((r) => dropCachedMediaId(r)!) : refImages,
        startImage: freshUploads ? dropCachedMediaId(opts.startImage) : opts.startImage,
        endImage: freshUploads ? dropCachedMediaId(opts.endImage) : opts.endImage,
        seed: opts.seed,
      })
    );

  try {
    const result = await run(opts.flowProjectId, false);
    return { ...result, flowProjectId: opts.flowProjectId };
  } catch (err) {
    if (!isEntityNotFound(err) || !opts.flowProjectTitle) throw err;
    const { id: newProjectId } = await createProject(account.cookie, opts.flowProjectTitle);
    const result = await run(newProjectId, true);
    return { ...result, flowProjectId: newProjectId };
  }
}

export type FlowJobState = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface FlowJobStatusResult {
  status: FlowJobState;
  phase?: string;
  progress?: number;
  video_path?: string;
  output_path?: string;
  image_paths?: string[];
  error?: string;
}

const TMP_VIDEO_DIR = path.join(process.cwd(), 'data', 'tmp', 'flow-video');

/**
 * Poll trạng thái 1 job (mediaId). Khi done, tải video về thư mục tmp và trả
 * video_path (đường dẫn tuyệt đối) — route status sẽ copy vào outputs của project.
 */
export async function pollJobStatus(jobId: string, projectId: string): Promise<FlowJobStatusResult> {
  const account = await resolveActiveAccount();
  const result = await withTokenRetry(account, (accessToken) =>
    pollVideoStatus(accessToken, projectId, jobId)
  );

  if (result.status === 'done') {
    const dest = path.join(TMP_VIDEO_DIR, `${jobId}-${crypto.randomBytes(4).toString('hex')}.mp4`);
    const videoPath = await downloadMedia(account.cookie, jobId, dest);
    return { status: 'done', phase: result.phase, video_path: videoPath };
  }
  if (result.status === 'error') {
    return { status: 'error', phase: result.phase, error: result.error || 'Job failed' };
  }
  if (result.status === 'running') {
    return { status: 'running', phase: result.phase };
  }
  return { status: 'pending', phase: result.phase };
}

export interface CreateFlowProjectResult {
  id: string;
  title: string;
}

export async function createFlowProject(title: string): Promise<CreateFlowProjectResult> {
  const account = await resolveActiveAccount();
  return createProject(account.cookie, title);
}

/** Tạo Flow project an toàn — trả null khi chưa cấu hình account thay vì chặn luồng. */
export async function resolveFlowProjectIdSafe(title: string): Promise<string | null> {
  try {
    const { id } = await createFlowProject(title);
    return id ?? null;
  } catch {
    return null;
  }
}

export interface GenerateStoryboardImageResult {
  job_id: string;
  dir: string;
  paths: string[];
  uploadedMediaIds: Record<string, string>;
}

/** Sinh ảnh storyboard (đồng bộ) qua batchGenerateImages. */
export async function generateStoryboardImage(params: {
  prompt: string;
  aspect: '9:16' | '16:9';
  model?: string;
  refImages?: RefImageInput[];
  projectId?: string | null;
  /** Tên dùng tạo lại Flow project nếu project hiện tại bị 404 (entity not found). */
  projectTitle?: string;
  timeoutMs?: number;
}): Promise<GenerateStoryboardImageResult & { flowProjectId: string }> {
  // Model OmniRoute (vd "chatgpt-web/gpt-5.5", chứa "/") → rẽ sang provider khác, không đụng
  // Google Flow (không cần flowProjectId/account thật). Model Google Flow (flow-image,
  // HARBOR_SEAL, GEM_PIX_2, NARWHAL) không chứa "/" nên rơi xuống nhánh cũ như trước.
  if (params.model?.includes('/')) {
    const paths = await generateOmniImage({
      prompt: params.prompt,
      model: params.model,
      aspect: params.aspect,
      refImagePaths: (params.refImages || []).map((r) => r.path),
      timeoutMs: params.timeoutMs,
    });
    return {
      job_id: '',
      dir: path.dirname(paths[0]),
      paths,
      uploadedMediaIds: {},
      flowProjectId: params.projectId || '',
    };
  }

  const account = await resolveActiveAccount();

  if (!params.projectId) {
    throw new FlowApiError('Chưa có flowProjectId — cần tạo Flow project trước khi gen ảnh');
  }

  const refImages = params.refImages && params.refImages.length > 0 ? params.refImages : undefined;
  const run = (projectId: string, freshUploads: boolean) =>
    withTokenRetry(account, (accessToken) =>
      generateImage({
        account,
        accessToken,
        prompt: params.prompt,
        aspect: params.aspect,
        model: params.model,
        projectId,
        refImages: freshUploads ? refImages?.map((r) => dropCachedMediaId(r)!) : refImages,
        count: 1,
      })
    );

  let result;
  let flowProjectId: string;
  try {
    result = await run(params.projectId, false);
    flowProjectId = params.projectId;
  } catch (err) {
    if (!isEntityNotFound(err) || !params.projectTitle) throw err;
    const { id: newProjectId } = await createProject(account.cookie, params.projectTitle);
    result = await run(newProjectId, true);
    flowProjectId = newProjectId;
  }

  return { job_id: '', dir: result.dir, paths: result.paths, uploadedMediaIds: result.uploadedMediaIds, flowProjectId };
}

/**
 * Sinh text bằng AI chat API (OpenAI-compatible) — KHÔNG liên quan Google Flow.
 * Giữ nguyên để các file khác import từ flowJobs không phải đổi thêm.
 */
export async function generateScriptText(
  system: string,
  user: string,
  onEvent?: ChatEventHandler
): Promise<string> {
  return chatCompletion(system, user, { onEvent });
}

export type { FlowAccount };

/** Chỉ dùng cho scripts/check-model-key.ts — không import ở code chạy thật. */
export const __testables = { resolveAllowedDuration };
