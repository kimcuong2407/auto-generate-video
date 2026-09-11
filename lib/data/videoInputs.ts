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
  /** Khung khởi điểm THỰC SỰ là frame cảnh trước hay không (quyết định cờ chainedFromPrevious). */
  chained: boolean;
  /**
   * relPath frame cảnh trước, khi và chỉ khi lần gen này dùng nó (dù ở startRelPath hay đứng
   * đầu refRelPaths). Caller cần biết để gọi ensureLastFrame đúng file — không suy ra được từ
   * startRelPath nữa vì frame có thể nằm trong refRelPaths.
   */
  chainFrameRelPath: string | null;
}

/**
 * Quyết định ảnh đầu vào cho 1 lần gen video (thuần, không I/O).
 *
 * Khung hình khởi điểm (startImage → endpoint i2v) là tín hiệu MẠNH NHẤT với Veo: model bắt
 * đầu vẽ từ đúng frame đó nên sản phẩm/bối cảnh khớp tuyệt đối. Còn refImages (r2v) chỉ là
 * "asset gợi ý", model tự diễn giải lại hình dáng → dễ lệch so với sản phẩm thật.
 *
 * ĐỔI 2026-09-11 — port luật của livestream (lib/livestream/segmentGenerate.ts:182-201):
 * trước đây hễ có startRelPath là refRelPaths bị ép rỗng, nên bật chaining đồng nghĩa VỨT BỎ
 * toàn bộ ảnh tham chiếu người dùng đã chọn ở Bước 4 — từ cảnh 2 trở đi Veo không còn thấy ảnh
 * sản phẩm/người mẫu nào, chỉ có frame cảnh trước. Sai lệch tích luỹ dần qua từng cảnh.
 *
 * Luật mới, giống livestream:
 *   - Có frame chain + có ref  → frame ĐI VÀO refImages (r2v), chừa 1 suất trong trần 3 ảnh.
 *     Veo thấy cả frame liền mạch LẪN ảnh sản phẩm thật.
 *   - Có frame chain, không ref → frame làm startImage (i2v thuần) như cũ.
 *   - Không chain → ảnh storyboard làm startImage; chỉ khi cũng không có storyboard mới rơi
 *     về r2v với ảnh Bước 4.
 *
 * generateVideo() ưu tiên endpoint referenceImages bất cứ khi nào refImages không rỗng và ÂM
 * THẦM BỎ QUA startImage — nên hai trường không bao giờ cùng có giá trị.
 */
export function planVideoInputs(project: Project, scene: Scene): VideoInputPlan {
  const storyboardImage = project.storyboard.images.find((img) => img.sceneId === scene.id);
  const storyboardRelPath =
    storyboardImage?.status === 'done' && storyboardImage.imagePath ? storyboardImage.imagePath : null;

  const prevScene = project.script.scenes.find((s) => s.order === scene.order - 1);
  const chained =
    project.sceneChaining && scene.order > 1 && prevScene?.status === 'done' && !!prevScene.lastFramePath;

  const chainFrameRelPath = chained ? prevScene!.lastFramePath! : null;
  // Chừa 1 suất cho frame chain — trần 3 ảnh là giới hạn cứng của Veo, vượt thì INVALID_ARGUMENT.
  const refLimit = chainFrameRelPath ? MAX_REF_IMAGES - 1 : MAX_REF_IMAGES;
  const userRefs = project.videoRefImagePaths.slice(0, refLimit);

  if (chainFrameRelPath && userRefs.length > 0) {
    // Frame đứng ĐẦU: Veo đọc refImages theo thứ tự, ảnh đầu có trọng số dẫn dắt lớn nhất —
    // muốn cảnh này nối liền mạch cảnh trước thì frame phải ở vị trí đó.
    return {
      startRelPath: null,
      refRelPaths: [chainFrameRelPath, ...userRefs],
      chained: true,
      chainFrameRelPath,
    };
  }
  if (chainFrameRelPath) {
    return { startRelPath: chainFrameRelPath, refRelPaths: [], chained: true, chainFrameRelPath };
  }
  if (storyboardRelPath) {
    return { startRelPath: storyboardRelPath, refRelPaths: [], chained: false, chainFrameRelPath: null };
  }
  // Không khung khởi điểm nào → r2v với ảnh người dùng chọn ở Bước 4.
  return { startRelPath: null, refRelPaths: userRefs, chained: false, chainFrameRelPath: null };
}
