/**
 * Đồng bộ trạng thái các đoạn đang generating với Google Flow — dùng chung cho route
 * status (client-pull) và background poller (server-side).
 *
 * Nguyên tắc "ưu tiên kết quả poll": LUÔN poll trước, chỉ timeout-check khi Flow vẫn
 * pending/running. Không bao giờ ép 'failed' một đoạn mà Flow đã trả SUCCESSFUL — kể cả
 * khi đã quá FLOW_JOB_TIMEOUT_MS (tránh bug cũ: đóng tab lúc gen → mở lại sau 15' →
 * timeout-check giết oan video đã xong).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJob, updateJob } from './jobStore';
import { pollJobStatus } from '../googleFlow/flowJobs';
import { triggerSegmentGeneration, findNextSegment, findPreviousSegment } from './segmentGenerate';
import { extractLastFrame } from '../ffmpeg/frame';
import { jobSegmentsDir, jobFramesDir, resolveWithinJob } from './paths';
import { uploadFileToR2, deleteFromR2, md5File } from '../r2/client';
import {
  FLOW_JOB_TIMEOUT_MS,
  MAX_SEGMENT_AUTO_RETRIES,
  SEGMENT_RETRY_BACKOFF_MS,
} from '../constants';
import { segmentVideoFileName } from './segmentSanitize';
import type { LivestreamSegment } from './types';

export interface SyncResult {
  justDoneSegmentIds: string[];
}

export interface ManualSyncResult {
  ok: boolean;
  status?: LivestreamSegment['status'];
  error?: string;
}

function isTimedOut(segment: LivestreamSegment): boolean {
  const startedAt = segment.lastUpdatedAt ? new Date(segment.lastUpdatedAt).getTime() : 0;
  return Date.now() - startedAt > FLOW_JOB_TIMEOUT_MS;
}

/**
 * Poll 1 segment (đã có jobId) bằng mediaId cũ và ghi kết quả vào chính object `segment`
 * (mutate — caller phải gọi bên trong updateJob). Dùng chung cho:
 * - syncGeneratingSegments: loop tự động mọi đoạn đang 'generating'.
 * - route /segments/[segmentId]/sync: đồng bộ thủ công 1 đoạn 'failed' (vd sau khi bấm Dừng)
 *   để lấy lại video nếu Flow đã render xong ngầm — case này không áp timeout-check vì người
 *   dùng chủ động bấm, luôn muốn biết kết quả poll thật.
 */
