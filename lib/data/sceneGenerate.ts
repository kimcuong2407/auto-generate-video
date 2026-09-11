import { readProject, updateProject, ensureProjectFlowId } from './projectStore';
import { resolveWithinProject } from '../paths';
import { ensureLocalFile } from '../r2/client';
import { generateSceneVideo } from '../googleFlow/flowJobs';
import { ensureLastFrame } from '../ffmpeg/ensureFrame';
import { FlowApiError, isQuotaError } from '../googleFlow/errors';
import { planVideoInputs, MAX_REF_IMAGES } from './videoInputs';
import type { Project, Scene } from '../types';

export interface TriggerResult {
  sceneId: string;
  ok: boolean;
  jobId?: string;
  error?: string;
  /** true = thất bại vì HẾT QUOTA Veo phía Google, không phải lỗi tạm thời (xem isQuotaError). */
  quotaExceeded?: boolean;
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

    // Map ngược abs → rel để lưu cache mediaId sau khi gen (uploadedMediaIds keyed theo abs path).
    const relPathByAbsPath = new Map<string, string>();

    /**
     * Resolve relPath → abs, khôi phục file local từ R2 nếu thiếu (gen ở máy khác máy tạo
     * project), kèm mediaId đã cache để Flow khỏi upload lại cùng một ảnh ở mọi cảnh.
     */
    const toAbs = async (relPath: string) => {
      const absPath = resolveWithinProject(projectId, relPath);
      await ensureLocalFile(absPath, findRefImageUrl(project, relPath));
      relPathByAbsPath.set(absPath, relPath);
      return { path: absPath, mediaId: project.flowMediaIds?.[relPath] };
    };

    // Frame cuối cảnh trước chỉ nằm ở disk local (không sync R2 như ảnh ref) → sau deploy/dọn
    // disk có thể mất dù DB vẫn giữ lastFramePath. Extract lại từ video (local hoặc R2); không
    // được thì bỏ chain và fallback về ảnh storyboard thay vì fail cả cảnh.
    //
    // Frame giờ có thể nằm ở startRelPath HOẶC đứng đầu refRelPaths (xem planVideoInputs), nên
    // phải hỏi plan.chainFrameRelPath chứ không suy từ startRelPath.
    let startRelPath = plan.startRelPath;
    let refRelPaths = plan.refRelPaths;
    let chained = plan.chained;

    if (plan.chainFrameRelPath) {
      const prevScene = project.script.scenes.find((s) => s.order === scene.order - 1);
      const ok = await ensureLastFrame(
        resolveWithinProject(projectId, plan.chainFrameRelPath),
        prevScene?.videoPath ? resolveWithinProject(projectId, prevScene.videoPath) : null,
        prevScene?.videoUrl ?? null
      );
      if (!ok) {
        // Mất frame → bỏ nó khỏi mọi vị trí, rồi dựng lại đầu vào như thể chưa từng chain.
        chained = false;
        const withoutFrame = refRelPaths.filter((rel) => rel !== plan.chainFrameRelPath);
        const storyboardImage = project.storyboard.images.find((img) => img.sceneId === scene.id);
        const storyboardRelPath =
          storyboardImage?.status === 'done' && storyboardImage.imagePath
            ? storyboardImage.imagePath
            : null;
        if (withoutFrame.length > 0) {
          // Còn ảnh ref người dùng chọn → giữ r2v, chỉ mất tính liền mạch.
          startRelPath = null;
          refRelPaths = withoutFrame.slice(0, MAX_REF_IMAGES);
        } else if (storyboardRelPath) {
          startRelPath = storyboardRelPath;
          refRelPaths = [];
        } else {
          startRelPath = null;
          refRelPaths = project.videoRefImagePaths.slice(0, MAX_REF_IMAGES);
        }
      }
    }

    const startImage = startRelPath ? await toAbs(startRelPath) : undefined;
    const refImages: { path: string; mediaId?: string }[] = [];
    for (const relPath of refRelPaths) {
      refImages.push(await toAbs(relPath));
    }

    const flowProjectId = await ensureProjectFlowId(projectId);

    const { job_id, flowProjectId: usedFlowProjectId, uploadedMediaIds } = await generateSceneVideo(
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
      if (usedFlowProjectId !== flowProjectId) {
        p.flowProjectId = usedFlowProjectId;
        // mediaId gắn với Flow project cũ → vô giá trị trên project mới. Không xoá thì cảnh sau
        // gửi mediaId lạ và Flow từ chối, mà triệu chứng lại giống hệt "ảnh ref không tác dụng".
        p.flowMediaIds = {};
      }
      if (!p.flowMediaIds) p.flowMediaIds = {};
      for (const [absPath, mediaId] of Object.entries(uploadedMediaIds)) {
        const relPath = relPathByAbsPath.get(absPath);
        if (relPath) p.flowMediaIds[relPath] = mediaId;
      }
    });

    return { sceneId, ok: true, jobId: job_id };
  } catch (err) {
    const message = err instanceof FlowApiError ? err.message : (err as Error).message;
    const quota = isQuotaError(err);
    // Log ĐẦY ĐỦ lý do fail — cùng bài học đã trả giá ở livestream: chuỗi sự cố không để lại
    // dấu vết nào thì phải suy đoán nguyên nhân từ trạng thái tĩnh trong DB. Kèm code lỗi +
    // attempts để phân biệt lỗi tạm thời (401/timeout) với lỗi vĩnh viễn (404 model key).
    console.error(
      `[flow gen] project=${projectId} scene=${scene.order} → THẤT BẠI` +
        `${err instanceof FlowApiError && err.code ? ` HTTP ${err.code}` : ''}` +
        `${quota ? ' (HẾT QUOTA)' : ''} attempts=${scene.attempts} — ${message.slice(0, 300)}`
    );
    await updateProject(projectId, (p) => {
      const s = p.script.scenes.find((x) => x.id === sceneId);
      if (!s) return;
      s.status = 'failed';
      s.error = message;
      // Hết quota KHÔNG phải lỗi của cảnh này — tính attempts ở đây thì sau 3 lần gặp quota là
      // cảnh hết cửa auto-retry vĩnh viễn dù quota đã reset. Backoff thời gian trong
      // shouldAutoTrigger là thứ chặn vòng lặp cho trường hợp này.
      //
      // Lỗi xảy ra TRƯỚC applyGeneratingState nên attempts chưa được tăng ở lượt này; cộng 1
      // tại đây để lần thử hỏng vẫn được đếm (không cộng thì lỗi luôn ở ngay bước dựng input
      // sẽ retry vô hạn vì attempts đứng yên mãi ở 0).
      if (!quota) s.attempts += 1;
      s.lastUpdatedAt = new Date().toISOString();
    });
    return { sceneId, ok: false, error: message, quotaExceeded: quota };
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
