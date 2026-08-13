import { callMcpTool } from './orinoFlowClient';
import { chatCompletion } from '../ai/chatClient';
import type { ChatEventHandler } from '../ai/chatClient';
import { STORYBOARD_IMAGE_TIMEOUT_MS } from '../constants';
import type { VeoModel } from '../types';

export interface FlowStatusResult {
  flow_connected: boolean;
  gemini_connected: boolean;
  projects: unknown[];
  projects_error?: string;
}

export async function getFlowStatus(): Promise<FlowStatusResult> {
  return callMcpTool<FlowStatusResult>('flow_status', {}, { timeoutMs: 8000 });
}

export interface GenerateVideoResult {
  job_id: string;
}

/**
 * Chọn duration hợp lệ gần nhất theo giới hạn thật của Google Flow:
 * - Model "abra" (Omni Flash): hỗ trợ 4/6/8/10 giây.
 * - Các model Veo khác (quality/fast/lite/lite_low_priority): chỉ hỗ trợ 4/6/8 giây.
 * - Khi có gửi ảnh tham chiếu (ref_paths không rỗng) và model KHÔNG phải abra:
 *   Google chỉ chấp nhận đúng 8 giây, các giá trị khác bị từ chối.
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
  return allowedDurations.reduce((closest, d) =>
    Math.abs(d - requestedDuration) < Math.abs(closest - requestedDuration) ? d : closest
  );
}

/**
 * Đảm bảo prompt gửi cho Veo luôn có chỉ dẫn đọc thoại bằng tiếng Việt (Veo tự
 * sinh giọng nói dựa theo mô tả trong prompt, không có chỉ dẫn ngôn ngữ thì có
 * thể tự chọn tiếng Anh). Áp dụng cho MỌI scene tại thời điểm gọi Veo — không
 * sửa dữ liệu veoPrompt đã lưu trong project.json — nên hoạt động cả với scene
 * viết tay/từ project cũ, không chỉ scene do AI sinh sau này.
 */
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

/**
 * Chặn Veo tự sinh phụ đề/on-screen text đè lên video (kỹ thuật cộng đồng đã
 * kiểm chứng — xem VEOPROMT.md mục "Subtitle Prevention Techniques"). Áp dụng
 * cho mọi scene tại thời điểm gọi Veo, kể cả prompt viết tay chưa có cụm này.
 */
function ensureNoSubtitlesInstruction(veoPrompt: string): string {
  const lower = veoPrompt.toLowerCase();
  if (lower.includes('no subtitles')) {
    return veoPrompt;
  }
  return `${veoPrompt} No subtitles, no captions, no on-screen text.`;
}

/**
 * MCP tool flow_generate_video không có tham số negative_prompt riêng, nên
 * negativePrompt của scene (VD: "text overlay, watermarks, blurry...") chỉ có
 * tác dụng nếu được nhúng thẳng vào nội dung prompt dưới dạng chỉ dẫn "Avoid".
 */
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

export async function generateSceneVideo(
  input: VideoGenInput,
  opts: {
    aspect: '16:9' | '9:16';
    model: VeoModel;
    flowProjectId?: string | null;
    refPaths?: string[];
    startPath?: string;
    endPath?: string;
  }
): Promise<GenerateVideoResult> {
  const refPaths = opts.refPaths && opts.refPaths.length > 0 ? opts.refPaths : undefined;
  const duration = resolveAllowedDuration(input.duration, opts.model, !!refPaths);
  let prompt = ensureVietnameseVoiceInstruction(input.veoPrompt, input.voiceoverVi);
  prompt = ensureNoSubtitlesInstruction(prompt);
  prompt = appendNegativePrompt(prompt, input.negativePrompt || '');

  return callMcpTool<GenerateVideoResult>(
    'flow_generate_video',
    {
      prompt,
      aspect: opts.aspect,
      duration,
      model: opts.model,
      project_id: opts.flowProjectId || undefined,
      ref_paths: refPaths,
      start_path: opts.startPath,
      end_path: opts.endPath,
    },
    { timeoutMs: 15_000 }
  );
}

