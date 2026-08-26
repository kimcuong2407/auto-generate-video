/**
 * Chọn ảnh reference gửi kèm khi gen video — module THUẦN (không import node:fs/chatClient) để
 * client component (ProductPanel hiển thị "Chi tiết đoạn") dùng chung đúng 1 nguồn sự thật với
 * server. Trước đây UI tự ghép danh sách riêng và KHÔNG cắt 3, nên hiện đủ 4 ảnh trong khi Veo
 * thực tế chỉ nhận 3 — người dùng tưởng đã gửi ảnh mẫu mà thật ra nó bị cắt mất.
 */
import type { LivestreamJob, LivestreamProduct, LivestreamSegment } from './types';

/** Veo reference-to-video chỉ nhận TỐI ĐA 3 ảnh reference — vượt là Flow trả INVALID_ARGUMENT. */
const MAX_REF_IMAGES = 3;

/**
 * Chọn tối đa 3 ảnh reference gửi kèm khi gen video, theo thứ tự ƯU TIÊN:
 * ảnh mẫu (người dẫn) → ảnh sản phẩm → ảnh background.
 *
 * Ảnh mẫu đứng ĐẦU vì nhân vật là thứ Veo bịa sai nặng nhất: không có ảnh người thì nó vẽ người
 * hoàn toàn khác dù prompt tả kỹ đến đâu (mô tả bằng chữ không ghim được khuôn mặt). Sản phẩm thì
 * ngược lại — prompt tả màu/hình dạng cộng 1-2 ảnh là đủ nhận ra.
 *
 * Trước đây ảnh sản phẩm xếp trước rồi cắt `.slice(0, 3)`: job chọn đủ 3 ảnh sản phẩm là ảnh mẫu
 * bị cắt mất hoàn toàn, Veo không bao giờ nhìn thấy người dẫn → video ra người lạ.
 *
 * @param hasPrevFrame có frame cuối đoạn trước để chain hay không — nếu có, chừa 1 suất cho nó.
 */
export function pickRefImagePaths(
  job: Pick<
    LivestreamJob,
    'selectedRefImagePaths' | 'selectedModelImagePath' | 'selectedBackgroundImagePath'
  >,
  hasPrevFrame: boolean
): string[] {
  const limit = hasPrevFrame ? MAX_REF_IMAGES - 1 : MAX_REF_IMAGES;
  return [
    ...(job.selectedModelImagePath ? [job.selectedModelImagePath] : []),
    ...(job.selectedRefImagePaths ?? []),
    ...(job.selectedBackgroundImagePath ? [job.selectedBackgroundImagePath] : []),
  ].slice(0, limit);
}

/**
 * Tìm đoạn liền trước theo `order` tuyệt đối, dùng làm nguồn khung hình chain
 * (image-to-video). 'off' không chain, 'per_product' chỉ chain trong cùng sản phẩm,
 * 'continuous' chain xuyên suốt toàn bộ job kể cả giữa các sản phẩm khác nhau.
 */
export function findPreviousSegment(
  job: LivestreamJob,
  product: LivestreamProduct,
  segment: LivestreamSegment
): LivestreamSegment | null {
  if (job.chaining === 'off') return null;
  if (job.chaining === 'per_product') {
    return product.segments.find((s) => s.order === segment.order - 1) || null;
  }
  for (const p of job.products) {
    const found = p.segments.find((s) => s.order === segment.order - 1);
    if (found) return found;
  }
  return null;
}

/**
 * Tìm đoạn kế tiếp theo `order` tuyệt đối — dùng để auto-cascade trigger sau khi 1 đoạn
 * vừa done (xem app/api/livestream/[id]/status/route.ts). Đối xứng với findPreviousSegment.
 */
export function findNextSegment(
  job: LivestreamJob,
  product: LivestreamProduct,
  segment: LivestreamSegment
): LivestreamSegment | null {
  if (job.chaining === 'per_product') {
    return product.segments.find((s) => s.order === segment.order + 1) || null;
  }
  for (const p of job.products) {
    const found = p.segments.find((s) => s.order === segment.order + 1);
    if (found) return found;
  }
  return null;
}

/** Trigger gen video cho 1 đoạn: validate trạng thái, gọi flow_generate_video, cập nhật job.json. */
