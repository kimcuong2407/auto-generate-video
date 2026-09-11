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
import { resolveActiveAccount, flowCredsOf, acquireRecaptchaToken } from './recaptcha';
import { RECAPTCHA_ACTION_VIDEO } from './client';
import { createProject } from './projects';
import { generateImage } from './imageGen';
import { generateOmniImage } from '../omniroute/imageGen';
import { generateChatgptImage } from '../chatgptImage/imageGen';
import { CHATGPT_EXTENSION_MODEL, CHATGPT_LOCAL_MODEL } from '../imageModels';
import { generateVideo, pollVideoStatus } from './videoGen';
import { rpcAvailableModels } from './flowRpc';
import type { RefImageInput, GenerateVideoResult } from './videoGen';
import { downloadMedia } from './download';
import { FlowApiError } from './errors';
import type { FlowAccount, FlowBatchCreds } from './authStore';
import {
  getFlowStatusMcp,
  createFlowProjectMcp,
  generateSceneVideoMcp,
  pollJobStatusMcp,
  generateStoryboardImageMcp,
} from './mcpJobs';

/** Cờ /settings/flow: đi qua Orino MCP thay vì batchexecute. Đọc mỗi lần gọi để bật/tắt có hiệu lực ngay, không cần restart. */
function useMcp(): boolean {
  return readAppSettings().useMcp === true;
}

export interface FlowStatusResult {
  flow_connected: boolean;
  gemini_connected: boolean;
  projects: unknown[];
  projects_error?: string;
}

