/**
 * Đồng bộ trạng thái các scene đang generating với Google Flow — dùng chung cho route
 * status (client-pull khi mở tab) và background poller (server-side, độc lập UI).
 *
 * Nguyên tắc "ưu tiên kết quả poll": LUÔN poll trước, chỉ timeout-check khi Flow vẫn
 * pending/running. Không bao giờ ép 'failed' một scene mà Flow đã trả SUCCESSFUL — kể cả
 * khi đã quá FLOW_JOB_TIMEOUT_MS (tránh bug: đóng tab lúc gen → mở lại sau 15' → timeout
 * giết oan video đã xong). Nếu download/copy lỗi khi đã done → GIỮ 'generating' + ghi error
 * để lần poll sau tải lại (video vẫn còn trên Flow), KHÔNG mất video.
 *
 * Reconcile done + download + upload R2 KHÔNG cần reCAPTCHA (chỉ cần accessToken refresh
 * qua cookie) → poller nền chạy được không cần extension. Nhưng cascade trigger scene kế
 * (runChainingForJustDone → generateVideo) cần extension mint reCAPTCHA trên tab labs.google;
 * nếu extension offline thì scene kế giữ idle (đã log), scene vừa done không bị ảnh hưởng.
 *
 * Mô phỏng lib/livestream/segmentSync.ts, thêm bước upload R2 (video scene lên storage online).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readProject, updateProject } from './projectStore';
import { triggerSceneGeneration } from './sceneGenerate';
import { pollJobStatus } from '../googleFlow/flowJobs';
import { extractLastFrame } from '../ffmpeg/frame';
import { projectScenesDir, projectFramesDir, resolveWithinProject } from '../paths';
import { uploadFileToR2 } from '../r2/client';
import { FLOW_JOB_TIMEOUT_MS } from '../constants';
import type { Scene } from '../types';

export interface SyncResult {
  justDoneSceneIds: string[];
}

function isTimedOut(scene: Scene): boolean {
  const startedAt = scene.lastUpdatedAt ? new Date(scene.lastUpdatedAt).getTime() : 0;
  return Date.now() - startedAt > FLOW_JOB_TIMEOUT_MS;
}

/**
 * Poll mọi scene đang generating của 1 project, cập nhật status trong project.json (nguyên
 * tử qua updateProject). Trả về id các scene vừa chuyển 'done' để caller chạy chaining
 * (KHÔNG nhét chaining vào đây: updateProject có write-queue tuần tự theo projectId, nested
 * sẽ deadlock).
 */
