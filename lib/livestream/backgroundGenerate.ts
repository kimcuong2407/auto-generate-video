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

  // Reference: ảnh sản phẩm đã chọn + ảnh mẫu (nếu có) ở BỘ ẢNH CHUNG cấp job để AI tạo cảnh có cả 2.
  // Tải lại từ R2 về local nếu file local mất (server mới sau deploy) — Google Flow đọc file local.
  const refPathList: string[] = [];
  if (job.selectedRefImagePath) {
    await ensureLocalImage(jobId, job.selectedRefImagePath, job.imageR2Urls?.[job.selectedRefImagePath]);
    refPathList.push(resolveWithinJob(jobId, job.selectedRefImagePath));
  }
  if (job.selectedModelImagePath) {
    await ensureLocalImage(jobId, job.selectedModelImagePath, job.imageR2Urls?.[job.selectedModelImagePath]);
    refPathList.push(resolveWithinJob(jobId, job.selectedModelImagePath));
  }
  const refPaths = refPathList.length > 0 ? refPathList : undefined;

  try {
    const result = await generateStoryboardImage({
      prompt,
      refPaths,
      projectId: await ensureJobFlowId(jobId),
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
      if (!j.imageR2Urls) j.imageR2Urls = {};
      j.imageR2Urls[relPath] = r2Url;
    });

    return { ok: true, imagePath: relPath };
  } catch (err) {
    const message = err instanceof FlowApiError ? err.message : (err as Error).message;
    return { ok: false, error: message };
  }
}
