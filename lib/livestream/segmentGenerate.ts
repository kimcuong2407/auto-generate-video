import { readJob, updateJob, ensureJobFlowId } from './jobStore';
import { resolveWithinJob } from './paths';
import { generateSceneVideo } from '../googleFlow/flowJobs';
import { FlowApiError } from '../googleFlow/errors';
import type { LivestreamJob, LivestreamProduct, LivestreamSegment } from './types';

export interface TriggerResult {
  segmentId: string;
  ok: boolean;
  jobId?: string;
  error?: string;
}

interface FoundSegment {
  product: LivestreamProduct;
  segment: LivestreamSegment;
}

function findSegment(job: LivestreamJob, segmentId: string): FoundSegment | null {
  for (const product of job.products) {
    const segment = product.segments.find((s) => s.id === segmentId);
    if (segment) return { product, segment };
  }
  return null;
}

/**
 * Tìm đoạn liền trước theo `order` tuyệt đối, dùng làm nguồn khung hình chain
 * (image-to-video). 'off' không chain, 'per_product' chỉ chain trong cùng sản phẩm,
 * 'continuous' chain xuyên suốt toàn bộ job kể cả giữa các sản phẩm khác nhau.
 */
export function findPreviousSegment(
  job: LivestreamJob,
  product: LivestreamProduct,
  segment: LivestreamSegment
): LivestreamSegment | null {
  if (job.chaining === 'off') return null;
  if (job.chaining === 'per_product') {
    return product.segments.find((s) => s.order === segment.order - 1) || null;
  }
  for (const p of job.products) {
    const found = p.segments.find((s) => s.order === segment.order - 1);
    if (found) return found;
  }
  return null;
}

/**
 * Tìm đoạn kế tiếp theo `order` tuyệt đối — dùng để auto-cascade trigger sau khi 1 đoạn
 * vừa done (xem app/api/livestream/[id]/status/route.ts). Đối xứng với findPreviousSegment.
 */
export function findNextSegment(
  job: LivestreamJob,
  product: LivestreamProduct,
  segment: LivestreamSegment
): LivestreamSegment | null {
  if (job.chaining === 'per_product') {
    return product.segments.find((s) => s.order === segment.order + 1) || null;
  }
  for (const p of job.products) {
    const found = p.segments.find((s) => s.order === segment.order + 1);
    if (found) return found;
  }
  return null;
}

/** Trigger gen video cho 1 đoạn: validate trạng thái, gọi flow_generate_video, cập nhật job.json. */
export async function triggerSegmentGeneration(
  jobId: string,
  segmentId: string,
  opts: { requireFailed?: boolean } = {}
): Promise<TriggerResult> {
  const job = await readJob(jobId);
  const found = findSegment(job, segmentId);
  if (!found) {
    return { segmentId, ok: false, error: 'Đoạn không tồn tại' };
  }
  const { segment } = found;
  if (segment.status === 'generating') {
    return { segmentId, ok: false, error: 'Đoạn đang generating' };
  }
  if (opts.requireFailed && segment.status !== 'failed') {
    return { segmentId, ok: false, error: 'Đoạn chưa ở trạng thái failed' };
  }
  if (!segment.veoPrompt.trim()) {
    return { segmentId, ok: false, error: 'Đoạn chưa có Veo prompt — cần sinh script trước' };
  }

  try {
    let startPath: string | undefined;
    const prevSegment = findPreviousSegment(job, found.product, segment);
    if (prevSegment?.status === 'done' && prevSegment.lastFramePath) {
      startPath = resolveWithinJob(jobId, prevSegment.lastFramePath);
    }

    const flowProjectId = await ensureJobFlowId(jobId);

    const { job_id } = await generateSceneVideo(
      {
        veoPrompt: segment.veoPrompt,
        voiceoverVi: segment.voiceoverVi,
        duration: segment.duration,
      },
      {
        aspect: job.aspectRatio,
        model: job.veoModel,
        flowProjectId,
        startPath,
      }
    );

    await updateJob(jobId, (j) => {
      const f = findSegment(j, segmentId);
      if (!f) return;
      f.segment.status = 'generating';
      f.segment.jobId = job_id;
      f.segment.error = null;
      f.segment.attempts += 1;
      f.segment.lastUpdatedAt = new Date().toISOString();
    });

    return { segmentId, ok: true, jobId: job_id };
  } catch (err) {
    const message = err instanceof FlowApiError ? err.message : (err as Error).message;
    await updateJob(jobId, (j) => {
      const f = findSegment(j, segmentId);
      if (!f) return;
      f.segment.status = 'failed';
      f.segment.error = message;
      f.segment.lastUpdatedAt = new Date().toISOString();
    });
    return { segmentId, ok: false, error: message };
  }
}

const STOP_ERROR_MESSAGE = 'Đã dừng theo yêu cầu người dùng';

/**
 * Dừng theo dõi 1 đoạn đang generating — KHÔNG hủy được job thật bên Google Flow (bộ MCP
 * tool Orino Flow không có tool hủy job), chỉ đánh dấu về "failed" để retry ngay.
 */
export async function stopSegmentGeneration(jobId: string, segmentId: string): Promise<TriggerResult> {
  const job = await readJob(jobId);
  const found = findSegment(job, segmentId);
  if (!found) {
    return { segmentId, ok: false, error: 'Đoạn không tồn tại' };
  }
  if (found.segment.status !== 'generating') {
    return { segmentId, ok: false, error: 'Đoạn không đang generating' };
  }

  await updateJob(jobId, (j) => {
    const f = findSegment(j, segmentId);
    if (!f || f.segment.status !== 'generating') return;
    f.segment.status = 'failed';
    f.segment.error = STOP_ERROR_MESSAGE;
    f.segment.jobId = null;
    f.segment.lastUpdatedAt = new Date().toISOString();
  });

  return { segmentId, ok: true };
}

/** Dừng theo dõi mọi đoạn đang generating của job (xem stopSegmentGeneration). */
export async function stopAllSegmentGeneration(jobId: string): Promise<string[]> {
  const stopped: string[] = [];
  await updateJob(jobId, (j) => {
    for (const product of j.products) {
      for (const segment of product.segments) {
        if (segment.status !== 'generating') continue;
        segment.status = 'failed';
        segment.error = STOP_ERROR_MESSAGE;
        segment.jobId = null;
        segment.lastUpdatedAt = new Date().toISOString();
        stopped.push(segment.id);
      }
    }
  });
  return stopped;
}
