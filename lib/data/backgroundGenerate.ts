import path from 'node:path';
import fs from 'node:fs/promises';
import { readProject, updateProject, ensureProjectFlowId } from './projectStore';
import { applyDoneState, STOP_ERROR_MESSAGE } from './storyboardGenerate';
import { projectBackgroundsDir } from '../paths';
import { generateStoryboardImage } from '../googleFlow/flowJobs';
import { FlowApiError } from '../googleFlow/errors';
import { uploadFileToR2 } from '../r2/client';
import type { TriggerStoryboardResult } from './storyboardGenerate';

/**
 * Trigger gen 1 ảnh background: giống triggerStoryboardGeneration nhưng KHÔNG gửi ảnh sản
 * phẩm làm ảnh tham chiếu (ảnh background phải hoàn toàn không có sản phẩm), lưu file vào
 * outputs/backgrounds/<sceneId>.png. Chỉ dùng để xem/tải ở Bước 3 — không tự động gộp vào
 * ref_paths khi gen video Bước 4.
 */
export async function triggerBackgroundGeneration(
  projectId: string,
  sceneId: string
): Promise<TriggerStoryboardResult> {
  const project = await readProject(projectId);
  const image = project.storyboard.backgrounds.find((img) => img.sceneId === sceneId);
  if (!image) {
    return { sceneId, ok: false, error: 'Scene background không tồn tại' };
  }
  if (image.status === 'generating') {
    return { sceneId, ok: false, error: 'Ảnh đang generating' };
  }
  if (!image.prompt.trim()) {
    return { sceneId, ok: false, error: 'Chưa nhập prompt cho ảnh background này' };
  }

  await updateProject(projectId, (p) => {
    const img = p.storyboard.backgrounds.find((x) => x.sceneId === sceneId);
    if (!img) return;
    img.status = 'generating';
    img.error = null;
    img.lastUpdatedAt = new Date().toISOString();
  });

  try {
    const flowProjectId = await ensureProjectFlowId(projectId);
    const result = await generateStoryboardImage({
      prompt: image.prompt,
      model: project.storyboard.backgroundModel,
      projectId: flowProjectId,
      projectTitle: project.name,
      // Cùng lý do với storyboardGenerate.ts: ảnh background luôn khung ngang 16:9,
      // không phụ thuộc aspectRatio video của project.
      aspect: '16:9',
    });
    const generatedPath = result.paths[0];
    if (!generatedPath) {
      throw new FlowApiError('flow_generate_image không trả về ảnh nào');
    }

    const backgroundsDir = projectBackgroundsDir(projectId);
    await fs.mkdir(backgroundsDir, { recursive: true });
    const fileName = `${sceneId}.png`;
    const destAbsPath = path.join(backgroundsDir, fileName);
    await fs.copyFile(generatedPath, destAbsPath);
    const relativeImagePath = path.join('outputs', 'backgrounds', fileName);
    // Upload thêm lên R2 để bền/không phụ thuộc route local — vẫn giữ file local (xem/tải Bước 3).
    const imageUrl = await uploadFileToR2(
      destAbsPath,
      `projects/${projectId}/backgrounds/${fileName}`,
      'image/png'
    );

    await updateProject(projectId, (p) => {
      const img = p.storyboard.backgrounds.find((x) => x.sceneId === sceneId);
      if (!img || img.status !== 'generating') return;
      applyDoneState(img, relativeImagePath, imageUrl);
      // Project cũ bị Google 404 (entity not found) → đã tự tạo project mới, lưu lại luôn.
      if (result.flowProjectId !== flowProjectId) p.flowProjectId = result.flowProjectId;
    });

    return { sceneId, ok: true, imagePath: relativeImagePath };
  } catch (err) {
    const message = err instanceof FlowApiError ? err.message : (err as Error).message;
    await updateProject(projectId, (p) => {
      const img = p.storyboard.backgrounds.find((x) => x.sceneId === sceneId);
      if (!img || img.status !== 'generating') return;
      img.status = 'failed';
      img.error = message;
      img.attempts += 1;
      img.lastUpdatedAt = new Date().toISOString();
    });
    return { sceneId, ok: false, error: message };
  }
}

/** Dừng theo dõi 1 ảnh background đang generating — xem stopStoryboardGeneration (cùng cơ chế). */
export async function stopBackgroundGeneration(
  projectId: string,
  sceneId: string
): Promise<TriggerStoryboardResult> {
  const project = await readProject(projectId);
  const image = project.storyboard.backgrounds.find((img) => img.sceneId === sceneId);
  if (!image) {
    return { sceneId, ok: false, error: 'Scene background không tồn tại' };
  }
  if (image.status !== 'generating') {
    return { sceneId, ok: false, error: 'Ảnh không đang generating' };
  }

  await updateProject(projectId, (p) => {
    const img = p.storyboard.backgrounds.find((x) => x.sceneId === sceneId);
    if (!img || img.status !== 'generating') return;
    img.status = 'failed';
    img.error = STOP_ERROR_MESSAGE;
    img.attempts += 1;
    img.lastUpdatedAt = new Date().toISOString();
  });

  return { sceneId, ok: true };
}

/** Dừng theo dõi mọi ảnh background đang generating của project (xem stopBackgroundGeneration). */
export async function stopAllBackgroundGeneration(projectId: string): Promise<string[]> {
  const stopped: string[] = [];
  await updateProject(projectId, (p) => {
    for (const img of p.storyboard.backgrounds) {
      if (img.status !== 'generating') continue;
      img.status = 'failed';
      img.error = STOP_ERROR_MESSAGE;
      img.attempts += 1;
      img.lastUpdatedAt = new Date().toISOString();
      stopped.push(img.sceneId);
    }
  });
  return stopped;
}
