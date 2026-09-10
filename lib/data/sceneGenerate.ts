import { readProject, updateProject, ensureProjectFlowId } from './projectStore';
import { resolveWithinProject } from '../paths';
import { ensureLocalFile } from '../r2/client';
import { generateSceneVideo } from '../googleFlow/flowJobs';
import { ensureLastFrame } from '../ffmpeg/ensureFrame';
import { FlowApiError } from '../googleFlow/errors';
import { planVideoInputs, MAX_REF_IMAGES } from './videoInputs';
import type { Project, Scene } from '../types';

export interface TriggerResult {
  sceneId: string;
  ok: boolean;
  jobId?: string;
  error?: string;
}

/** Tra R2 URL của 1 relPath (ảnh storyboard/sản phẩm/người mẫu/background) để ensureLocalFile khôi phục khi mất local. */
function findRefImageUrl(project: Project, relPath: string): string | null {
  const storyboardImg = project.storyboard.images.find((img) => img.imagePath === relPath);
  if (storyboardImg) return storyboardImg.imageUrl ?? null;
  const productIdx = project.inputs.productImages.indexOf(relPath);
  if (productIdx !== -1) return project.inputs.productImageUrls[productIdx] ?? null;
  if (project.inputs.spokespersonImagePath === relPath) return project.inputs.spokespersonImageUrl;
  return project.storyboard.backgrounds.find((b) => b.imagePath === relPath)?.imageUrl ?? null;
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
    const plan = planVideoInputs(project, scene);

    /** Resolve relPath → abs, khôi phục file local từ R2 nếu thiếu (gen ở máy khác máy tạo project). */
    const toAbs = async (relPath: string) => {
      const absPath = resolveWithinProject(projectId, relPath);
      await ensureLocalFile(absPath, findRefImageUrl(project, relPath));
      return { path: absPath };
    };

    // Frame cuối cảnh trước chỉ nằm ở disk local (không sync R2 như ảnh ref) → sau deploy/dọn
    // disk có thể mất dù DB vẫn giữ lastFramePath. Extract lại từ video (local hoặc R2); không
    // được thì bỏ chain và fallback về ảnh storyboard thay vì fail cả cảnh.
    let plannedStartRelPath = plan.startRelPath;
    let chained = plan.chained;
    if (chained && plannedStartRelPath) {
      const prevScene = project.script.scenes.find((s) => s.order === scene.order - 1);
      const ok = await ensureLastFrame(
        resolveWithinProject(projectId, plannedStartRelPath),
        prevScene?.videoPath ? resolveWithinProject(projectId, prevScene.videoPath) : null,
        prevScene?.videoUrl ?? null
      );
      if (!ok) {
        chained = false;
        const storyboardImage = project.storyboard.images.find((img) => img.sceneId === scene.id);
        plannedStartRelPath =
          storyboardImage?.status === 'done' && storyboardImage.imagePath
            ? storyboardImage.imagePath
            : null;
      }
    }

    const startImage = plannedStartRelPath ? await toAbs(plannedStartRelPath) : undefined;
    const refImages: { path: string }[] = [];
    // Mất chain mà cũng không có storyboard → không còn khung khởi điểm, quay về r2v ref images.
    const refRelPaths =
      plan.startRelPath && !plannedStartRelPath ? project.videoRefImagePaths.slice(0, MAX_REF_IMAGES) : plan.refRelPaths;
    for (const relPath of refRelPaths) {
      refImages.push(await toAbs(relPath));
    }

    const flowProjectId = await ensureProjectFlowId(projectId);

    const { job_id, flowProjectId: usedFlowProjectId } = await generateSceneVideo(
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
        flowProjectTitle: project.name,
        refImages,
        startImage,
      }
    );

    await updateProject(projectId, (p) => {
      const s = p.script.scenes.find((x) => x.id === sceneId);
      if (!s) return;
      // Chỉ đánh dấu chained khi khung khởi điểm THỰC SỰ là frame cảnh trước — startImage
      // cũng có thể là ảnh storyboard của chính cảnh này (không phải chain).
      applyGeneratingState(s, job_id, chained);
      // Project cũ bị Google 404 (entity not found) → đã tự tạo project mới, lưu lại luôn.
      if (usedFlowProjectId !== flowProjectId) p.flowProjectId = usedFlowProjectId;
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
