import { readProject, updateProject, ensureProjectFlowId } from './projectStore';
import { resolveWithinProject } from '../paths';
import { generateSceneVideo } from '../googleFlow/flowJobs';
import { FlowApiError } from '../googleFlow/errors';
import type { Scene } from '../types';

export interface TriggerResult {
  sceneId: string;
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Trigger gen video cho 1 scene: validate trạng thái, gọi generateSceneVideo,
 * cập nhật project.json. Dùng chung cho route generate/retry/generate-all.
 */
export async function triggerSceneGeneration(
  projectId: string,
  sceneId: string,
  opts: { requireFailed?: boolean } = {}
): Promise<TriggerResult> {
  const project = await readProject(projectId);
  const scene = project.script.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    return { sceneId, ok: false, error: 'Scene không tồn tại' };
  }
  if (scene.status === 'generating') {
    return { sceneId, ok: false, error: 'Scene đang generating' };
  }
  if (opts.requireFailed && scene.status !== 'failed') {
    return { sceneId, ok: false, error: 'Scene chưa ở trạng thái failed' };
  }
  if (!scene.veoPrompt.trim()) {
    return { sceneId, ok: false, error: 'Scene chưa có Veo prompt — cần duyệt kịch bản trước' };
  }

  try {
    // Ảnh storyboard của chính scene này (Bước 3, nếu đã gen xong) làm tham chiếu duy
    // nhất khi gen video — ảnh này đã kết tinh sẵn sản phẩm + nhân vật + bối cảnh nên
    // không cần gửi thêm ảnh sản phẩm/nhân vật gốc từ Bước 1 nữa.
    const refImages: { path: string }[] = [];
    const storyboardImage = project.storyboard.images.find((img) => img.sceneId === sceneId);
    if (storyboardImage?.status === 'done' && storyboardImage.imagePath) {
      refImages.push({ path: resolveWithinProject(projectId, storyboardImage.imagePath) });
    }

    // Chain khung hình cuối cảnh trước → khung hình đầu cảnh này, tạo continuity thị giác.
    let startImage: { path: string } | undefined;
    if (project.sceneChaining && scene.order > 1) {
      const prevScene = project.script.scenes.find((s) => s.order === scene.order - 1);
      if (prevScene?.status === 'done' && prevScene.lastFramePath) {
        startImage = { path: resolveWithinProject(projectId, prevScene.lastFramePath) };
      }
    }

    const flowProjectId = await ensureProjectFlowId(projectId);

    const { job_id } = await generateSceneVideo(
      {
        veoPrompt: scene.veoPrompt,
        voiceoverVi: scene.voiceoverVi,
        negativePrompt: scene.negativePrompt,
        duration: scene.duration,
      },
      {
        aspect: project.aspectRatio,
        model: project.veoModel,
        flowProjectId,
        refImages,
        startImage,
      }
    );

    await updateProject(projectId, (p) => {
      const s = p.script.scenes.find((x) => x.id === sceneId);
      if (!s) return;
      applyGeneratingState(s, job_id, !!startImage);
    });

    return { sceneId, ok: true, jobId: job_id };
  } catch (err) {
    const message = err instanceof FlowApiError ? err.message : (err as Error).message;
    await updateProject(projectId, (p) => {
      const s = p.script.scenes.find((x) => x.id === sceneId);
      if (!s) return;
      s.status = 'failed';
      s.error = message;
      s.lastUpdatedAt = new Date().toISOString();
    });
    return { sceneId, ok: false, error: message };
  }
}

function applyGeneratingState(scene: Scene, jobId: string, chained: boolean): void {
  scene.status = 'generating';
  scene.jobId = jobId;
  scene.error = null;
  scene.attempts += 1;
  scene.lastUpdatedAt = new Date().toISOString();
  scene.chainedFromPrevious = chained;
}

const STOP_ERROR_MESSAGE = 'Đã dừng theo yêu cầu người dùng';

/**
 * Dừng theo dõi 1 scene đang generating: KHÔNG hủy được job thật bên Google Flow
 * (không có endpoint hủy trong bộ API này) — chỉ đánh dấu scene về "failed" để retry.
 */
export async function stopSceneGeneration(projectId: string, sceneId: string): Promise<TriggerResult> {
  const project = await readProject(projectId);
  const scene = project.script.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    return { sceneId, ok: false, error: 'Scene không tồn tại' };
  }
  if (scene.status !== 'generating') {
    return { sceneId, ok: false, error: 'Scene không đang generating' };
  }

  await updateProject(projectId, (p) => {
    const s = p.script.scenes.find((x) => x.id === sceneId);
    if (!s || s.status !== 'generating') return;
    s.status = 'failed';
    s.error = STOP_ERROR_MESSAGE;
    s.jobId = null;
    s.lastUpdatedAt = new Date().toISOString();
  });

  return { sceneId, ok: true };
}

/** Dừng theo dõi mọi scene đang generating của project (xem stopSceneGeneration). */
export async function stopAllSceneGeneration(projectId: string): Promise<string[]> {
  const stopped: string[] = [];
  await updateProject(projectId, (p) => {
    for (const s of p.script.scenes) {
      if (s.status !== 'generating') continue;
      s.status = 'failed';
      s.error = STOP_ERROR_MESSAGE;
      s.jobId = null;
      s.lastUpdatedAt = new Date().toISOString();
      stopped.push(s.id);
    }
  });
  return stopped;
}
