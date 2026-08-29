import path from 'node:path';
import fs from 'node:fs/promises';
import { readJob, updateJob, ensureJobFlowId } from './jobStore';
import { jobInputsDir, resolveWithinJob } from './paths';
import { ensureLocalImage, uploadImageToR2 } from './imageR2';
import { BACKGROUND_SYSTEM_PROMPT } from './promptDefaults';
import { pickBackgroundRefEntries } from './refImages';
import type { VisionRefEntry } from './refImages';
import type { LivestreamJob, LivestreamStageBible } from './types';
import { ensureStageBible } from './stageBible';
import { generateStoryboardImage } from '../googleFlow/flowJobs';
import { FlowApiError } from '../googleFlow/errors';

/**
 * Prompt gen background thực dùng cho 1 job: bản người dùng đã chỉnh và LƯU (backgroundPromptOverride)
 * nếu có, ngược lại BACKGROUND_SYSTEM_PROMPT mặc định. Là nguồn duy nhất cho cả route gen lẫn route
 * preview — 2 chỗ lệch nhau thì bản xem trước thành vô nghĩa.
 */
export function resolveBackgroundPrompt(
  job: Pick<LivestreamJob, 'backgroundPromptOverride'>
): string {
  const override = job.backgroundPromptOverride;
  return override && override.trim() ? override : BACKGROUND_SYSTEM_PROMPT;
}

export interface BackgroundGenResult {
  ok: boolean;
  imagePath?: string;
  error?: string;
}

/**
 * Ghép prompt gen ảnh nền từ 4 mảnh (prompt gốc + mô tả sản phẩm + sân khấu đã chốt + chú giải ảnh
 * ref). Tách khỏi triggerBackgroundImageGeneration để route preview
 * (app/api/livestream/[id]/preview-prompt) hiện ĐÚNG chuỗi server thật sự gửi đi — trước đây UI chỉ
 * thấy mỗi basePrompt nên Mr.D không biết 3 mảnh còn lại được ghép vào những gì.
 *
 * Hàm thuần: không đọc job từ disk, không gọi AI — caller tự truyền bible (có thể null nếu chưa chốt).
 */
export function buildBackgroundPrompt(
  basePrompt: string,
  productText: string,
  bible: LivestreamStageBible | null,
  entries: VisionRefEntry[]
): string {
  const bibleBlock = bible
    ? `\n\nBẮT BUỘC — khung hình PHẢI khớp đúng sân khấu livestream cố định này (copy y nguyên các mô tả dưới đây, KHÔNG bịa ra người dẫn hay căn phòng khác):\nNgười dẫn: ${bible.host}\nBối cảnh: ${bible.scene}\nMáy quay: ${bible.camera}`
    : '';
  // Đánh số vai trò từng ảnh vào prompt: model nhận một chồng ảnh VÔ DANH thì không biết ảnh nào là
  // người cần copy khuôn mặt, ảnh nào là món hàng — kết quả ra người lạ dù ảnh mẫu đã được gửi.
  const refLegendBlock =
    entries.length > 0
      ? `\n\nẢNH REFERENCE ĐÍNH KÈM (theo đúng thứ tự):\n${entries
          .map((e, i) => `  ${i + 1}. ${e.label}`)
          .join('\n')}\nẢnh reference là NGUỒN SỰ THẬT, ưu tiên hơn MỌI mô tả bằng chữ ở trên. Khuôn mặt, giới tính, kiểu tóc, vóc dáng và trang phục của người dẫn PHẢI copy đúng ảnh NGƯỜI MẪU — nếu mô tả bằng chữ khác ảnh thì theo ẢNH. Sản phẩm trên bàn PHẢI đúng món trong ảnh SẢN PHẨM THẬT, không thay bằng món khác.`
      : '';
  return `${basePrompt}\n${productText}${bibleBlock}${refLegendBlock}`;
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

  // promptOverride = bản nháp đang sửa trên UI (chưa lưu); không có thì dùng bản đã lưu của job.
  const basePrompt = promptOverride?.trim() || resolveBackgroundPrompt(job);
  // Nếu job đã chốt sân khấu cố định (stageBible, sinh lúc gen script), ép ảnh nền dựng đúng người
  // dẫn/bối cảnh/góc máy đó — nếu không ảnh nền và veoPrompt sẽ mô tả 2 buổi live khác nhau, ảnh nền
  // dùng làm reference lại kéo video lệch khỏi mô tả trong script.
  //
  // BẮT BUỘC qua ensureStageBible chứ KHÔNG đọc thẳng job.stageBible: bible cũ có thể đã stale
  // (chốt khi chưa có ảnh mẫu, hoặc ảnh mẫu đã đổi). Bible stale mô tả sai người dẫn — mà bibleBlock
  // dưới đây lại ép "copy y nguyên, KHÔNG bịa người dẫn khác", nên mô tả sai đó THẮNG cả ảnh mẫu
  // đính kèm. Đúng ca của Mr.D: ảnh mẫu là nam đầu cua đeo kính, bible cũ tả "athletic woman... high
  // ponytail" → ảnh nền gen ra là nữ. ensureStageBible tự phát hiện stale và chốt lại từ chính ảnh.
  const bible = await ensureStageBible(jobId);

  // Reference: ảnh mẫu ĐỨNG ĐẦU (cùng lý do pickRefImagePaths — nhân vật là thứ model bịa sai nặng
  // nhất), rồi ảnh sản phẩm, rồi ảnh nền. Trước đây ảnh mẫu bị push CUỐI sau N ảnh sản phẩm nên
  // model gần như bỏ qua nó, dù người dùng đã chọn ảnh mẫu.
  // Ưu tiên đúng bộ ảnh người dùng đã tick chọn cho bước này; rỗng thì server tự chọn như cũ.
  const entries = pickBackgroundRefEntries(job);
  const prompt = buildBackgroundPrompt(
    basePrompt,
    product.description || product.name,
    bible,
    entries
  );

  // Tải lại từ R2 về local nếu file local mất (server mới sau deploy) — Google Flow đọc file local.
  // mediaId dùng cache job.flowMediaIds nếu có để tránh upload lại lên Flow.
  const refRelPaths: string[] = entries.map((e) => e.rel);
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
      model: job.backgroundModel,
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
