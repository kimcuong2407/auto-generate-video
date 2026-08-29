import type { ShopeeProductInfo } from './types';
import type { ProductInfo } from '../types';

/**
 * Ghép data crawl Shopee thành 1 block text mô tả sản phẩm, dùng làm entry `manual`
 * khi tạo job Livestream. Route /api/livestream sẽ tự chạy AI chuẩn hoá (extractProductInfo)
 * trên text này, nên chỉ cần gom đủ thông tin thô mà con người đọc hiểu được.
 */
export function shopeeToLivestreamText(p: ShopeeProductInfo): string {
  const lines: string[] = [];
  lines.push(p.name);

  const priceLine = p.priceText || (p.price > 0 ? `${p.price.toLocaleString('vi-VN')}₫` : '');
  if (priceLine) {
    let s = `Giá: ${priceLine}`;
    if (p.discountPercent > 0) {
      s += ` (giảm ${p.discountPercent}%${p.originalPriceText ? `, gốc ${p.originalPriceText}` : ''})`;
    }
    lines.push(s);
  }

  if (p.brand) lines.push(`Thương hiệu: ${p.brand}`);
  if (p.categories.length > 0) lines.push(`Danh mục: ${p.categories.join(' / ')}`);

  if (p.ratingStar > 0) {
    lines.push(`Đánh giá: ${p.ratingStar.toFixed(1)}/5${p.ratingCount ? ` (${p.ratingCount} lượt)` : ''}`);
  }

  const sold = p.soldText || p.historicalSold || p.sold;
  if (sold) lines.push(`Đã bán: ${sold}`);
  if (p.freeShipping) lines.push('Miễn phí vận chuyển');

  if (p.models.length > 0) {
    lines.push(`Phân loại: ${p.models.map((m) => m.name).filter(Boolean).join(', ')}`);
  }

  if (p.description.trim()) {
    lines.push('', 'Mô tả:', p.description.trim());
  }

  return lines.join('\n');
}

/** Tách mô tả Shopee thành các dòng tính năng ngắn (bỏ dòng rỗng, cắt tối đa 8 dòng đầu có nghĩa). */
function descriptionToFeatures(description: string): string[] {
  return description
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter((l) => l.length >= 4 && l.length <= 200)
    .slice(0, 8);
}

/**
 * Map data crawl Shopee sang ProductInfo của Veo Pipeline (khớp shape mà POST /api/projects nhận).
 * Các trường không suy ra được từ Shopee (material) để rỗng cho người dùng bổ sung ở Bước 1.
 */
export function shopeeToProductInfo(p: ShopeeProductInfo): ProductInfo {
  const keyFeatures = descriptionToFeatures(p.description);
  if (p.ratingStar > 0) {
    keyFeatures.push(`Đánh giá ${p.ratingStar.toFixed(1)}/5${p.ratingCount ? ` (${p.ratingCount} lượt)` : ''}`);
  }
  if (p.freeShipping) keyFeatures.push('Miễn phí vận chuyển');

  return {
    name: p.name,
    tagline: p.brand ? `Thương hiệu ${p.brand}` : '',
    category: p.categories.at(-1) || p.brand || '',
    colors: p.models.map((m) => m.name).filter(Boolean).slice(0, 10),
    material: '',
    keyFeatures,
    // Để rỗng — sẽ được AI vision điền tự động khi sinh kịch bản, hoặc bấm "AI phân tích ảnh" ở Bước 1.
    visualDescription: '',
  };
}

/**
 * Bộ dữ liệu prefill cho form /livestream-v2/new, chuyển qua sessionStorage khi bấm "Tạo kịch bản
 * Shopee V2" ở trang crawl. Các ô AI tách được (usage/material/size/...) nằm ở `fields`, do route
 * /api/livestream/v2-extract điền — xem lib/livestream/v2FieldExtract.ts.
 */
export interface ShopeeV2Prefill {
  name: string;
  advantages: string[];
  usage: string;
  material: string;
  size: string;
  colors: string;
  audience: string;
  howToUse: string;
  storage: string;
  channelName: string;
  promotion: string;
  imageUrls: string[];
  /** Text thô gửi kèm để form còn nguồn đối chiếu nếu cần tách lại. */
  rawText: string;
}

/**
 * Map data crawl Shopee sang prefill form V2, phần KHÔNG cần AI.
 *
 * Chỉ suy được các ô có field tương ứng rõ ràng ở Shopee: tên, màu (models), tên kênh (shopName),
 * khuyến mãi (discountPercent + freeShipping). Các ô còn lại (công dụng, chất liệu, kích thước,
 * đối tượng, cách dùng, bảo quản) nằm lẫn trong description dạng văn xuôi nên để rỗng ở đây và
 * được lấp bằng 1 lượt AI. `advantages` cũng vậy: map thô sẽ lẫn thông số kỹ thuật.
 */
export function shopeeToV2Prefill(p: ShopeeProductInfo): ShopeeV2Prefill {
  const promoParts: string[] = [];
  if (p.discountPercent > 0) promoParts.push(`Giảm ${p.discountPercent}%`);
  if (p.freeShipping) promoParts.push('Freeship');

  return {
    name: p.name,
    advantages: [],
    usage: '',
    material: '',
    size: '',
    colors: p.models.map((m) => m.name).filter(Boolean).join(', '),
    audience: '',
    howToUse: '',
    storage: '',
    channelName: p.shopName,
    promotion: promoParts.join(', '),
    imageUrls: p.images,
    rawText: shopeeToLivestreamText(p),
  };
}

/** Key sessionStorage dùng chung giữa trang crawl (ghi) và form V2 (đọc rồi xoá). */
export const SHOPEE_V2_PREFILL_KEY = 'shopee-v2-prefill';
