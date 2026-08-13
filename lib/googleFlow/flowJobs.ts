/**
 * Lớp nghiệp vụ generate — gọi trực tiếp Google Flow API. Giữ nguyên signature
 * nghiệp vụ để các route/poll không phải đổi cách gọi.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { chatCompletion } from '../ai/chatClient';
import type { ChatEventHandler } from '../ai/chatClient';
import type { VeoModel } from '../types';
import { resolveActiveAccount, resolveAccessToken } from './recaptcha';
import { createProject } from './projects';
import { generateImage } from './imageGen';
import { generateVideo, pollVideoStatus } from './videoGen';
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

export interface GenerateVideoResult {
  job_id: string;
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
  return allowedDurations.reduce((closest, d) =>
    Math.abs(d - requestedDuration) < Math.abs(closest - requestedDuration) ? d : closest
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
  const account = await resolveActiveAccount();
  const accessToken = await resolveAccessToken(account);

  const refPaths = opts.refPaths && opts.refPaths.length > 0 ? opts.refPaths : undefined;
  const duration = resolveAllowedDuration(input.duration, opts.model, !!refPaths);
  let prompt = ensureVietnameseVoiceInstruction(input.veoPrompt, input.voiceoverVi);
  prompt = ensureNoSubtitlesInstruction(prompt);
  prompt = appendNegativePrompt(prompt, input.negativePrompt || '');

  if (!opts.flowProjectId) {
    throw new FlowApiError('Chưa có flowProjectId — cần tạo Flow project trước khi gen video');
  }

  return generateVideo({
    account,
    accessToken,
    prompt,
    aspect: opts.aspect,
    model: opts.model,
    projectId: opts.flowProjectId,
    duration,
    refPaths,
    startPath: opts.startPath,
    endPath: opts.endPath,
  });
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
  const accessToken = await resolveAccessToken(account);

  const result = await pollVideoStatus(accessToken, projectId, jobId);

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
}

/** Sinh ảnh storyboard (đồng bộ) qua batchGenerateImages. */
export async function generateStoryboardImage(params: {
  prompt: string;
  aspect: '9:16' | '16:9';
  model?: string;
  refPaths?: string[];
  projectId?: string | null;
  timeoutMs?: number;
}): Promise<GenerateStoryboardImageResult> {
  const account = await resolveActiveAccount();
  const accessToken = await resolveAccessToken(account);

  if (!params.projectId) {
    throw new FlowApiError('Chưa có flowProjectId — cần tạo Flow project trước khi gen ảnh');
  }

  const result = await generateImage({
    account,
    accessToken,
    prompt: params.prompt,
    aspect: params.aspect,
    model: params.model,
    projectId: params.projectId,
    refPaths: params.refPaths && params.refPaths.length > 0 ? params.refPaths : undefined,
    count: 1,
  });

  return { job_id: '', dir: result.dir, paths: result.paths };
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
