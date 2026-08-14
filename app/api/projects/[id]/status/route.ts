import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import { getFlowStatus, pollJobStatus } from '@/lib/googleFlow/flowJobs';
import { triggerSceneGeneration } from '@/lib/data/sceneGenerate';
import { extractLastFrame } from '@/lib/ffmpeg/frame';
import { projectScenesDir, projectFramesDir, resolveWithinProject } from '@/lib/paths';
import { FLOW_JOB_TIMEOUT_MS } from '@/lib/constants';
import { uploadFileToR2 } from '@/lib/r2/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  // 1. Refresh flow_status cache (không chặn nếu lỗi — chỉ ghi lại lỗi để UI hiển thị)
  try {
    const status = await getFlowStatus();
    await updateProject(id, (project) => {
      project.flowStatusCache = {
        flowConnected: status.flow_connected,
        geminiConnected: status.gemini_connected,
        projectsError: status.projects_error ?? null,
        checkedAt: new Date().toISOString(),
      };
    });
  } catch (err) {
    await updateProject(id, (project) => {
      project.flowStatusCache = {
        flowConnected: false,
        geminiConnected: false,
        projectsError: (err as Error).message,
        checkedAt: new Date().toISOString(),
      };
    });
  }

  // 2. Sync các scene đang generating với flow_job_status
  const justDoneSceneIds: string[] = [];
  const { project: afterSync } = await updateProject(id, async (project) => {
    const generatingScenes = project.script.scenes.filter(
      (s) => s.status === 'generating' && s.jobId
    );

    await Promise.all(
      generatingScenes.map(async (scene) => {
        // Timeout: quá lâu chưa xong → đánh dấu lỗi
        const startedAt = scene.lastUpdatedAt ? new Date(scene.lastUpdatedAt).getTime() : 0;
        if (Date.now() - startedAt > FLOW_JOB_TIMEOUT_MS) {
          scene.status = 'failed';
          scene.error = 'Timeout: chờ job quá lâu';
          scene.lastUpdatedAt = new Date().toISOString();
          return;
        }

        try {
          if (!project.flowProjectId) return;
          const jobStatus = await pollJobStatus(scene.jobId as string, project.flowProjectId);
          if (jobStatus.status === 'done') {
            if (jobStatus.video_path) {
              // flow_job_status trả về path tuyệt đối do Orino Flow tự lưu (nằm ngoài
              // thư mục dữ liệu của app này) — phải copy vào outputs/scenes/ của project.
              const destFileName = `${scene.order.toString().padStart(2, '0')}_${scene.id}.mp4`;
              const destPath = path.join(projectScenesDir(id), destFileName);
              await fs.copyFile(jobStatus.video_path, destPath);
              scene.videoPath = path.join('outputs', 'scenes', destFileName);
              // Upload lên R2 để xem/tải ngay không phụ thuộc route stream local — vẫn giữ
              // file local vì Bước 6 (ghép video) cần đọc trực tiếp bằng ffmpeg.
              scene.videoUrl = await uploadFileToR2(
                destPath,
                `projects/${id}/scenes/${destFileName}`,
                'video/mp4'
              );
            }
            scene.status = 'done';
            scene.error = null;
            scene.lastUpdatedAt = new Date().toISOString();
            justDoneSceneIds.push(scene.id);
          } else if (jobStatus.status === 'error' || jobStatus.status === 'cancelled') {
            scene.status = 'failed';
            scene.error = jobStatus.error || `Job ${jobStatus.status}`;
            scene.lastUpdatedAt = new Date().toISOString();
          }
          // pending/running → giữ nguyên "generating", chờ lần poll sau
        } catch (err) {
          // Lỗi gọi MCP tạm thời — không đánh fail ngay, chỉ log vào error field để hiển thị cảnh báo nhẹ
          scene.error = `Poll lỗi tạm thời: ${(err as Error).message}`;
        }
      })
    );
  });

  // 3. Chain khung hình: với mỗi scene vừa done, extract khung hình cuối rồi tự trigger
  // scene kế tiếp (nếu đang idle) — cascade tuần tự qua các lần poll, không cần người dùng
  // bấm gì thêm. Tách updateProject riêng, KHÔNG nested trong mutator ở bước 2 (write-queue
  // theo projectId là tuần tự, nested sẽ deadlock).
  let project = afterSync;
  if (project.sceneChaining && justDoneSceneIds.length > 0) {
    await fs.mkdir(projectFramesDir(id), { recursive: true });

    for (const sceneId of justDoneSceneIds) {
      const scene = project.script.scenes.find((s) => s.id === sceneId);
      if (!scene?.videoPath) continue;

      const frameFileName = `${scene.order.toString().padStart(2, '0')}_${scene.id}_last.jpg`;
      const frameAbsPath = path.join(projectFramesDir(id), frameFileName);
      const framePath = path.join('outputs', 'frames', frameFileName);

      try {
        const videoAbsPath = resolveWithinProject(id, scene.videoPath);
        await extractLastFrame(videoAbsPath, frameAbsPath);
        const { project: afterFrame } = await updateProject(id, (p) => {
          const s = p.script.scenes.find((x) => x.id === sceneId);
          if (s) s.lastFramePath = framePath;
        });
        project = afterFrame;
      } catch (err) {
        // Lỗi extract frame chỉ log server-side — scene đã gen thành công, chỉ bước chain
        // phụ trợ thất bại, không hiển thị như lỗi scene.
        console.error(`[sceneChaining] extract last frame thất bại cho scene ${sceneId}:`, err);
        continue;
      }

      const nextScene = project.script.scenes.find((s) => s.order === scene.order + 1);
      if (nextScene && nextScene.status === 'idle' && nextScene.veoPrompt.trim()) {
        await triggerSceneGeneration(id, nextScene.id);
        project = await readProject(id);
      }
    }
  }

  return NextResponse.json({ project });
}