export async function syncOneSegment(
  jobId: string,
  segment: LivestreamSegment,
  flowProjectId: string,
  opts: { checkTimeout: boolean }
): Promise<{ becameDone: boolean }> {
  try {
    const jobStatus = await pollJobStatus(segment.jobId as string, flowProjectId);
    if (jobStatus.status === 'done') {
      // Ưu tiên kết quả poll: đã SUCCESSFUL thì set 'done' bất kể quá hạn hay chưa.
      // Nếu copy/download lỗi → GIỮ 'generating' + ghi error để lần poll sau tải lại
      // (video vẫn còn trên Flow), KHÔNG ép 'failed' làm mất video đã xong.
      if (jobStatus.video_path) {
        // Tên file mang hash nội dung → mỗi bản gen là một key R2 mới, CDN không thể trả
        // bản cũ (xem segmentVideoFileName). Hash tính từ chính file vừa tải về từ Flow.
        const contentHash = await md5File(jobStatus.video_path);
        const destFileName = segmentVideoFileName(segment.order, segment.id, contentHash);
        const destPath = path.join(jobSegmentsDir(jobId), destFileName);
        // fs.copyFile không tự tạo thư mục đích — đảm bảo outputs/segments có sẵn (thiếu
        // nếu job chạy trên máy khác máy tạo, share chung DB/R2).
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(jobStatus.video_path, destPath);

        // Dọn bản cũ của CHÍNH đoạn này (local + R2) trước khi trỏ sang file mới — key đã
        // đổi nên không còn bị ghi đè, không dọn thì rác tồn mãi trên đĩa và R2.
        const previousPath = segment.videoPath;
        if (previousPath && path.basename(previousPath) !== destFileName) {
          await fs.rm(resolveWithinJob(jobId, previousPath), { force: true }).catch(() => {});
          await deleteFromR2(`livestream/${jobId}/segments/${path.basename(previousPath)}`);
        }

        segment.videoPath = path.join('outputs', 'segments', destFileName);
        // Upload lên R2 để preview/tải online không phụ thuộc route stream local — vẫn giữ
        // file local vì bước concat cần ffmpeg đọc trực tiếp (file local sẽ được xoá SAU
        // khi concat xong, xem runLivestreamConcat). No-op nếu R2 chưa cấu hình.
        segment.videoUrl = await uploadFileToR2(
          destPath,
          `livestream/${jobId}/segments/${destFileName}`,
          'video/mp4'
        );
      }
      segment.status = 'done';
      segment.error = null;
      segment.lastUpdatedAt = new Date().toISOString();
      return { becameDone: true };
    }
    if (jobStatus.status === 'error' || jobStatus.status === 'cancelled') {
      segment.status = 'failed';
      segment.error = jobStatus.error || `Job ${jobStatus.status}`;
      segment.lastUpdatedAt = new Date().toISOString();
      return { becameDone: false };
    }
    // pending/running
    segment.status = 'generating';
    if (opts.checkTimeout && isTimedOut(segment)) {
      segment.status = 'failed';
      segment.error = 'Timeout: chờ job quá lâu';
      segment.lastUpdatedAt = new Date().toISOString();
    }
    // chưa quá hạn (hoặc không check timeout) → giữ 'generating', chờ lần poll sau
    return { becameDone: false };
  } catch (err) {
    // Poll (hoặc download khi done) lỗi tạm thời: ghi error để chẩn đoán. Chỉ ép
    // 'failed' nếu đã quá hạn — chưa quá thì giữ 'generating' để lần sau thử lại,
    // không kẹt vô hạn cũng không giết oan.
    segment.error = `Poll lỗi tạm thời: ${(err as Error).message}`;
    if (opts.checkTimeout && isTimedOut(segment)) {
      segment.status = 'failed';
      segment.error = 'Timeout: chờ job quá lâu';
      segment.lastUpdatedAt = new Date().toISOString();
    }
    return { becameDone: false };
  }
}

/**
 * Poll mọi đoạn đang generating của 1 job, cập nhật status trong job.json (nguyên tử qua
 * updateJob). Trả về id các đoạn vừa chuyển 'done' để caller chạy chaining (KHÔNG nhét
 * chaining vào đây: updateJob có write-queue tuần tự theo jobId, nested sẽ deadlock).
 */
export async function syncGeneratingSegments(jobId: string): Promise<SyncResult> {
  const justDoneSegmentIds: string[] = [];
  await updateJob(jobId, async (job) => {
    if (!job.flowProjectId) return;
    const generatingSegments = job.products.flatMap((p) =>
      p.segments.filter((s) => s.status === 'generating' && s.jobId)
    );
    await Promise.all(
      generatingSegments.map(async (segment) => {
        const { becameDone } = await syncOneSegment(jobId, segment, job.flowProjectId as string, {
          checkTimeout: true,
        });
        if (becameDone) justDoneSegmentIds.push(segment.id);
      })
    );
  });
  return { justDoneSegmentIds };
}

/**
 * Đồng bộ thủ công 1 đoạn theo yêu cầu người dùng (nút "🔄 Đồng bộ lại") — dùng khi đoạn đã bị
 * "Dừng" (status 'failed') nhưng job Flow thật vẫn có thể đang chạy ngầm hoặc đã ra video, xem
 * STOP_ERROR_MESSAGE ở segmentGenerate.ts. Không giới hạn theo status 'generating' như
 * syncGeneratingSegments — chỉ cần còn `jobId` (mediaId Flow) là poll lại được.
 */
