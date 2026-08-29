/**
 * Chọn ảnh reference gửi kèm khi gen video — module THUẦN (không import node:fs/chatClient) để
 * client component (ProductPanel hiển thị "Chi tiết đoạn") dùng chung đúng 1 nguồn sự thật với
 * server. Trước đây UI tự ghép danh sách riêng và KHÔNG cắt 3, nên hiện đủ 4 ảnh trong khi Veo
 * thực tế chỉ nhận 3 — người dùng tưởng đã gửi ảnh mẫu mà thật ra nó bị cắt mất.
 */
import type { LivestreamJob, LivestreamProduct, LivestreamSegment } from './types';

/** Veo reference-to-video chỉ nhận TỐI ĐA 3 ảnh reference — vượt là Flow trả INVALID_ARGUMENT. */
const MAX_REF_IMAGES = 3;

/** Ảnh sản phẩm tối đa gửi cho AI vision khi chốt sân khấu — xem pickVisionRefEntries. */
const MAX_VISION_PRODUCT_IMAGES = 3;

/** 1 ảnh gửi kèm cho vision + nhãn để model biết đang nhìn cái gì. */
export interface VisionRefEntry {
  rel: string;
  label: string;
}

/**
 * Chọn ảnh gửi THẲNG cho AI vision ở bước chốt "stage bible", kèm nhãn vai trò.
 *
 * Khác pickRefImagePaths (chọn ảnh gửi cho VEO, trần cứng 3 vì giới hạn API): đây là lượt gọi model
 * đọc ảnh, trần do ta tự đặt cho payload hợp lý — 1 ảnh mẫu + tối đa 3 ảnh sản phẩm + 1 ảnh nền.
 *
 * Ảnh mẫu đứng ĐẦU cùng lý do đã ghi ở pickRefImagePaths: nhân vật là thứ model bịa sai nặng nhất.
 * Trước đây bước này chỉ gửi ảnh mẫu + ảnh nền nên bible tả bối cảnh/đạo cụ mà CHƯA TỪNG nhìn sản
 * phẩm — "scene" hay ra căn phòng không bày được món hàng thật.
 */
export function pickVisionRefEntries(
  job: Pick<
    LivestreamJob,
    'selectedRefImagePaths' | 'selectedModelImagePath' | 'selectedBackgroundImagePath'
  >
): VisionRefEntry[] {
  const entries: VisionRefEntry[] = [];
  if (job.selectedModelImagePath) {
    entries.push({ rel: job.selectedModelImagePath, label: 'ảnh NGƯỜI MẪU/NGƯỜI DẪN' });
  }
  // Bỏ ảnh [0] khi dư ảnh: ảnh bìa sàn TMĐT gần như luôn là đồ hoạ marketing (badge "chính hãng",
  // logo shop) — chiếm suất mà không thêm thông tin hình dáng nào. Cùng heuristic với
  // extractVisualDescription() và pickReferenceEntries() bên lib/data/.
  const all = job.selectedRefImagePaths ?? [];
  const offset = all.length > MAX_VISION_PRODUCT_IMAGES ? 1 : 0;
  all.slice(offset, offset + MAX_VISION_PRODUCT_IMAGES).forEach((rel, i) => {
    entries.push({ rel, label: `ảnh SẢN PHẨM THẬT ${i + 1}` });
  });
  if (job.selectedBackgroundImagePath) {
    entries.push({ rel: job.selectedBackgroundImagePath, label: 'ảnh BỐI CẢNH/BACKGROUND' });
  }
  return entries;
}