export type FlowJobState = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface FlowJobStatusResult {
  // Xác minh thật qua MCP: field tên là "status", không phải "state".
  status: FlowJobState;
  phase?: string;
  progress?: number;
  video_path?: string;
  output_path?: string;
  image_paths?: string[];
  error?: string;
}

export async function pollJobStatus(jobId: string): Promise<FlowJobStatusResult> {
  return callMcpTool<FlowJobStatusResult>('flow_job_status', { job_id: jobId }, { timeoutMs: 8000 });
}

export interface CreateFlowProjectResult {
  project_id: string;
  title: string;
}

export async function createFlowProject(title: string): Promise<CreateFlowProjectResult> {
  return callMcpTool<CreateFlowProjectResult>('flow_create_project', { title }, { timeoutMs: 15_000 });
}

// Model ảnh hợp lệ của Orino Flow (flow_generate_image) — xác minh thật qua MCP.
const KNOWN_FLOW_IMAGE_MODELS = ['flow-image', 'HARBOR_SEAL', 'GEM_PIX_2', 'NARWHAL'];

/**
 * Chuẩn hoá model ảnh: nếu là model cũ của 9Router (VD "codex", còn sót lại trong
 * project.json từ trước khi đổi sang Orino Flow) hoặc rỗng/không nhận diện được,
 * trả về undefined để flow_generate_image tự dùng model mặc định thay vì lỗi.
 */
function resolveFlowImageModel(model: string): string | undefined {
  return KNOWN_FLOW_IMAGE_MODELS.includes(model) ? model : undefined;
}

export interface GenerateStoryboardImageResult {
  job_id: string;
  dir: string;
  paths: string[];
}

/**
 * Sinh ảnh storyboard bằng flow_generate_image (MCP Orino Flow) — chạy trên phiên
 * tài khoản Google Flow đã đăng nhập trong app Orino Flow (không cần API key,
 * không tính phí theo token). Tool này block tới khi ảnh xong (tối đa ~10 phút),
 * trả về đường dẫn file đã lưu sẵn trên đĩa (paths), không cần tự parse base64.
 */
export async function generateStoryboardImage(params: {
  prompt: string;
  aspect: '9:16' | '16:9';
  model?: string;
  refPaths?: string[];
  timeoutMs?: number;
}): Promise<GenerateStoryboardImageResult> {
  return callMcpTool<GenerateStoryboardImageResult>(
    'flow_generate_image',
    {
      prompt: params.prompt,
      aspect: params.aspect,
      model: params.model ? resolveFlowImageModel(params.model) : undefined,
      ref_paths: params.refPaths && params.refPaths.length > 0 ? params.refPaths : undefined,
      count: 1,
    },
    { timeoutMs: params.timeoutMs ?? STORYBOARD_IMAGE_TIMEOUT_MS }
  );
}

/**
 * Sinh text bằng AI chat API (OpenAI-compatible, KHÔNG hỗ trợ đa phương thức —
 * chỉ nhận text, không thể "nhìn" ảnh sản phẩm đã upload). Dùng để sinh nháp
 * kịch bản từ mô tả text sản phẩm + template, không phải phân tích ảnh thật.
 *
 * Trước đây dùng gemini_generate qua MCP Orino Flow, nhưng tool đó phụ thuộc
 * phiên đăng nhập Gemini trong app Orino Flow — đổi sang gọi thẳng 1 AI chat
 * API riêng (cấu hình qua AI_CHAT_API_URL/KEY/MODEL) để không phụ thuộc trạng
 * thái đăng nhập đó.
 */
export async function generateScriptText(
  system: string,
  user: string,
  onEvent?: ChatEventHandler
): Promise<string> {
  return chatCompletion(system, user, { onEvent });
}
