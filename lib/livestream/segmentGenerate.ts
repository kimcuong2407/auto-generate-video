import fs from 'node:fs/promises';
import path from 'node:path';
import { readJob, updateJob, ensureJobFlowId, ensureJobVideoSeed } from './jobStore';
import { resolveWithinJob } from './paths';
import { ensureLocalImage } from './imageR2';
import { generateSceneVideo } from '../googleFlow/flowJobs';
import { FlowApiError } from '../googleFlow/errors';
import { deleteFromR2 } from '../r2/client';
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
  if (opts.requireFailed && segment.status !== 'failed' && segment.status !== 'done') {
    return { segmentId, ok: false, error: 'Đoạn chưa ở trạng thái failed hoặc done' };
  }
  if (!segment.veoPrompt.trim()) {
    return { segmentId, ok: false, error: 'Đoạn chưa có Veo prompt — cần sinh script trước' };
  }
  // Bắt chọn tay: nếu job có ảnh trong kho chung nhưng chưa chọn ảnh ref → chặn gen (tránh gen
  // nhầm/không nhất quán). Job không có ảnh nào vẫn cho gen t2v như cũ.
  if ((job.spokespersonImagePaths?.length ?? 0) > 0 && (job.selectedRefImagePaths?.length ?? 0) === 0) {
    return { segmentId, ok: false, error: 'Chưa chọn ảnh tham chiếu sản phẩm — hãy chọn ít nhất 1 ảnh ở phần cấu hình ảnh đầu trang' };
  }
  // Bắt tuần tự: khi có chaining, không cho gen đoạn nếu đoạn liền trước (theo chế độ chaining)
  // chưa xong — tránh gen lệch thứ tự (frame cuối làm ref chưa có, hoặc 2 đoạn chạy chồng nhau)
  // khi người dùng bấm tay nút gen/retry từng đoạn thay vì generate-all. Route generate-all lọc
  // trước rồi mới gọi nên không bao giờ vướng guard này; guard chỉ chặn thao tác tay lệch thứ tự.
  if (job.chaining !== 'off') {
    const prevSegment = findPreviousSegment(job, found.product, segment);
    if (prevSegment && prevSegment.status !== 'done') {
      return { segmentId, ok: false, error: 'Đoạn liền trước chưa xong — chờ hoàn tất để giữ đúng thứ tự' };
    }
  }

  try {
    // Ref (r2v) luôn ưu tiên hơn i2v chaining thuần (startPath) để giữ sản phẩm/nhân vật nhất
    // quán xuyên suốt — chỉ dùng startPath (endpoint StartImage) khi hoàn toàn không có ref nào
    // khác. Veo reference-to-video chỉ nhận TỐI ĐA 3 ảnh reference (vượt → Flow trả
    // INVALID_ARGUMENT), nên ưu tiên: ảnh sản phẩm (1..N) → ảnh mẫu (người dẫn) → ảnh background,
    // cắt bớt tới khi đủ 3 — chừa 1 chỗ cho frame cuối đoạn liền trước nếu có (chaining).
    // Tải lại ảnh ref từ R2 về local nếu file local mất (server mới sau deploy) — Google Flow đọc
    // file local để làm refPaths. No-op nếu file đã có / không có bản R2.
    const MAX_REF_IMAGES = 3;
    const hasPrevFrame =
      findPreviousSegment(job, found.product, segment)?.status === 'done' &&
      !!findPreviousSegment(job, found.product, segment)?.lastFramePath;
    const refCandidates = [
      ...(job.selectedRefImagePaths ?? []),
      ...(job.selectedModelImagePath ? [job.selectedModelImagePath] : []),
      ...(job.selectedBackgroundImagePath ? [job.selectedBackgroundImagePath] : []),
    ].slice(0, hasPrevFrame ? MAX_REF_IMAGES - 1 : MAX_REF_IMAGES);
    const refPathList: string[] = [];
    for (const relPath of refCandidates) {
      await ensureLocalImage(jobId, relPath, job.imageR2Urls?.[relPath]);
      refPathList.push(relPath);
    }
    // refImages dùng mediaId đã cache (job.flowMediaIds) nếu có — tránh upload lại lên Flow.
    // relPathByAbsPath dùng để map ngược uploadedMediaIds (keyed theo abs path) → relPath khi lưu cache.
    const relPathByAbsPath = new Map<string, string>();
    const refImages: { path: string; mediaId?: string }[] = refPathList.map((relPath) => {
      const absPath = resolveWithinJob(jobId, relPath);
      relPathByAbsPath.set(absPath, relPath);
      return { path: absPath, mediaId: job.flowMediaIds?.[relPath] };
    });

    const prevSegment = findPreviousSegment(job, found.product, segment);
    const prevLastFramePath =
      prevSegment?.status === 'done' && prevSegment.lastFramePath
        ? resolveWithinJob(jobId, prevSegment.lastFramePath)
        : undefined;

    let startImage: { path: string } | undefined;
    if (prevLastFramePath) {
      if (refImages.length > 0) {
        // Frame cuối đoạn trước không có relPath cố định trong kho ảnh (mỗi đoạn 1 frame khác
        // nhau) nên không cache mediaId cho ảnh này — luôn upload mới.
        refImages.push({ path: prevLastFramePath });
      } else {
        startImage = { path: prevLastFramePath };
      }
    }

    const flowProjectId = await ensureJobFlowId(jobId);
    const seed = await ensureJobVideoSeed(jobId);

    const { job_id, uploadedMediaIds } = await generateSceneVideo(
      {
        veoPrompt: segment.veoPrompt,
        voiceoverVi: segment.voiceoverVi,
        duration: segment.duration,
      },
      {
        aspect: job.aspectRatio,
        model: job.veoModel,
        flowProjectId,
        startImage,
        refImages: refImages.length > 0 ? refImages : undefined,
        seed,
      }
    );

    await updateJob(jobId, (j) => {
      const f = findSegment(j, segmentId);
      if (!f) return;
      f.segment.status = 'generating';
      f.segment.jobId = job_id;
      f.segment.error = null;
      // Xoá video cũ (nếu gen lại đoạn đã done) để UI không preview video cũ trong lúc đang
      // gen; sẽ được set lại khi poll xong. videoUrl trên R2 cũ giữ nguyên (best-effort không
      // xoá object R2 — sẽ bị đè key khi upload lại cùng tên file).
      f.segment.videoPath = null;
      f.segment.videoUrl = null;
      f.segment.attempts += 1;
      f.segment.lastUpdatedAt = new Date().toISOString();
      if (!j.flowMediaIds) j.flowMediaIds = {};
      for (const [absPath, mediaId] of Object.entries(uploadedMediaIds)) {
        const relPath = relPathByAbsPath.get(absPath);
        if (relPath) j.flowMediaIds[relPath] = mediaId;
      }
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

const STOP_ERROR_MESSAGE =
  'Đã dừng theo dõi — job Flow vẫn có thể đang chạy ngầm, bấm "Đồng bộ lại" để kiểm tra kết quả';

/**
 * Dừng theo dõi 1 đoạn đang generating — KHÔNG hủy được job thật bên Google Flow (bộ MCP
 * tool Orino Flow không có tool hủy job), chỉ đánh dấu về "failed" để retry ngay. GIỮ NGUYÊN
 * `jobId` (không xoá) — Flow vẫn chạy ngầm và có thể ra video, nút "Đồng bộ lại" cần jobId này
 * để poll lại và lấy kết quả (xem app/api/livestream/[id]/segments/[segmentId]/sync/route.ts).
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
    f.segment.lastUpdatedAt = new Date().toISOString();
  });

  return { segmentId, ok: true };
}

/** Xoá video đã gen của 1 đoạn (local + R2 best-effort), đưa đoạn về lại 'idle' để gen mới. */
export async function deleteSegmentVideo(jobId: string, segmentId: string): Promise<TriggerResult> {
  const job = await readJob(jobId);
  const found = findSegment(job, segmentId);
  if (!found) {
    return { segmentId, ok: false, error: 'Đoạn không tồn tại' };
  }
  if (found.segment.status === 'generating') {
    return { segmentId, ok: false, error: 'Đoạn đang generating' };
  }
  const { videoPath } = found.segment;
  if (videoPath) {
    await fs.rm(resolveWithinJob(jobId, videoPath), { force: true }).catch(() => {});
    await deleteFromR2(`livestream/${jobId}/segments/${path.basename(videoPath)}`);
  }

  await updateJob(jobId, (j) => {
    const f = findSegment(j, segmentId);
    if (!f) return;
    f.segment.status = 'idle';
    f.segment.videoPath = null;
    f.segment.videoUrl = null;
    f.segment.error = null;
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
        segment.lastUpdatedAt = new Date().toISOString();
        stopped.push(segment.id);
      }
    }
  });
  return stopped;
}
