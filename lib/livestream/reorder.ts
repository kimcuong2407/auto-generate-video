import type { LivestreamJob } from './types';

/**
 * Tính lại `order` tuyệt đối của mọi segment xuyên suốt TOÀN BỘ job (theo thứ tự sản phẩm,
 * rồi thứ tự đoạn trong từng sản phẩm) — dùng cho chaining liên tục giữa sản phẩm và cho
 * concat cuối ghép đúng thứ tự. Gọi lại mỗi khi script của 1 sản phẩm được sinh/sinh lại.
 */
export function recomputeSegmentOrder(job: LivestreamJob): void {
  const sortedProducts = [...job.products].sort((a, b) => a.order - b.order);
  let order = 0;
  for (const product of sortedProducts) {
    for (const segment of product.segments) {
      order += 1;
      segment.order = order;
    }
  }
}