export async function syncGeneratingScenes(projectId: string): Promise<SyncResult> {
  const justDoneSceneIds: string[] = [];

  await updateProject(projectId, async (project) => {
    if (!project.flowProjectId) return;
    const generatingScenes = project.script.scenes.filter(
      (s) => s.status === 'generating' && s.jobId
    );

    await Promise.all(
      generatingScenes.map(async (scene) => {
        try {
          const jobStatus = await pollJobStatus(scene.jobId as string, project.flowProjectId as string);

          if (jobStatus.status === 'done') {
            // Ưu tiên kết quả poll: đã SUCCESSFUL thì set 'done' bất kể quá hạn hay chưa.
            // Nếu copy/download/upload lỗi → GIỮ 'generating' + ghi error để lần poll sau
            // tải lại (video vẫn còn trên Flow), KHÔNG ép 'failed' làm mất video đã xong.
            if (jobStatus.video_path) {
              const destFileName = `${scene.order.toString().padStart(2, '0')}_${scene.id}.mp4`;
              const destPath = path.join(projectScenesDir(projectId), destFileName);
              // fs.copyFile không tự tạo thư mục đích — cần có sẵn outputs/scenes. Bình
              // thường thư mục này được tạo lúc project creation (projectStore.ts), nhưng
              // thiếu nếu project chạy trên máy khác máy tạo (share chung DB/R2, xem
              // ensureLocalFile) — lúc đó dir chưa từng được scaffold ở đây, copyFile báo
              // nhầm "source ENOENT" dù file tmp vừa tải về có thật.
              await fs.mkdir(path.dirname(destPath), { recursive: true });
              await fs.copyFile(jobStatus.video_path, destPath);
              scene.videoPath = path.join('outputs', 'scenes', destFileName);
              // Upload lên R2 để xem/tải online không phụ thuộc route stream local — vẫn giữ
              // file local vì Bước ghép video (concat) cần đọc trực tiếp bằng ffmpeg.
              scene.videoUrl = await uploadFileToR2(
                destPath,
                `projects/${projectId}/scenes/${destFileName}`,
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
          } else {
            // pending/running → chỉ khi Flow chưa xong mới xét timeout.
            if (isTimedOut(scene)) {
              scene.status = 'failed';
              scene.error = 'Timeout: chờ job quá lâu';
              scene.lastUpdatedAt = new Date().toISOString();
            }
            // chưa quá hạn → giữ 'generating', chờ lần poll sau
          }
        } catch (err) {
          // Poll (hoặc download/upload khi done) lỗi tạm thời: ghi error để chẩn đoán. Chỉ
          // ép 'failed' nếu đã quá hạn — chưa quá thì giữ 'generating' để lần sau thử lại,
          // không kẹt vô hạn cũng không giết oan.
          scene.error = `Poll lỗi tạm thời: ${(err as Error).message}`;
          if (isTimedOut(scene)) {
            scene.status = 'failed';
            scene.error = 'Timeout: chờ job quá lâu';
            scene.lastUpdatedAt = new Date().toISOString();
          }
        }
      })
    );
  });

  return { justDoneSceneIds };
}

/**
 * Với mỗi scene vừa done: extract khung hình cuối rồi tự trigger scene kế tiếp (nếu đang
 * idle) — cascade tuần tự qua các lần poll. Tách updateProject riêng, KHÔNG nested trong
 * mutator của syncGeneratingScenes (write-queue theo projectId tuần tự, nested sẽ deadlock).
 *
 * Ràng buộc: cascade trigger scene kế gọi generateVideo → cần reCAPTCHA mint từ extension
 * trên tab labs.google. Nếu extension offline, trigger sẽ fail (scene kế giữ idle) nhưng
 * scene vừa done KHÔNG bị ảnh hưởng — reconcile done/download không cần reCAPTCHA.
 */
export async function runChainingForJustDone(
  projectId: string,
  justDoneSceneIds: string[]
): Promise<void> {
  if (justDoneSceneIds.length === 0) return;

  let project = await readProject(projectId);
  if (!project.sceneChaining) return;

  await fs.mkdir(projectFramesDir(projectId), { recursive: true });

  for (const sceneId of justDoneSceneIds) {
    const scene = project.script.scenes.find((s) => s.id === sceneId);
    if (!scene?.videoPath) continue;

    const frameFileName = `${scene.order.toString().padStart(2, '0')}_${scene.id}_last.jpg`;
    const frameAbsPath = path.join(projectFramesDir(projectId), frameFileName);
    const framePath = path.join('outputs', 'frames', frameFileName);

    try {
      const videoAbsPath = resolveWithinProject(projectId, scene.videoPath);
      await extractLastFrame(videoAbsPath, frameAbsPath);
      const { project: afterFrame } = await updateProject(projectId, (p) => {
        const s = p.script.scenes.find((x) => x.id === sceneId);
        if (s) s.lastFramePath = framePath;
      });
      project = afterFrame;
    } catch (err) {
      // Lỗi extract frame chỉ log server-side — scene đã gen thành công, chỉ bước chain phụ
      // trợ thất bại, không hiển thị như lỗi scene.
      console.error(`[project chaining] extract last frame thất bại cho scene ${sceneId}:`, err);
      continue;
    }

    const nextScene = project.script.scenes.find((s) => s.order === scene.order + 1);
    if (nextScene && nextScene.status === 'idle' && nextScene.veoPrompt.trim()) {
      try {
        await triggerSceneGeneration(projectId, nextScene.id);
      } catch (err) {
        console.error(`[project chaining] trigger scene kế ${nextScene.id} thất bại:`, err);
      }
      project = await readProject(projectId);
    }
  }
}
