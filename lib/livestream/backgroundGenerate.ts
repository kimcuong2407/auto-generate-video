import path from 'node:path';
import fs from 'node:fs/promises';
import { readJob, updateJob, ensureJobFlowId } from './jobStore';
import { jobInputsDir, resolveWithinJob } from './paths';
import { ensureLocalImage, uploadImageToR2 } from './imageR2';
import { BACKGROUND_SYSTEM_PROMPT } from './promptDefaults';
import { generateStoryboardImage } from '../googleFlow/flowJobs';
import { FlowApiError } from '../googleFlow/errors';

export interface BackgroundGenResult {
  ok: boolean;
  imagePath?: string;
  error?: string;
}

/**
 * Gen 1 ảnh background livestream bằng AI: dựa vào ảnh sản phẩm đã chọn + ảnh mẫu (nếu có) làm
 * reference, tạo ra 1 KHUNG HÌNH hoàn chỉnh (mẫu đang dùng sản phẩm trong bối cảnh). Ảnh được lưu
 * vào kho backgroundImagePaths của sản phẩm — KHÔNG tự chọn làm ref (người dùng tự bấm chọn nếu muốn).
 * Gen ảnh đồng bộ (blocking) như generateStoryboardImage nên không cần state 'generating' phức tạp.
 */
export async function triggerBackgroundImageGeneration(
  jobId: string,
  productId: string,
  promptOverride?: string
): Promise<BackgroundGenResult> {
  const job = await readJob(jobId);
  const product = job.products.find((p) => p.id === productId);
  if (!product) {
    return { ok: false, error: 'Sản phẩm không tồn tại' };
  }

  const basePrompt = promptOverride?.trim() || BACKGROUND_SYSTEM_PROMPT;
  const prompt = `${basePrompt}\n${product.description || product.name}`;

  // Reference: ảnh sản phẩm đã chọn (1..N) + ảnh mẫu (nếu có) ở BỘ ẢNH CHUNG cấp job để AI tạo
  // cảnh có cả 2. Tải lại từ R2 về local nếu file local mất (server mới sau deploy) — Google Flow
  // đọc file local. mediaId dùng cache job.flowMediaIds nếu có để tránh upload lại lên Flow.
  const refRelPaths: string[] = [...(job.selectedRefImagePaths ?? [])];
  if (job.selectedModelImagePath) refRelPaths.push(job.selectedModelImagePath);
  for (const relPath of refRelPaths) {
    await ensureLocalImage(jobId, relPath, job.imageR2Urls?.[relPath]);
  }
  const relPathByAbsPath = new Map<string, string>();
  const refImages = refRelPaths.map((relPath) => {
    const absPath = resolveWithinJob(jobId, relPath);
    relPathByAbsPath.set(absPath, relPath);
    return { path: absPath, mediaId: job.flowMediaIds?.[relPath] };
  });

  try {
    const flowProjectId = await ensureJobFlowId(jobId);
    const result = await generateStoryboardImage({
      prompt,
      refImages: refImages.length > 0 ? refImages : undefined,
      projectId: flowProjectId,
      projectTitle: job.name,
      // Khung ảnh nền khớp tỷ lệ video livestream (khác project background luôn 16:9).
      aspect: job.aspectRatio,
    });
    const generatedPath = result.paths[0];
    if (!generatedPath) {
      throw new FlowApiError('flow_generate_image không trả về ảnh nào');
    }

    const fileName = `bg-ai-${Date.now()}.png`;
    await fs.copyFile(generatedPath, path.join(jobInputsDir(jobId), fileName));
    const relPath = path.join('inputs', fileName);

    // Đẩy ảnh background vừa gen lên R2 (best-effort) để bền vững qua deploy.
    const r2Url = await uploadImageToR2(jobId, relPath);

    await updateJob(jobId, (j) => {
      if (!Array.isArray(j.backgroundImagePaths)) j.backgroundImagePaths = [];
      j.backgroundImagePaths.push(relPath);
      // Project cũ bị Google 404 (entity not found) → đã tự tạo project mới, lưu lại luôn.
      if (result.flowProjectId !== flowProjectId) j.flowProjectId = result.flowProjectId;
      if (!j.imageR2Urls) j.imageR2Urls = {};
      j.imageR2Urls[relPath] = r2Url;
      if (!j.flowMediaIds) j.flowMediaIds = {};
      for (const [absPath, mediaId] of Object.entries(result.uploadedMediaIds)) {
        const rel = relPathByAbsPath.get(absPath);
        if (rel) j.flowMediaIds[rel] = mediaId;
      }
    });

    return { ok: true, imagePath: relPath };
  } catch (err) {
    const message = err instanceof FlowApiError ? err.message : (err as Error).message;
    return { ok: false, error: message };
  }
}
