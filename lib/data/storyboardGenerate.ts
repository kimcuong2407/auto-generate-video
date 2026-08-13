import path from 'node:path';
import fs from 'node:fs/promises';
import { readProject, updateProject } from './projectStore';
import { projectInputsDir, projectStoryboardDir } from '../paths';
import { generateStoryboardImage } from '../mcp/flowJobs';
import { McpToolError } from '../mcp/orinoFlowClient';
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
    const referenceImagePaths: string[] = [];
    if (project.storyboard.useProductReference) {
      referenceImagePaths.push(
        ...project.inputs.productImages.map((p) => path.join(projectInputsDir(projectId), path.basename(p)))
      );
    }
    if (project.storyboard.useSpokespersonReference && project.inputs.spokespersonImagePath) {
      referenceImagePaths.push(
        path.join(projectInputsDir(projectId), path.basename(project.inputs.spokespersonImagePath))
      );
    }

    const result = await generateStoryboardImage({
      prompt: image.prompt,
      model: project.storyboard.model,
      refPaths: referenceImagePaths,
      // Storyboard luôn là ảnh lưới 4x2 (xem SYSTEM_PROMPT trong storyboardPromptGenerate.ts)
      // — cần khung ngang để bố cục lưới hợp lý, không phụ thuộc aspectRatio video của project
      // (thường là 9:16 dọc, ép lưới ngang vào đó khiến model bỏ qua chỉ dẫn grid).
      aspect: '16:9',
    });
    const generatedPath = result.paths[0];
    if (!generatedPath) {
      throw new McpToolError('flow_generate_image không trả về ảnh nào');
    }

    const storyboardDir = projectStoryboardDir(projectId);
    await fs.mkdir(storyboardDir, { recursive: true });
    const fileName = `${sceneId}.png`;
    await fs.copyFile(generatedPath, path.join(storyboardDir, fileName));
    const relativeImagePath = path.join('outputs', 'storyboard', fileName);

    await updateProject(projectId, (p) => {
      const img = p.storyboard.images.find((x) => x.sceneId === sceneId);
      // Guard: nếu người dùng đã bấm Dừng trong lúc chờ flow_generate_image (status
      // không còn 'generating'), không ghi đè trạng thái đã dừng bằng kết quả trễ.
      if (!img || img.status !== 'generating') return;
      applyDoneState(img, relativeImagePath);
    });

    return { sceneId, ok: true, imagePath: relativeImagePath };
  } catch (err) {
    const message = err instanceof McpToolError ? err.message : (err as Error).message;
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

export function applyDoneState(image: StoryboardImage, relativeImagePath: string): void {
  image.status = 'done';
  image.imagePath = relativeImagePath;
  image.error = null;
  image.attempts += 1;
  image.lastUpdatedAt = new Date().toISOString();
}
