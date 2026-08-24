import path from 'node:path';
import fs from 'node:fs/promises';
import { readProject, updateProject, ensureProjectFlowId } from './projectStore';
import { projectInputsDir, projectStoryboardDir } from '../paths';
import { generateStoryboardImage } from '../googleFlow/flowJobs';
import { FlowApiError } from '../googleFlow/errors';
import { uploadFileToR2, ensureLocalFile } from '../r2/client';
import type { StoryboardImage } from '../types';

export interface TriggerStoryboardResult {
  sceneId: string;
  ok: boolean;
  imagePath?: string;
  error?: string;
}

/**
 * Trigger gen 1 ảnh storyboard: validate trạng thái, gọi flow_generate_image qua
 * MCP Orino Flow (đồng bộ — chờ trực tiếp kết quả trong request, không cần job/poll
 * như gen video), copy file ảnh vào outputs/storyboard/<sceneId>.png rồi cập nhật
 * project.json.
 */
export async function triggerStoryboardGeneration(
  projectId: string,
  sceneId: string
): Promise<TriggerStoryboardResult> {
  const project = await readProject(projectId);
  const image = project.storyboard.images.find((img) => img.sceneId === sceneId);
  if (!image) {
    return { sceneId, ok: false, error: 'Scene storyboard không tồn tại' };
  }
  if (image.status === 'generating') {
    return { sceneId, ok: false, error: 'Ảnh đang generating' };
  }
  if (!image.prompt.trim()) {
    return { sceneId, ok: false, error: 'Chưa nhập prompt cho ảnh storyboard này' };
  }

  await updateProject(projectId, (p) => {
    const img = p.storyboard.images.find((x) => x.sceneId === sceneId);
    if (!img) return;
    img.status = 'generating';
    img.error = null;
    img.lastUpdatedAt = new Date().toISOString();
  });

  try {
    // { path, url }: url dùng để khôi phục local nếu file mất (project chạy/gen ở máy
    // khác với máy tạo project, share chung DB/R2) — xem ensureLocalFile.
    const referenceImages: { path: string; url: string | null }[] = [];
    if (project.storyboard.useProductReference) {
      // Chỉ gửi ĐÚNG 1 ảnh sản phẩm làm ref (ảnh đã chọn, hoặc ảnh đầu tiên nếu chưa chọn) —
      // không gửi cả danh sách, tránh Flow nhầm lẫn nhiều ảnh sản phẩm khác góc/khác biến thể.
      const chosen = project.storyboard.productReferenceImagePath || project.inputs.productImages[0];
      if (chosen) {
        const idx = project.inputs.productImages.indexOf(chosen);
        referenceImages.push({
          path: path.join(projectInputsDir(projectId), path.basename(chosen)),
          url: (idx >= 0 && project.inputs.productImageUrls?.[idx]) || null,
        });
      }
    }
    if (project.storyboard.useSpokespersonReference && project.inputs.spokespersonImagePath) {
      referenceImages.push({
        path: path.join(projectInputsDir(projectId), path.basename(project.inputs.spokespersonImagePath)),
        url: project.inputs.spokespersonImageUrl,
      });
    }
    await Promise.all(referenceImages.map((r) => ensureLocalFile(r.path, r.url)));

    const flowProjectId = await ensureProjectFlowId(projectId);
    const result = await generateStoryboardImage({
      prompt: image.prompt,
      model: project.storyboard.model,
      refImages: referenceImages.map((r) => ({ path: r.path })),
      projectId: flowProjectId,
      projectTitle: project.name,
      // Storyboard luôn là ảnh lưới 4x2 (xem SYSTEM_PROMPT trong storyboardPromptGenerate.ts)
      // — cần khung ngang để bố cục lưới hợp lý, không phụ thuộc aspectRatio video của project
      // (thường là 9:16 dọc, ép lưới ngang vào đó khiến model bỏ qua chỉ dẫn grid).
      aspect: '16:9',
    });
    const generatedPath = result.paths[0];
    if (!generatedPath) {
      throw new FlowApiError('flow_generate_image không trả về ảnh nào');
    }

    const storyboardDir = projectStoryboardDir(projectId);
    await fs.mkdir(storyboardDir, { recursive: true });
    const fileName = `${sceneId}.png`;
    const destAbsPath = path.join(storyboardDir, fileName);
    await fs.copyFile(generatedPath, destAbsPath);
    const relativeImagePath = path.join('outputs', 'storyboard', fileName);
    // Upload thêm lên R2 để bền/không phụ thuộc route local — vẫn giữ file local vì
    // sceneGenerate.ts đọc trực tiếp storyboardImage.imagePath làm ref khi gen video scene.
    const imageUrl = await uploadFileToR2(
      destAbsPath,
      `projects/${projectId}/storyboard/${fileName}`,
      'image/png'
    );

    await updateProject(projectId, (p) => {
      const img = p.storyboard.images.find((x) => x.sceneId === sceneId);
      // Guard: nếu người dùng đã bấm Dừng trong lúc chờ flow_generate_image (status
      // không còn 'generating'), không ghi đè trạng thái đã dừng bằng kết quả trễ.
      if (!img || img.status !== 'generating') return;
      applyDoneState(img, relativeImagePath, imageUrl);
      // Project cũ bị Google 404 (entity not found) → đã tự tạo project mới, lưu lại luôn.
      if (result.flowProjectId !== flowProjectId) p.flowProjectId = result.flowProjectId;
    });

    return { sceneId, ok: true, imagePath: relativeImagePath };
  } catch (err) {
    const message = err instanceof FlowApiError ? err.message : (err as Error).message;
    await updateProject(projectId, (p) => {
      const img = p.storyboard.images.find((x) => x.sceneId === sceneId);
      if (!img || img.status !== 'generating') return;
      img.status = 'failed';
      img.error = message;
      img.attempts += 1;
      img.lastUpdatedAt = new Date().toISOString();
    });
    return { sceneId, ok: false, error: message };
  }
}