/**
 * Ảnh gửi cho AI ở bước GEN BACKGROUND — ưu tiên danh sách người dùng tự chọn
 * (job.backgroundRefPaths), rỗng thì rơi về lựa chọn tự động của pickVisionRefEntries.
 *
 * Vì sao tách khỏi pickVisionRefEntries: bước chốt stage bible luôn cần bộ ảnh chuẩn do hệ thống
 * quyết, còn gen background là thao tác người dùng chủ động lặp lại nhiều lần để thử bối cảnh —
 * họ cần quyền bỏ bớt ảnh làm nhiễu và thêm ảnh phòng live mẫu.
 *
 * Nhãn suy theo vai trò thật của từng ảnh để prompt (refLegendBlock) nói đúng model đang nhìn gì;
 * ảnh không thuộc vai trò nào (upload riêng cho bước này) là ảnh THAM CHIẾU BỐI CẢNH.
 */
export function pickBackgroundRefEntries(
  job: Pick<
    LivestreamJob,
    | 'selectedRefImagePaths'
    | 'selectedModelImagePath'
    | 'selectedBackgroundImagePath'
    | 'backgroundRefPaths'
  >
): VisionRefEntry[] {
  const chosen = job.backgroundRefPaths ?? [];
  if (chosen.length === 0) return pickVisionRefEntries(job);

  const productSet = new Set(job.selectedRefImagePaths ?? []);
  let productIdx = 0;
  return chosen.map((rel) => {
    if (rel === job.selectedModelImagePath) {
      return { rel, label: 'ảnh NGƯỜI MẪU/NGƯỜI DẪN' };
    }
    if (rel === job.selectedBackgroundImagePath) {
      return { rel, label: 'ảnh BỐI CẢNH/BACKGROUND' };
    }
    if (productSet.has(rel)) {
      productIdx += 1;
      return { rel, label: `ảnh SẢN PHẨM THẬT ${productIdx}` };
    }
    return { rel, label: 'ảnh THAM CHIẾU BỐI CẢNH' };
  });
}

/**
 * Ảnh gửi cho AI ở bước SINH SCRIPT (vision đọc ngoại hình sản phẩm + chốt sân khấu) — ưu tiên
 * danh sách người dùng tự chọn (job.scriptRefPaths), rỗng thì rơi về pickVisionRefEntries.
 *
 * Cùng lý do với pickBackgroundRefEntries: ảnh bìa marketing hoặc ảnh nền quá đặc trưng chiếm suất
 * mà làm nhiễu, người dùng cần quyền bỏ bớt. Nhãn suy theo vai trò thật để model biết đang nhìn gì.
 */
export function pickScriptRefEntries(
  job: Pick<
    LivestreamJob,
    | 'selectedRefImagePaths'
    | 'selectedModelImagePath'
    | 'selectedBackgroundImagePath'
    | 'scriptRefPaths'
  >
): VisionRefEntry[] {
  const chosen = job.scriptRefPaths ?? [];
  if (chosen.length === 0) return pickVisionRefEntries(job);

  const productSet = new Set(job.selectedRefImagePaths ?? []);
  let productIdx = 0;
  return chosen.map((rel) => {
    if (rel === job.selectedModelImagePath) return { rel, label: 'ảnh NGƯỜI MẪU/NGƯỜI DẪN' };
    if (rel === job.selectedBackgroundImagePath) return { rel, label: 'ảnh BỐI CẢNH/BACKGROUND' };
    if (productSet.has(rel)) {
      productIdx += 1;
      return { rel, label: `ảnh SẢN PHẨM THẬT ${productIdx}` };
    }
    return { rel, label: 'ảnh THAM CHIẾU' };
  });
}

/**
 * Chuỗi đại diện cho TOÀN BỘ input mà stage bible phụ thuộc — dùng để biết bible đã chốt có còn
 * khớp dữ liệu đầu vào hiện tại hay không (xem isStageBibleStale).
 *
 * Vì sao cần: bible được cache cấp job để mọi sản phẩm dùng chung 1 sân khấu. Trước đây dấu vết
 * duy nhất là modelImagePath, nên đổi ảnh nền hay sửa mô tả sản phẩm thì bible cũ vẫn được dùng
 * lại VĨNH VIỄN dù đang tả sai phòng/sai đạo cụ, mà UI không có nút chốt lại.
 *
 * Sort cả 2 danh sách: bỏ chọn rồi chọn lại 1 ảnh sẽ đảo thứ tự mảng trong khi BỘ ảnh không đổi —
 * không sort thì lần nào cũng tính là lệch rồi gọi AI lại vô ích.
 */