export async function syncSegmentManually(jobId: string, segmentId: string): Promise<ManualSyncResult> {
  const job = await readJob(jobId);
  const segment = job.products.flatMap((p) => p.segments).find((s) => s.id === segmentId);
  if (!segment) {
    return { ok: false, error: 'Đoạn không tồn tại' };
  }
  if (!segment.jobId) {
    return { ok: false, error: 'Đoạn chưa từng generate — không có gì để đồng bộ' };
  }
  if (segment.status === 'done') {
    return { ok: true, status: 'done' };
  }
  if (!job.flowProjectId) {
    return { ok: false, error: 'Job chưa có flowProjectId' };
  }

  let resultStatus: LivestreamSegment['status'] = segment.status;
  await updateJob(jobId, async (j) => {
    const s = j.products.flatMap((p) => p.segments).find((x) => x.id === segmentId);
    if (!s || !s.jobId) return;
    await syncOneSegment(jobId, s, j.flowProjectId as string, { checkTimeout: false });
    resultStatus = s.status;
  });

  return { ok: true, status: resultStatus };
}

/**
 * Với mỗi đoạn vừa done: extract khung hình cuối rồi tự trigger đoạn kế tiếp (nếu đang idle)
 * — cascade tuần tự qua các lần poll. Tách updateJob riêng, KHÔNG nested trong mutator của
 * syncGeneratingSegments (write-queue theo jobId tuần tự, nested sẽ deadlock).
 *
 * Lưu ý ràng buộc: cascade trigger đoạn kế gọi generateVideo → cần reCAPTCHA mint từ
 * extension trên tab labs.google. Nếu extension offline, trigger sẽ fail (segment kế giữ
 * idle) nhưng đoạn vừa done KHÔNG bị ảnh hưởng — reconcile done/download không cần reCAPTCHA.
 */
/**
 * Đoạn kế có được cascade tự trigger hay không.
 *
 * 'idle' = chưa chạy lần nào → chạy. 'failed' = lần trước lỗi: vẫn chạy lại, MIỄN là chưa quá trần
 * MAX_SEGMENT_AUTO_RETRIES. Trước đây chỉ nhận 'idle' nên 1 đoạn hỏng vì lỗi tạm thời (mint
 * reCAPTCHA timeout, Flow 5xx) làm đứt dây chuyền vĩnh viễn — người dùng bấm gen cả block mà chỉ
 * chạy tới đoạn hỏng rồi nằm im, phải ngồi bấm tay từng đoạn còn lại.
 *
 * Trần theo `attempts` (tăng mỗi lần trigger) để lỗi THẬT không quay vòng vô hạn đốt quota Veo.
 */
export function shouldAutoTrigger(segment: LivestreamSegment, now = Date.now()): boolean {
  if (!segment.veoPrompt.trim()) return false;
  if (segment.status === 'idle') return true;
  if (segment.status !== 'failed') return false;
  if (segment.attempts >= MAX_SEGMENT_AUTO_RETRIES) return false;
  // Lùi lại trước khi thử lại: poller chạy mỗi 15s, thử lại ngay thì đoạn lỗi vì hết quota Veo bị
  // đập 240 lần/giờ. Lỗi hết quota không tăng attempts (xem triggerSegmentGeneration) nên backoff
  // theo thời gian là thứ DUY NHẤT chặn vòng lặp đó.
  const lastAt = segment.lastUpdatedAt ? new Date(segment.lastUpdatedAt).getTime() : 0;
  return now - lastAt >= SEGMENT_RETRY_BACKOFF_MS;
}

export async function runChainingForJustDone(
  jobId: string,
  justDoneSegmentIds: string[]
): Promise<void> {
  if (justDoneSegmentIds.length === 0) return;

  let job = await readJob(jobId);
  if (job.chaining === 'off') return;

  await fs.mkdir(jobFramesDir(jobId), { recursive: true });

  for (const segmentId of justDoneSegmentIds) {
    const product = job.products.find((p) => p.segments.some((s) => s.id === segmentId));
    const segment = product?.segments.find((s) => s.id === segmentId);
    if (!product || !segment?.videoPath) continue;

    const frameFileName = `${segment.order.toString().padStart(3, '0')}_${segment.id}_last.jpg`;
    const frameAbsPath = path.join(jobFramesDir(jobId), frameFileName);
    const framePath = path.join('outputs', 'frames', frameFileName);

    try {
      const videoAbsPath = resolveWithinJob(jobId, segment.videoPath);
      await extractLastFrame(videoAbsPath, frameAbsPath);
      const { job: afterFrame } = await updateJob(jobId, (j) => {
        for (const p of j.products) {
          const s = p.segments.find((x) => x.id === segmentId);
          if (s) s.lastFramePath = framePath;
        }
      });
      job = afterFrame;
    } catch (err) {
      console.error(`[livestream chaining] extract last frame thất bại cho đoạn ${segmentId}:`, err);
      continue;
    }

    const nextSegment = findNextSegment(job, product, segment);
    if (nextSegment && shouldAutoTrigger(nextSegment)) {
      try {
        const res = await triggerSegmentGeneration(jobId, nextSegment.id, { requireFailed: false });
        // Hết quota Veo → dừng cascade cả vòng này: các đoạn sau chắc chắn cũng 429, thử tiếp chỉ
        // đập vào API vô ích. Đoạn vẫn ở 'failed' nên vòng poll sau (khi quota đã reset) tự chạy lại.
        if (res.quotaExceeded) {
          console.warn(`[livestream chaining] job ${jobId}: hết quota Veo, tạm dừng cascade`);
          return;
        }
      } catch (err) {
        console.error(`[livestream chaining] trigger đoạn kế ${nextSegment.id} thất bại:`, err);
      }
      job = await readJob(jobId);
    }
  }
}

