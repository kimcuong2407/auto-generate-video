/**
 * Luồng gen qua Orino Flow MCP — bản song song của flowJobs.ts.
 *
 * Cùng signature với các hàm tương ứng trong flowJobs.ts để flowJobs chỉ việc rẽ nhánh, KHÔNG
 * file nào khác trong pipeline phải sửa. Bật/tắt bằng cờ `useMcp` ở /settings/flow.
 *
 * Khác biệt cốt lõi so với luồng cũ: Orino giữ phiên đăng nhập Google và tự dựng videoModelKey,
 * nên ở đây không có cookie/`at`/reCAPTCHA/resolveVideoModelKey. Ta chỉ gửi tier model.
 *
 * Những thứ MCP KHÔNG hỗ trợ (để trống có chủ đích, Mr.D quyết sau — không tự lấp bằng
 * batchexecute, vì trộn hai luồng là mất đúng cái tính tách bạch của cờ này):
 *   - `seed`: flow_generate_video không nhận (luồng batchexecute cũ cũng không gửi).
 *   - `uploadedMediaIds`: MCP nhận path ảnh trực tiếp, không trả mediaId → luôn trả {}.
 *     Hệ quả: mỗi lần gen upload lại ảnh, mất cache. Chấp nhận được vì ảnh nằm cùng máy.
 *   - kiểm model khả dụng trước khi gen (RPC yBhWQ): không có tool tương ứng.
 *   - tạo lại project khi 404 entity-not-found: xem ghi chú ở generateSceneVideoMcp.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { mcpCall, mcpCallJson } from './mcpClient';
import { FlowApiError } from './errors';
import type { VeoModel } from '../types';
import type { RefImageInput, GenerateVideoResult } from './videoGen';
import type { FlowStatusResult, FlowJobStatusResult, CreateFlowProjectResult, GenerateStoryboardImageResult } from './flowJobs';

/** Trạng thái kết nối — flow_status của Orino trả đúng shape FlowStatusResult. */
export async function getFlowStatusMcp(): Promise<FlowStatusResult> {
  try {
    return await mcpCallJson<FlowStatusResult>('flow_status', {}, 60_000);
  } catch (err) {
    return {
      flow_connected: false,
      gemini_connected: false,
      projects: [],
      projects_error: (err as Error).message,
    };
  }
}

