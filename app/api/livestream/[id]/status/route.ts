import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { getFlowStatus, pollJobStatus } from '@/lib/googleFlow/flowJobs';
import { triggerSegmentGeneration, findNextSegment } from '@/lib/livestream/segmentGenerate';
import { extractLastFrame } from '@/lib/ffmpeg/frame';
import { jobSegmentsDir, jobFramesDir, resolveWithinJob } from '@/lib/livestream/paths';
import { FLOW_JOB_TIMEOUT_MS } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  // 1. Refresh flow_status cache (không chặn nếu lỗi — chỉ ghi lại lỗi để UI hiển thị)
  try {
    const status = await getFlowStatus();
    await updateJob(id, (job) => {
      job.flowStatusCache = {
        flowConnected: status.flow_connected,
        geminiConnected: status.gemini_connected,
        projectsError: status.projects_error ?? null,
        checkedAt: new Date().toISOString(),
      };
    });
  } catch (err) {
    await updateJob(id, (job) => {
      job.flowStatusCache = {
        flowConnected: false,
        geminiConnected: false,
        projectsError: (err as Error).message,
        checkedAt: new Date().toISOString(),
      };
    });
  }

  // 2. Sync các đoạn đang generating với flow_job_status
  const justDoneSegmentIds: string[] = [];
  const { job: afterSync } = await updateJob(id, async (job) => {
    const generatingSegments = job.products.flatMap((p) =>
      p.segments.filter((s) => s.status === 'generating' && s.jobId)
    );

    await Promise.all(
      generatingSegments.map(async (segment) => {
        const startedAt = segment.lastUpdatedAt ? new Date(segment.lastUpdatedAt).getTime() : 0;
        if (Date.now() - startedAt > FLOW_JOB_TIMEOUT_MS) {
          segment.status = 'failed';
          segment.error = 'Timeout: chờ job quá lâu';
          segment.lastUpdatedAt = new Date().toISOString();
          return;
        }

        try {
          if (!job.flowProjectId) return;
          const jobStatus = await pollJobStatus(segment.jobId as string, job.flowProjectId);
          if (jobStatus.status === 'done') {
            if (jobStatus.video_path) {
              const destFileName = `${segment.order.toString().padStart(3, '0')}_${segment.id}.mp4`;
              const destPath = path.join(jobSegmentsDir(id), destFileName);
              await fs.copyFile(jobStatus.video_path, destPath);
              segment.videoPath = path.join('outputs', 'segments', destFileName);
            }
            segment.status = 'done';
            segment.error = null;
            segment.lastUpdatedAt = new Date().toISOString();
            justDoneSegmentIds.push(segment.id);
          } else if (jobStatus.status === 'error' || jobStatus.status === 'cancelled') {
            segment.status = 'failed';
            segment.error = jobStatus.error || `Job ${jobStatus.status}`;
            segment.lastUpdatedAt = new Date().toISOString();
          }
          // pending/running → giữ nguyên "generating", chờ lần poll sau
        } catch (err) {
          segment.error = `Poll lỗi tạm thời: ${(err as Error).message}`;
        }
      })
    );
  });

  // 3. Chain khung hình: với mỗi đoạn vừa done, extract khung hình cuối rồi tự trigger đoạn
  // kế tiếp (nếu đang idle) — cascade tuần tự qua các lần poll. Tách updateJob riêng, KHÔNG
  // nested trong mutator ở bước 2 (write-queue theo jobId là tuần tự, nested sẽ deadlock).
  let job = afterSync;
  if (job.chaining !== 'off' && justDoneSegmentIds.length > 0) {
    await fs.mkdir(jobFramesDir(id), { recursive: true });

    for (const segmentId of justDoneSegmentIds) {
      const product = job.products.find((p) => p.segments.some((s) => s.id === segmentId));
      const segment = product?.segments.find((s) => s.id === segmentId);
      if (!product || !segment?.videoPath) continue;

      const frameFileName = `${segment.order.toString().padStart(3, '0')}_${segment.id}_last.jpg`;
      const frameAbsPath = path.join(jobFramesDir(id), frameFileName);
      const framePath = path.join('outputs', 'frames', frameFileName);

      try {
        const videoAbsPath = resolveWithinJob(id, segment.videoPath);
        await extractLastFrame(videoAbsPath, frameAbsPath);
        const { job: afterFrame } = await updateJob(id, (j) => {
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
        await triggerSegmentGeneration(id, nextSegment.id);
        job = await readJob(id);
      }
    }
  }

  return NextResponse.json({ job });
}