/**
 * Nối lại dây chuyền cho 1 job khi nó đứt giữa chừng — độc lập với `justDoneSegmentIds`.
 *
 * Vì sao cần thêm dù đã có cascade trong runChainingForJustDone: cascade chỉ chạy khi có đoạn VỪA
 * chuyển done. Đoạn đang generating mà hỏng (mint reCAPTCHA timeout, Flow 5xx) thì không có đoạn
 * nào done trong vòng poll đó → không ai trigger tiếp, job nằm chết với hàng loạt đoạn idle phía
 * sau dù người dùng đã bấm gen cả block.
 *
 * Chạy mỗi vòng poll, chi phí gần như bằng 0 khi không có gì để làm (chỉ đọc job trong bộ nhớ):
 * - Đang có đoạn generating → không đụng vào, chờ nó xong (giữ đúng thứ tự chain).
 * - Không còn đoạn nào chạy mà vẫn còn việc → trigger đoạn kế tiếp hợp lệ đầu tiên.
 *
 * Trả về id đoạn vừa được trigger lại (null nếu không làm gì) để caller log.
 */
export async function resumeStalledJob(jobId: string): Promise<string | null> {
  const job = await readJob(jobId);
  if (job.status === 'done') return null;

  const all = job.products.flatMap((p) => p.segments.map((segment) => ({ product: p, segment })));
  // Còn đoạn đang chạy → dây chuyền chưa đứt, để yên (trigger thêm sẽ gen chồng, lệch thứ tự).
  if (all.some(({ segment }) => segment.status === 'generating')) return null;
  // CHỈ nối tiếp việc người dùng đã bắt đầu: phải có đoạn từng được trigger (attempts > 0). Không
  // có điều kiện này thì poller sẽ tự khởi động MỌI job nháp chưa ai bấm gen, đốt quota Veo.
  if (!all.some(({ segment }) => segment.attempts > 0)) return null;

  const candidate = all.find(({ product, segment }) => {
    if (!shouldAutoTrigger(segment)) return false;
    // Tôn trọng đúng ràng buộc tuần tự của chaining: đoạn liền trước phải xong đã.
    if (job.chaining === 'off') return true;
    const prev = findPreviousSegment(job, product, segment);
    return !prev || prev.status === 'done';
  });
  if (!candidate) return null;

  try {
    const res = await triggerSegmentGeneration(jobId, candidate.segment.id, { requireFailed: false });
    if (!res.ok) {
      // Hết quota là trạng thái chờ, không phải hỏng — log gọn để khỏi ngập log mỗi vòng poll.
      if (res.quotaExceeded) {
        console.warn(`[livestream resume] job ${jobId}: hết quota Veo, chờ quota reset rồi tự chạy tiếp`);
      } else {
        console.error(`[livestream resume] trigger lại ${candidate.segment.id} thất bại: ${res.error}`);
      }
      return null;
    }
    console.log(`[livestream resume] nối lại dây chuyền job ${jobId} từ đoạn ${candidate.segment.id}`);
    return candidate.segment.id;
  } catch (err) {
    console.error(`[livestream resume] trigger lại ${candidate.segment.id} lỗi:`, err);
    return null;
  }
}