export async function createFlowProjectMcp(title: string): Promise<CreateFlowProjectResult> {
  const res = await mcpCallJson<{ project_id?: string; id?: string; title?: string }>(
    'flow_create_project',
    { title },
    120_000
  );
  const id = res.project_id || res.id || '';
  if (!id) {
    throw new FlowApiError(`Orino MCP: flow_create_project không trả project_id. Response: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return { id, title: res.title || title };
}

/**
 * Sinh video qua MCP.
 *
 * KHÔNG tự tạo lại project khi 404 như luồng cũ: ở luồng cũ ta đọc được mã lỗi HTTP từ Google
 * nên phân biệt chắc chắn "project đã bị xoá" với lỗi khác; qua MCP chỉ còn chuỗi lỗi dạng chữ,
 * và đoán ý nghĩa từ chuỗi là đúng kiểu suy đoán đã gây họa trước đây. Ném lỗi lên để caller
 * (và Mr.D) thấy nguyên văn.
 */
export async function generateSceneVideoMcp(
  input: { veoPrompt: string; voiceoverVi: string; negativePrompt?: string; duration: number },
  opts: {
    aspect: '16:9' | '9:16';
    model: VeoModel;
    flowProjectId?: string | null;
    refImages?: RefImageInput[];
    startImage?: RefImageInput;
    endImage?: RefImageInput;
  },
  prompt: string,
  duration: number
): Promise<GenerateVideoResult & { flowProjectId: string }> {
  const args: Record<string, unknown> = {
    prompt,
    aspect: opts.aspect,
    model: opts.model,
    duration,
  };
  if (opts.flowProjectId) args.project_id = opts.flowProjectId;
  if (opts.refImages?.length) args.ref_paths = opts.refImages.map((r) => r.path);
  if (opts.startImage) args.start_path = opts.startImage.path;
  // end_path chỉ có nghĩa khi có start_path (schema Orino ghi rõ "needs start_path too").
  if (opts.endImage && opts.startImage) args.end_path = opts.endImage.path;

  const res = await mcpCallJson<{ job_id?: string; project_id?: string }>('flow_generate_video', args, 180_000);
  if (!res.job_id) {
    throw new FlowApiError(`Orino MCP: flow_generate_video không trả job_id. Response: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return {
    job_id: res.job_id,
    uploadedMediaIds: {},
    flowProjectId: res.project_id || opts.flowProjectId || '',
  };
}

const TMP_VIDEO_DIR = path.join(process.cwd(), 'data', 'tmp', 'flow-video');

/**
 * Poll 1 job video. Orino tự tải video về và trả `video_path` trên cùng máy, nên không cần
 * bước downloadMedia như luồng cũ — trả thẳng path đó.
 */
export async function pollJobStatusMcp(jobId: string): Promise<FlowJobStatusResult> {
  const res = await mcpCallJson<{
    status?: string;
    phase?: string;
    progress?: number;
    video_path?: string;
    error?: string;
  }>('flow_job_status', { job_id: jobId }, 120_000);

  const status = (res.status || 'pending') as FlowJobStatusResult['status'];
  if (status === 'done') {
    if (!res.video_path) {
      throw new FlowApiError(`Orino MCP: job ${jobId} báo done nhưng không có video_path`);
    }
    return { status: 'done', phase: res.phase, progress: res.progress, video_path: res.video_path };
  }
  if (status === 'error') {
    return { status: 'error', phase: res.phase, error: res.error || 'Job failed' };
  }
  return { status, phase: res.phase, progress: res.progress };
}

/**
 * Sinh ảnh storyboard qua MCP (đồng bộ — flow_generate_image chặn tới khi xong).
 *
 * Chỉ nhận model Google Flow (flow-image/HARBOR_SEAL/GEM_PIX_2/NARWHAL). Model OmniRoute và
 * ChatGPT vẫn do flowJobs xử lý TRƯỚC khi rẽ vào đây — chúng không liên quan Google Flow.
 */
export async function generateStoryboardImageMcp(params: {
  prompt: string;
  aspect: '9:16' | '16:9';
  model?: string;
  refImages?: RefImageInput[];
  projectId?: string | null;
  timeoutMs?: number;
}): Promise<GenerateStoryboardImageResult & { flowProjectId: string }> {
  const args: Record<string, unknown> = { prompt: params.prompt, aspect: params.aspect, count: 1 };
  if (params.model) args.model = params.model;
  if (params.projectId) args.project_id = params.projectId;
  if (params.refImages?.length) args.ref_paths = params.refImages.map((r) => r.path);

  const res = await mcpCallJson<{ paths?: string[]; project_id?: string; job_id?: string }>(
    'flow_generate_image',
    args,
    params.timeoutMs ?? 10 * 60_000
  );
  const paths = res.paths || [];
  if (paths.length === 0) {
    throw new FlowApiError(`Orino MCP: flow_generate_image không trả path ảnh nào. Response: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return {
    job_id: res.job_id || '',
    dir: path.dirname(paths[0]),
    paths,
    uploadedMediaIds: {},
    flowProjectId: res.project_id || params.projectId || '',
  };
}

/** Sinh text qua Gemini của Orino — chỉ dùng khi cờ MCP bật VÀ caller muốn thay chatCompletion. */
export async function geminiGenerateMcp(system: string, user: string, model?: string): Promise<string> {
  return mcpCall('gemini_generate', { system, user, ...(model ? { model } : {}) }, 300_000);
}

/** Giữ để tương thích chữ ký downloadMedia cũ — MCP đã trả sẵn path nên chỉ copy khi cần. */
export const __mcpTmpVideoDir = TMP_VIDEO_DIR;
export const __testables = { crypto };
