/**
 * Luật chọn ảnh đầu vào khi gen video 1 scene — hàm THUẦN, không I/O.
 *
 * Vì sao tách khỏi sceneGenerate.ts: UI (components/steps/ProjectGuide.tsx) cần nói đúng ảnh
 * nào thật sự được gửi, mà sceneGenerate.ts kéo theo projectStore/ffmpeg/r2 (node:fs, mysql2)
 * — import từ client component là Next bundle cả cây server-side vào browser và vỡ build ở
 * fsevents. Chép lại luật sang UI thì sớm muộn 2 bên nói khác nhau, nên tách dùng chung.
 */
import type { Project, Scene } from '../types';

/** Tối đa 3 ảnh reference/lần gen — giới hạn cứng của Google Flow r2v (vượt → INVALID_ARGUMENT). */
export const MAX_REF_IMAGES = 3;

export interface VideoInputPlan {
  /** relPath khung hình khởi điểm (endpoint i2v) — null nghĩa là rơi về r2v với refPaths. */
  startRelPath: string | null;
  /** relPath các ảnh reference (endpoint r2v) — chỉ dùng khi không có startRelPath. */
  refRelPaths: string[];
  /** startRelPath có thực sự là frame cảnh trước hay không (quyết định cờ chainedFromPrevious). */
  chained: boolean;
}

/**
 * Quyết định ảnh đầu vào cho 1 lần gen video (thuần, không I/O — xem test ở cuối file).
 *
 * Khung hình khởi điểm (startImage → endpoint i2v) là tín hiệu MẠNH NHẤT với Veo: model bắt
 * đầu vẽ từ đúng frame đó nên sản phẩm/bối cảnh khớp tuyệt đối. Còn refImages (r2v) chỉ là
 * "asset gợi ý", model tự diễn giải lại hình dáng → dễ lệch so với sản phẩm thật. Vì vậy luôn
 * ưu tiên chọn được 1 startImage:
 *   - Cảnh 2 trở đi có chain: frame cuối cảnh trước → vừa khớp sản phẩm, vừa liền mạch.
 *   - Còn lại: ảnh storyboard key frame của chính cảnh (Bước 3) — đã đúng tỉ lệ khung hình và
 *     là ảnh 1 khung liền lạc (xem storyboardPromptGenerate.ts).
 *
 * generateVideo() ưu tiên endpoint referenceImages bất cứ khi nào refImages không rỗng và ÂM
 * THẦM BỎ QUA startImage — nên khi đã có startRelPath, refRelPaths PHẢI rỗng.
 */
export function planVideoInputs(project: Project, scene: Scene): VideoInputPlan {
  const storyboardImage = project.storyboard.images.find((img) => img.sceneId === scene.id);
  const storyboardRelPath =
    storyboardImage?.status === 'done' && storyboardImage.imagePath ? storyboardImage.imagePath : null;

  const prevScene = project.script.scenes.find((s) => s.order === scene.order - 1);
  const chained =
    project.sceneChaining && scene.order > 1 && prevScene?.status === 'done' && !!prevScene.lastFramePath;

  const startRelPath = chained ? prevScene!.lastFramePath! : storyboardRelPath;

  return {
    startRelPath,
    // Không có khung khởi điểm nào → mới dùng r2v với các ảnh người dùng chọn ở Bước 4.
    refRelPaths: startRelPath ? [] : project.videoRefImagePaths.slice(0, MAX_REF_IMAGES),
    chained,
  };
}