export const STOP_ERROR_MESSAGE = 'Đã dừng theo yêu cầu người dùng';

/**
 * Dừng theo dõi 1 ảnh storyboard đang generating: KHÔNG hủy được lệnh gọi
 * flow_generate_image thật đang chạy ngầm (không có MCP tool hủy) — chỉ đánh dấu
 * "failed" ngay để người dùng có thể sửa prompt/Retry mà không cần chờ hết
 * STORYBOARD_IMAGE_TIMEOUT_MS. Guard trong triggerStoryboardGeneration đảm bảo kết
 * quả trễ của lệnh gọi gốc không ghi đè lại trạng thái đã dừng này.
 */
export async function stopStoryboardGeneration(
  projectId: string,
  sceneId: string
): Promise<TriggerStoryboardResult> {
  const project = await readProject(projectId);
  const image = project.storyboard.images.find((img) => img.sceneId === sceneId);
  if (!image) {
    return { sceneId, ok: false, error: 'Scene storyboard không tồn tại' };
  }
  if (image.status !== 'generating') {
    return { sceneId, ok: false, error: 'Ảnh không đang generating' };
  }

  await updateProject(projectId, (p) => {
    const img = p.storyboard.images.find((x) => x.sceneId === sceneId);
    if (!img || img.status !== 'generating') return;
    img.status = 'failed';
    img.error = STOP_ERROR_MESSAGE;
    img.attempts += 1;
    img.lastUpdatedAt = new Date().toISOString();
  });

  return { sceneId, ok: true };
}

/** Dừng theo dõi mọi ảnh storyboard đang generating của project (xem stopStoryboardGeneration). */
export async function stopAllStoryboardGeneration(projectId: string): Promise<string[]> {
  const stopped: string[] = [];
  await updateProject(projectId, (p) => {
    for (const img of p.storyboard.images) {
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

export function applyDoneState(
  image: StoryboardImage,
  relativeImagePath: string,
  imageUrl: string | null = null
): void {
  image.status = 'done';
  image.imagePath = relativeImagePath;
  image.imageUrl = imageUrl;
  image.error = null;
  image.attempts += 1;
  image.lastUpdatedAt = new Date().toISOString();
}