export async function getFlowStatus(): Promise<FlowStatusResult> {
  if (useMcp()) return getFlowStatusMcp();
  try {
    const account = await resolveActiveAccount();
    // Điều kiện gen được = cookie + `at` (XSRF). accessToken cũ luôn null kể từ khi Google gỡ
    // kiến trúc Bearer (2026-09), dựa vào nó là luôn báo "đã kết nối" sai.
    return {
      flow_connected: !!account.cookie && !!account.at,
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

  // Rẽ MCP SAU khi đã dựng prompt/duration (logic nghiệp vụ dùng chung cho cả hai luồng) nhưng
  // TRƯỚC khi đụng cookie/reCAPTCHA — luồng MCP dùng phiên đăng nhập của app Orino.
  if (useMcp()) {
    return generateSceneVideoMcp(input, { ...opts, model, refImages }, prompt, duration);
  }

  const account = await resolveActiveAccount();
  const creds = flowCredsOf(account);

  // Chặn TRƯỚC khi gửi: model tier người dùng chọn có nằm trong danh sách Google cấp cho tài
  // khoản này không. Không kiểm thì lệnh gen bị từ chối bằng response RỖNG — không mã lỗi,
  // không phân biệt được với token reCAPTCHA hỏng, và mỗi lần thử lại tiêu thêm 1 token.
  await assertModelAvailable(creds, opts.flowProjectId, model);

  // Mint 1 token dùng chung cho upload ảnh + lệnh gen của lần này (trang thật cũng vậy).
  // Mint lại ở lần thử thứ hai vì token one-time-use: lần đầu đã tiêu nó rồi.
  const run = async (projectId: string, freshUploads: boolean) =>
      generateVideo({
        creds,
        recaptchaToken: await acquireRecaptchaToken(account.id, RECAPTCHA_ACTION_VIDEO),
        prompt,
        aspect: opts.aspect,
        model,
        projectId,
        duration,
        refImages: freshUploads ? refImages?.map((r) => dropCachedMediaId(r)!) : refImages,
        startImage: freshUploads ? dropCachedMediaId(opts.startImage) : opts.startImage,
        endImage: freshUploads ? dropCachedMediaId(opts.endImage) : opts.endImage,
        seed: opts.seed,
      });

  try {
    const result = await run(opts.flowProjectId, false);
    return { ...result, flowProjectId: opts.flowProjectId, finalPrompt: prompt };
  } catch (err) {
    if (!isEntityNotFound(err) || !opts.flowProjectTitle) throw err;
    const { id: newProjectId } = await createProject(account, opts.flowProjectTitle);
    const result = await run(newProjectId, true);
    return { ...result, flowProjectId: newProjectId, finalPrompt: prompt };
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
 *
 * `jobAgeMs`: job đã chạy bao lâu — chỉ dùng để khoan dung với lỗi tạm của Google trong ít
 * phút đầu (xem pollVideoStatus). Bỏ trống thì không khoan dung, y như trước.
 */
export async function pollJobStatus(
  jobId: string,
  projectId: string,
  jobAgeMs?: number
): Promise<FlowJobStatusResult> {
  if (useMcp()) return pollJobStatusMcp(jobId);
  const account = await resolveActiveAccount();
  const result = await pollVideoStatus(flowCredsOf(account), projectId, jobId, jobAgeMs);

  if (result.status === 'done') {
    const dest = path.join(TMP_VIDEO_DIR, `${jobId}-${crypto.randomBytes(4).toString('hex')}.mp4`);
    const videoPath = await downloadMedia(flowCredsOf(account), projectId, jobId, dest);
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

/**
 * Cache danh sách model khả dụng theo accountId.
 *
 * Quyền model đổi rất chậm (Google cấp/thu theo tài khoản), mà gen video thì gọi liên tục —
 * hỏi lại mỗi lần là thêm một round-trip vào đúng đường nóng. TTL 10 phút đủ để Mr.D thấy
 * thay đổi trong một phiên làm việc mà không phải restart.
 */
const modelCache = new Map<string, { at: number; models: string[] }>();
const MODEL_CACHE_TTL_MS = 10 * 60_000;

/**
 * Ném lỗi NÓI RÕ nếu tier model không được cấp cho tài khoản này.
 *
 * yBhWQ trả danh sách TIER (veo_3_1_lite, abra…), không phải videoModelKey đầy đủ mà lệnh gen
 * gửi đi (veo_3_1_i2v_lite_8s) — nên chỉ kiểm được tier, đúng tầng mà người dùng chọn ở UI.
 *
 * KHÔNG chặn khi không đọc được danh sách (mạng lỗi, Google đổi rpc): thà để lệnh gen chạy và
 * tự báo lỗi, còn hơn chặn oan một lần gen hợp lệ vì một RPC phụ trợ hỏng.
 */
async function assertModelAvailable(
  creds: FlowBatchCreds,
  projectId: string,
  model: VeoModel
): Promise<void> {
  const key = creds.cookie.slice(-32);
  const cached = modelCache.get(key);
  let models = cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS ? cached.models : null;

  if (!models) {
    try {
      models = await rpcAvailableModels(creds, projectId);
      modelCache.set(key, { at: Date.now(), models });
    } catch (err) {
      console.warn('[flow gen] không đọc được danh sách model khả dụng, bỏ qua bước kiểm:', err);
      return;
    }
  }

  // Danh sách rỗng = Google đổi cấu trúc response chứ không phải tài khoản không có model nào
  // (không có model nào thì trang Flow cũng không dùng được). Không chặn.
  if (models.length === 0) return;
  if (models.includes(model)) return;

  throw new FlowApiError(
    `Model "${model}" không được cấp cho tài khoản Veo đang dùng. ` +
      `Tài khoản này hiện có: ${models.join(', ')}. ` +
      `Đổi model ở Cài đặt → AI (hoặc trong project) sang một trong các model trên rồi gen lại.`
  );
}

export interface CreateFlowProjectResult {
  id: string;
  title: string;
}

export async function createFlowProject(title: string): Promise<CreateFlowProjectResult> {
  if (useMcp()) return createFlowProjectMcp(title);
  const account = await resolveActiveAccount();
  // Truyền cả account (không chỉ cookie): batchexecute cần thêm `at`/`fsid`/`bl`, rút ra
  // trong projects.ts qua flowCredsOf.
  return createProject(account, title);
}

/**
 * Lý do gần nhất khiến resolveFlowProjectIdSafe trả null.
 *
 * Vì sao cần: caller chỉ nhận `null` rồi tự đoán nguyên nhân, và đoán SAI suốt — thông điệp
 * "chưa cấu hình tài khoản, hoặc cookie/token đã hết hạn" từng bắt Mr.D gửi lại session
 * nhiều lần trong khi lỗi thật là endpoint labs.google/fx/api/trpc đã bị Google gỡ
 * (xem lib/googleFlow/projects.ts). Giữ lỗi gốc ở đây để caller ghép vào thông báo, thay vì
 * bắt người dùng mở log PM2 trên VPS mới biết.
 *
 * Module-level (không phải per-call) là đủ: caller đọc ngay sau khi nhận null, và hai lượt
 * tạo project chạy song song mà cùng hỏng thì lý do gần như luôn giống nhau.
 */
let lastFlowProjectError: string | null = null;

/** Lý do thất bại gần nhất, hoặc null nếu chưa lần nào hỏng. */
export function lastCreateFlowProjectError(): string | null {
  return lastFlowProjectError;
}

/**
 * Tạo Flow project an toàn — trả null khi chưa cấu hình account thay vì chặn luồng.
 *
 * Log lý do thật (account chưa cấu hình, cookie/`at` hết hạn, Flow API lỗi) VÀ giữ lại ở
 * lastFlowProjectError để caller báo đúng nguyên nhân; trước đây `catch` trống nuốt mất lỗi
 * gốc nên không điều tra được.
 */
export async function resolveFlowProjectIdSafe(title: string): Promise<string | null> {
  try {
    const { id } = await createFlowProject(title);
    if (!id) {
      lastFlowProjectError = 'Flow trả về rỗng — không có projectId';
      console.error(`[flow] createFlowProject("${title}") trả về rỗng — không có id`);
      return null;
    }
    lastFlowProjectError = null;
    return id;
  } catch (err) {
    const code = err instanceof FlowApiError ? ` code=${err.code ?? '-'}` : '';
    lastFlowProjectError = `${String(err)}${code}`;
    console.error(`[flow] Tạo Flow project "${title}" thất bại${code}: ${String(err)}`);
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
  // Model global ở /settings/ai đè model lưu trong project/job — cùng cơ chế veoModel. Ép
  // NGAY ĐẦU hàm, trước mọi nhánh rẽ provider, vì đây là cửa duy nhất mọi luồng gen ảnh đi
  // qua; ép sau nhánh rẽ thì chọn provider ở UI vẫn thắng và cấu hình global thành vô nghĩa.
  const model = readAppSettings().imageModel || params.model;

  // Model OmniRoute (vd "chatgpt-web/gpt-5.5", chứa "/") → rẽ sang provider khác, không đụng
  // Google Flow (không cần flowProjectId/account thật). Model Google Flow (flow-image,
  // HARBOR_SEAL, GEM_PIX_2, NARWHAL) không chứa "/" nên rơi xuống nhánh cũ như trước.
  // Model ChatGPT web (browser automation, xem lib/chatgptImage/) — kiểm TRƯỚC nhánh "/" vì
  // cả 'chatgpt-local' lẫn 'chatgpt-extension' đều không chứa "/" và cũng không phải model
  // Google Flow. Hai model này chung hệt nhau trừ NƠI chạy browser: 'chatgpt-local' dùng
  // Chromium Playwright trên server, 'chatgpt-extension' dùng Chrome của người dùng qua
  // extension. Khác biệt gói gọn trong cờ `source` nên dùng chung một nhánh.
  if (model === CHATGPT_LOCAL_MODEL || model === CHATGPT_EXTENSION_MODEL) {
    const paths = await generateChatgptImage({
      prompt: params.prompt,
      aspect: params.aspect,
      refImagePaths: (params.refImages || []).map((r) => r.path),
      timeoutMs: params.timeoutMs,
      source: model === CHATGPT_EXTENSION_MODEL ? 'extension' : 'playwright',
    });
    return {
      job_id: '',
      dir: path.dirname(paths[0]),
      paths,
      uploadedMediaIds: {},
      flowProjectId: params.projectId || '',
    };
  }

  if (model?.includes('/')) {
    const paths = await generateOmniImage({
      prompt: params.prompt,
      model,
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

  if (!params.projectId) {
    throw new FlowApiError('Chưa có flowProjectId — cần tạo Flow project trước khi gen ảnh');
  }

  // Rẽ MCP sau các nhánh provider ngoài Google Flow (ChatGPT/OmniRoute ở trên) — chúng không
  // liên quan Flow nên cờ này không đụng tới.
  if (useMcp()) {
    return generateStoryboardImageMcp({ ...params, model });
  }

  const account = await resolveActiveAccount();

  const refImages = params.refImages && params.refImages.length > 0 ? params.refImages : undefined;
  const run = (projectId: string, freshUploads: boolean) =>
      generateImage({
        account,
        accessToken: '',
        prompt: params.prompt,
        aspect: params.aspect,
        model,
        projectId,
        refImages: freshUploads ? refImages?.map((r) => dropCachedMediaId(r)!) : refImages,
        count: 1,
      });

  let result;
  let flowProjectId: string;
  try {
    result = await run(params.projectId, false);
    flowProjectId = params.projectId;
  } catch (err) {
    if (!isEntityNotFound(err) || !params.projectTitle) throw err;
    const { id: newProjectId } = await createProject(account, params.projectTitle);
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