export function stageBibleFingerprint(
  job: Pick<
    LivestreamJob,
    | 'selectedRefImagePaths'
    | 'selectedModelImagePath'
    | 'selectedBackgroundImagePath'
    | 'products'
  > &
    Partial<Pick<LivestreamJob, 'scriptRefPaths'>>
): string {
  return JSON.stringify({
    model: job.selectedModelImagePath ?? null,
    refs: [...(job.selectedRefImagePaths ?? [])].sort(),
    background: job.selectedBackgroundImagePath ?? null,
    // Ảnh Mr.D tick riêng cho bước script QUYẾT ĐỊNH bible nhìn thấy gì (pickScriptRefEntries) —
    // không tính vào đây thì bỏ bớt/thêm ảnh xong bible cũ vẫn được dùng lại y nguyên.
    scriptRefs: [...(job.scriptRefPaths ?? [])].sort(),
    // Bible chốt người dẫn/bối cảnh DỰA THEO danh sách sản phẩm (xem STAGE_BIBLE_SYSTEM_PROMPT:
    // "chọn phương án TRUNG TÍNH, hợp lý với TOÀN BỘ danh sách"), nên sửa mô tả cũng phải chốt lại.
    products: [...job.products]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => `${p.id} ${p.name} ${p.description}`),
  });
}

/**
 * Chọn tối đa 3 ảnh reference gửi kèm khi gen video, theo thứ tự ƯU TIÊN:
 * ảnh mẫu (người dẫn) → ảnh background → ảnh sản phẩm.
 *
 * Ảnh mẫu và ảnh nền đứng TRƯỚC vì nhân vật và bối cảnh là thứ Veo bịa sai nặng nhất: không có
 * ảnh thì nó vẽ người/căn phòng hoàn toàn khác dù prompt tả kỹ đến đâu (mô tả bằng chữ không ghim
 * được khuôn mặt lẫn layout phòng). Sản phẩm thì ngược lại — prompt đã có sẵn "Mô tả ngoại hình
 * sản phẩm" do vision đọc từ ảnh thật, nên 1 suất ảnh là đủ nhận ra.
 *
 * Trước đây ảnh sản phẩm xếp trước ảnh nền rồi cắt `.slice(0, 3)`: job chọn ≥2 ảnh sản phẩm là
 * ảnh nền bị cắt mất, Veo không bao giờ nhìn thấy bối cảnh đã chọn → dựng phòng khác hẳn.
 *
 * @param hasPrevFrame có frame cuối đoạn trước để chain hay không — nếu có, chừa 1 suất cho nó.
 */
export function pickRefImagePaths(
  job: Pick<
    LivestreamJob,
    'selectedRefImagePaths' | 'selectedModelImagePath' | 'selectedBackgroundImagePath'
  > &
    Partial<Pick<LivestreamJob, 'detachedImagePaths'>>,
  hasPrevFrame: boolean
): string[] {
  const limit = hasPrevFrame ? MAX_REF_IMAGES - 1 : MAX_REF_IMAGES;
  // Ảnh đã "tách khỏi gen video": bỏ TRƯỚC khi cắt 3, nếu không nó vừa không được gửi vừa chiếm
  // suất của ảnh phía sau (bỏ sau khi slice thì danh sách chỉ ngắn đi chứ ảnh sau không lên thay).
  const detached = new Set(job.detachedImagePaths ?? []);
  return [
    ...(job.selectedModelImagePath ? [job.selectedModelImagePath] : []),
    ...(job.selectedBackgroundImagePath ? [job.selectedBackgroundImagePath] : []),
    ...(job.selectedRefImagePaths ?? []),
  ]
    .filter((rel) => !detached.has(rel))
    .slice(0, limit);
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
