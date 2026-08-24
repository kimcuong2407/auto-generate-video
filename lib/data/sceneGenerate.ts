import { readProject, updateProject, ensureProjectFlowId } from './projectStore';
import { resolveWithinProject } from '../paths';
import { ensureLocalFile } from '../r2/client';
import { generateSceneVideo } from '../googleFlow/flowJobs';
import { FlowApiError } from '../googleFlow/errors';
import type { Project, Scene } from '../types';

export interface TriggerResult {
  sceneId: string;
  ok: boolean;
  jobId?: string;
  error?: string;
}

/** Tối đa 3 ảnh reference/lần gen — giới hạn cứng của Google Flow r2v (vượt → INVALID_ARGUMENT). */
const MAX_REF_IMAGES = 3;

/** Tra R2 URL của 1 relPath đã chọn làm ref (sản phẩm/người mẫu/background) để ensureLocalFile khôi phục khi mất local. */
function findRefImageUrl(project: Project, relPath: string): string | null {
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
    // Ảnh storyboard của chính scene này (Bước 3, nếu đã gen xong) làm tham chiếu ƯU TIÊN
    // #1 khi gen video — ảnh này đã kết tinh sẵn sản phẩm + nhân vật + bối cảnh. Ảnh người
    // dùng chọn thêm ở Bước 4 (sản phẩm/người mẫu/background) lấp đầy các chỗ còn lại, tối
    // đa 3 ảnh/lần gen (giới hạn Google Flow r2v).
    const storyboardImage = project.storyboard.images.find((img) => img.sceneId === sceneId);
    const storyboardRelPath =
      storyboardImage?.status === 'done' && storyboardImage.imagePath ? storyboardImage.imagePath : null;

    const prevScene = project.script.scenes.find((s) => s.order === scene.order - 1);
    const hasPrevFrame =
      project.sceneChaining && scene.order > 1 && prevScene?.status === 'done' && !!prevScene.lastFramePath;

    // Chừa 1 chỗ cho frame chain (nếu có) vì nó sẽ được gộp vào refImages bên dưới, không
    // dùng startImage riêng — xem giải thích ngay dưới.
    const refCandidates = [...(storyboardRelPath ? [storyboardRelPath] : []), ...project.videoRefImagePaths].slice(
      0,
      hasPrevFrame ? MAX_REF_IMAGES - 1 : MAX_REF_IMAGES
    );

    const refImages: { path: string }[] = [];
    for (const relPath of refCandidates) {
      const absPath = resolveWithinProject(projectId, relPath);
      // Khôi phục local từ R2 nếu mất (project chạy/gen ở máy khác với máy tạo project).
      await ensureLocalFile(absPath, findRefImageUrl(project, relPath));
      refImages.push({ path: absPath });
    }

    // Chain khung hình cuối cảnh trước → khung hình đầu cảnh này, tạo continuity thị giác.
    // generateVideo() (googleFlow/videoGen.ts) chọn endpoint referenceImages bất cứ khi nào
    // refImages không rỗng và ÂM THẦM BỎ QUA startImage riêng trong trường hợp đó — nên khi
    // đã có ref, phải gộp thẳng frame chain vào refImages thay vì set startImage độc lập.
    let startImage: { path: string } | undefined;
    if (hasPrevFrame) {
      const absFrame = resolveWithinProject(projectId, prevScene!.lastFramePath!);
      if (refImages.length > 0) refImages.push({ path: absFrame });
      else startImage = { path: absFrame };
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
      applyGeneratingState(s, job_id, !!startImage);
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
