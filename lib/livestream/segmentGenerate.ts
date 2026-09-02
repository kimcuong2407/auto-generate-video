import fs from 'node:fs/promises';
import path from 'node:path';
import { readJob, updateJob, ensureJobFlowId, ensureJobVideoSeed } from './jobStore';
import { resolveWithinJob } from './paths';
import { ensureLocalImage } from './imageR2';
import { findPreviousSegment, pickRefImagePaths } from './refImages';
import { loadPromptSet } from './promptStore';
import { generateSceneVideo } from '../googleFlow/flowJobs';
import { triggerBackgroundImageGeneration } from './backgroundGenerate';
import { ensureLastFrame } from '../ffmpeg/ensureFrame';
import { FlowApiError, isQuotaError } from '../googleFlow/errors';
import { MAX_SEGMENT_AUTO_RETRIES } from '../constants';
import { deleteFromR2, keyFromPublicUrl } from '../r2/client';
import type { LivestreamJob, LivestreamProduct, LivestreamSegment } from './types';

// Re-export: 2 hàm thuần nay ở refImages.ts (client dùng chung), giữ đường import cũ cho caller.
export { findPreviousSegment, findNextSegment } from './refImages';

export interface TriggerResult {
  segmentId: string;
  ok: boolean;
  jobId?: string;
  error?: string;
  /** true = thất bại vì HẾT QUOTA Veo phía Google, không phải lỗi tạm thời (xem isQuotaError). */
  quotaExceeded?: boolean;
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
 * Quyết định (thuần) phải làm gì để job có ảnh nền:
 * - đã chọn rồi → 'ok', khỏi đụng gì.
 * - kho đã có ảnh (Mr.D tự upload / gen trước đó) → 'select' ảnh MỚI NHẤT, không tốn lượt gen.
 * - kho rỗng → 'generate'; không có sản phẩm nào thì không gen nổi (prompt cần mô tả sản phẩm).
 */
export function planBackgroundEnsure(job: {
  selectedBackgroundImagePath: string | null;
  backgroundImagePaths?: string[];
  products: { id: string }[];
}): { action: 'ok' } | { action: 'select'; path: string } | { action: 'generate'; productId: string } | { action: 'blocked'; error: string } {
  if (job.selectedBackgroundImagePath) return { action: 'ok' };
  const existing = (job.backgroundImagePaths ?? []).at(-1);
  if (existing) return { action: 'select', path: existing };
  if (job.products.length === 0) return { action: 'blocked', error: 'Job chưa có sản phẩm nào' };
  return { action: 'generate', productId: job.products[0].id };
}

/**
 * Đảm bảo job có ảnh nền đã chọn (gen nếu kho rỗng, rồi tự chọn). Quyết định nằm ở
 * planBackgroundEnsure; hàm này chỉ thực thi (gọi AI + ghi DB).
 */
export async function ensureBackgroundImage(
  jobId: string,
  job: LivestreamJob
): Promise<{ ok: boolean; error?: string }> {
  const plan = planBackgroundEnsure(job);
  if (plan.action === 'ok') return { ok: true };
  if (plan.action === 'blocked') return { ok: false, error: plan.error };

  let pick: string;
  if (plan.action === 'select') {
    pick = plan.path;
  } else {
    const gen = await triggerBackgroundImageGeneration(jobId, plan.productId);
    if (!gen.ok || !gen.imagePath) return { ok: false, error: gen.error || 'không rõ nguyên nhân' };
    pick = gen.imagePath;
  }
  await updateJob(jobId, (j) => {
    j.selectedBackgroundImagePath = pick;
  });
  return { ok: true };
}

export async function triggerSegmentGeneration(
  jobId: string,
  segmentId: string,
  opts: { requireFailed?: boolean } = {}
): Promise<TriggerResult> {
  let job = await readJob(jobId);
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
  // BẮT BUỘC có ảnh nền trước khi gen video: ảnh nền là thứ khoá bối cảnh/người dẫn cho MỌI đoạn.
  // Thiếu nó, mỗi đoạn Veo tự bịa một căn phòng khác nhau và video ghép lại thấy rõ nhảy cảnh.
  // Chưa có thì tự gen 1 ảnh rồi tự chọn luôn (thay vì bắt Mr.D quay lại bấm tay) — gen fail thì
  // DỪNG, không gen video, vì video gen ra sẽ hỏng đúng theo cách trên.
  if (!job.selectedBackgroundImagePath) {
    const bg = await ensureBackgroundImage(jobId, job);
    if (!bg.ok) {
      return { segmentId, ok: false, error: `Chưa có ảnh nền và gen tự động thất bại: ${bg.error}` };
    }
    job = await readJob(jobId);
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
    // khác. Tải lại ảnh ref từ R2 về local nếu file local mất (server mới sau deploy) — Google
    // Flow đọc file local để làm refPaths. No-op nếu file đã có / không có bản R2.
    const hasPrevFrame =
      findPreviousSegment(job, found.product, segment)?.status === 'done' &&
      !!findPreviousSegment(job, found.product, segment)?.lastFramePath;
    const refCandidates = pickRefImagePaths(job, hasPrevFrame);
    const refPathList: string[] = [];
    const missingRefs: string[] = [];
    for (const relPath of refCandidates) {
      await ensureLocalImage(jobId, relPath, job.imageR2Urls?.[relPath]);
      // ensureLocalImage im lặng khi không khôi phục được (mất local VÀ không có bản R2). Không
      // kiểm tra ở đây thì lỗi nổ muộn thành ENOENT lúc upload lên Flow — thông điệp vô nghĩa với
      // người dùng, và auto-retry sẽ lặp lại mãi vì đây là lỗi VĨNH VIỄN (file không tự quay về).
      try {
        await fs.access(resolveWithinJob(jobId, relPath));
        refPathList.push(relPath);
      } catch {
        missingRefs.push(relPath);
      }
    }
    if (missingRefs.length > 0) {
      const message = `Ảnh tham chiếu không còn tồn tại (mất file local và không có bản R2 để khôi phục): ${missingRefs.join(', ')}. Hãy tải lại ảnh cho job này.`;
      await updateJob(jobId, (j) => {
        const f = findSegment(j, segmentId);
        if (!f) return;
        f.segment.status = 'failed';
        f.segment.error = message;
        // Đốt hết trần retry: file mất là lỗi vĩnh viễn, thử lại mỗi vòng poll chỉ ngập log.
        f.segment.attempts = MAX_SEGMENT_AUTO_RETRIES;
        f.segment.lastUpdatedAt = new Date().toISOString();
      });
      return { segmentId, ok: false, error: message };
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
    // File frame chỉ có ở local (không sync R2) → sau deploy/dọn disk có thể mất dù DB vẫn
    // giữ lastFramePath. Extract lại từ video (local hoặc R2); không được thì bỏ chain,
    // vẫn gen bằng ref images thay vì fail cả đoạn.
    let prevLastFramePath: string | undefined;
    if (prevSegment?.status === 'done' && prevSegment.lastFramePath) {
      const frameAbsPath = resolveWithinJob(jobId, prevSegment.lastFramePath);
      const ok = await ensureLastFrame(
        frameAbsPath,
        prevSegment.videoPath ? resolveWithinJob(jobId, prevSegment.videoPath) : null,
        prevSegment.videoUrl
      );
      if (ok) prevLastFramePath = frameAbsPath;
    }

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

    const { job_id, uploadedMediaIds, flowProjectId: usedFlowProjectId } = await generateSceneVideo(
      {
        veoPrompt: segment.veoPrompt,
        voiceoverVi: segment.voiceoverVi,
        duration: segment.duration,
        // Chặn lỗi tay thừa / sản phẩm biến hình / MC đứng dậy ngay ở tầng gen, thay vì để
        // SCRIPT_QA_SYSTEM_PROMPT đi bắt lỗi SAU khi script đã sinh xong.
        // Registry giữ ngữ nghĩa 3 trạng thái của resolveNegativePrompt cũ: không có row = mặc
        // định, row rỗng = người dùng chủ động TẮT HẲN. Xem doc-comment bảng ai_prompts.
        negativePrompt: (await loadPromptSet(job.slug)).get('negative_video'),
      },
      {
        aspect: job.aspectRatio,
        model: job.veoModel,
        flowProjectId,
        flowProjectTitle: job.name,
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
      // Project cũ bị Google 404 (entity not found) → generateSceneVideo đã tự tạo project mới,
      // lưu lại để các đoạn sau dùng luôn, tránh phải retry 404 lại từ đầu.
      if (usedFlowProjectId !== flowProjectId) j.flowProjectId = usedFlowProjectId;
      if (!j.flowMediaIds) j.flowMediaIds = {};
      for (const [absPath, mediaId] of Object.entries(uploadedMediaIds)) {
        const relPath = relPathByAbsPath.get(absPath);
        if (relPath) j.flowMediaIds[relPath] = mediaId;
      }
    });

    return { segmentId, ok: true, jobId: job_id };
  } catch (err) {
    const message = err instanceof FlowApiError ? err.message : (err as Error).message;
    const quota = isQuotaError(err);
    await updateJob(jobId, (j) => {
      const f = findSegment(j, segmentId);
      if (!f) return;
      f.segment.status = 'failed';
      f.segment.error = message;
      // Tăng attempts cả khi trigger THẤT BẠI (trước đây chỉ tăng lúc thành công): trần retry của
      // cascade đếm theo attempts, không tăng ở đây thì lỗi lặp lại mãi mà counter đứng yên → tự
      // động thử lại vô hạn. Trừ lỗi hết quota: nó không phải "đã dùng 1 lượt thử", quota reset là
      // chạy lại được, đốt hết trần vào đây thì mất luôn quyền tự retry về sau.
      if (!quota) f.segment.attempts += 1;
      f.segment.lastUpdatedAt = new Date().toISOString();
    });
    return { segmentId, ok: false, error: message, quotaExceeded: quota };
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
  const { videoPath, videoUrl } = found.segment;
  if (videoPath) {
    await fs.rm(resolveWithinJob(jobId, videoPath), { force: true }).catch(() => {});
  }
  // Xoá theo videoUrl đã lưu: tên file mang hash nội dung nên chỉ URL mới biết đúng key.
  // Fallback về basename cho video cũ (gen trước khi có hash) vẫn còn videoPath.
  const key = keyFromPublicUrl(videoUrl) ||
    (videoPath ? `livestream/${jobId}/segments/${path.basename(videoPath)}` : null);
  if (key) await deleteFromR2(key);

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
