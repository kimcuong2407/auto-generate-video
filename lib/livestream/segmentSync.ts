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
import { triggerSegmentGeneration, findNextSegment } from './segmentGenerate';
import { extractLastFrame } from '../ffmpeg/frame';
import { jobSegmentsDir, jobFramesDir, resolveWithinJob } from './paths';
import { uploadFileToR2 } from '../r2/client';
import { FLOW_JOB_TIMEOUT_MS } from '../constants';
import type { LivestreamSegment } from './types';

export interface SyncResult {
  justDoneSegmentIds: string[];
}

function isTimedOut(segment: LivestreamSegment): boolean {
  const startedAt = segment.lastUpdatedAt ? new Date(segment.lastUpdatedAt).getTime() : 0;
  return Date.now() - startedAt > FLOW_JOB_TIMEOUT_MS;
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
        try {
          const jobStatus = await pollJobStatus(segment.jobId as string, job.flowProjectId as string);

          if (jobStatus.status === 'done') {
            // Ưu tiên kết quả poll: đã SUCCESSFUL thì set 'done' bất kể quá hạn hay chưa.
            // Nếu copy/download lỗi → GIỮ 'generating' + ghi error để lần poll sau tải lại
            // (video vẫn còn trên Flow), KHÔNG ép 'failed' làm mất video đã xong.
            if (jobStatus.video_path) {
              const destFileName = `${segment.order.toString().padStart(3, '0')}_${segment.id}.mp4`;
              const destPath = path.join(jobSegmentsDir(jobId), destFileName);
              await fs.copyFile(jobStatus.video_path, destPath);
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
            justDoneSegmentIds.push(segment.id);
          } else if (jobStatus.status === 'error' || jobStatus.status === 'cancelled') {
            segment.status = 'failed';
            segment.error = jobStatus.error || `Job ${jobStatus.status}`;
            segment.lastUpdatedAt = new Date().toISOString();
          } else {
            // pending/running → chỉ khi Flow chưa xong mới xét timeout.
            if (isTimedOut(segment)) {
              segment.status = 'failed';
              segment.error = 'Timeout: chờ job quá lâu';
              segment.lastUpdatedAt = new Date().toISOString();
            }
            // chưa quá hạn → giữ 'generating', chờ lần poll sau
          }
        } catch (err) {
          // Poll (hoặc download khi done) lỗi tạm thời: ghi error để chẩn đoán. Chỉ ép
          // 'failed' nếu đã quá hạn — chưa quá thì giữ 'generating' để lần sau thử lại,
          // không kẹt vô hạn cũng không giết oan.
          segment.error = `Poll lỗi tạm thời: ${(err as Error).message}`;
          if (isTimedOut(segment)) {
            segment.status = 'failed';
            segment.error = 'Timeout: chờ job quá lâu';
            segment.lastUpdatedAt = new Date().toISOString();
          }
        }
      })
    );
  });

  return { justDoneSegmentIds };
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
    if (nextSegment && nextSegment.status === 'idle' && nextSegment.veoPrompt.trim()) {
      try {
        await triggerSegmentGeneration(jobId, nextSegment.id);
      } catch (err) {
        console.error(`[livestream chaining] trigger đoạn kế ${nextSegment.id} thất bại:`, err);
      }
      job = await readJob(jobId);
    }
  }
}
