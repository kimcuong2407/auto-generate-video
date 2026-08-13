import type { ShopeeProductInfo } from './types';

// CDN ảnh Shopee (xác nhận từ og:image trên trang thật: down-vn.img.susercontent.com).
const IMAGE_CDN = 'https://down-vn.img.susercontent.com/file/';

/** Dữ liệu giá/rating/sold scrape từ DOM (do content script gửi kèm). */
export interface ShopeeDomData {
  priceText?: string;
  originalPriceText?: string;
  price?: number;
  priceBeforeDiscount?: number;
  ratingText?: string;
  ratingStar?: number;
  soldText?: string;
}

/** Giá Shopee lưu dạng số nguyên nhân 100000 (VD 27800000000 = 278.000₫). Trả 0 nếu không hợp lệ. */
function priceToNumber(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / 100000;
}

function extractImages(item: any): string[] {
  const ids: string[] = Array.isArray(item?.images) ? item.images : [];
  return ids.map((id) => `${IMAGE_CDN}${id}`);
}

/** Ghép mô tả từ item.description (text thô) hoặc description_info.extended_description (dạng block). */
function extractDescription(item: any): string {
  if (typeof item?.description === 'string' && item.description.trim()) {
    return item.description.trim();
  }
  const blocks = item?.description_info?.extended_description?.field_list;
  if (Array.isArray(blocks)) {
    return blocks
      .filter((b: any) => b?.type === 'text' && typeof b?.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
      .trim();
  }
  return '';
}

/** Parse "1,2k+" / "90k+" / "1.2k" / "1234" → số nguyên. Trả 0 nếu không parse được. */
function soldTextToNumber(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const m = text.match(/([\d.,]+)\s*(k|tr|m)?/i);
  if (!m) return 0;
  let num = Number(m[1].replace(/,/g, '.').replace(/\.(?=\d{3}\b)/g, '')); // "1.234" → 1234, "1,2" → 1.2
  if (!Number.isFinite(num)) return 0;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k') num *= 1000;
  else if (unit === 'tr' || unit === 'm') num *= 1_000_000;
  return Math.round(num);
}

function mapProduct(
  item: any,
  itemId: number,
  shopId: number,
  dom: ShopeeDomData | null
): ShopeeProductInfo {
  const models = Array.isArray(item?.models)
    ? item.models.map((m: any) => ({
        modelId: m.matid ?? m.modelid ?? 0,
        name: m.name ?? '',
        price: priceToNumber(m.price),
        priceBeforeDiscount: priceToNumber(m.price_before_discount),
        stock: m.stock ?? m.normal_stock ?? 0,
      }))
    : [];

  // Giá/rating: Shopee strip khỏi initialState → ưu tiên DOM scrape, fallback initialState (thường null).
  const domPrice = dom?.price && dom.price > 0 ? dom.price : 0;
  const domOriginal = dom?.priceBeforeDiscount && dom.priceBeforeDiscount > 0 ? dom.priceBeforeDiscount : 0;
  const price = domPrice || priceToNumber(item?.price);
  const priceBeforeDiscount = domOriginal || priceToNumber(item?.price_before_discount);
  const ratingStar =
    dom?.ratingStar && dom.ratingStar > 0 ? dom.ratingStar : item?.item_rating?.rating_star ?? 0;
  const soldFromDom = soldTextToNumber(dom?.soldText);
  const sold = soldFromDom || item?.sold || 0;

  // discountPercent: tính từ 2 giá DOM nếu có; nếu không, dùng field initialState.
  let discountPercent = item?.raw_discount ?? (item?.discount ? Number(String(item.discount).replace('%', '')) || 0 : 0);
  if (!discountPercent && price > 0 && priceBeforeDiscount > price) {
    discountPercent = Math.round(((priceBeforeDiscount - price) / priceBeforeDiscount) * 100);
  }

  return {
    itemId,
    shopId,
    name: item?.name ?? '',
    description: extractDescription(item),
    images: extractImages(item),
    currency: item?.currency ?? 'VND',
    price,
    priceMin: priceToNumber(item?.price_min) || price,
    priceMax: priceToNumber(item?.price_max) || price,
    priceBeforeDiscount,
    discountPercent,
    stock: item?.stock ?? item?.normal_stock ?? 0,
    sold,
    historicalSold: item?.historical_sold ?? 0,
    liked: Boolean(item?.liked),
    likedCount: item?.liked_count ?? 0,
    viewCount: item?.view_count ?? 0,
    ratingStar,
    ratingCount: Array.isArray(item?.item_rating?.rating_count)
      ? item.item_rating.rating_count[0] ?? 0
      : item?.item_rating?.rating_count ?? 0,
    categories: Array.isArray(item?.categories)
      ? item.categories.map((c: any) => c?.display_name).filter(Boolean)
      : [],
    brand: item?.brand ?? '',
    isOfficialShop: Boolean(item?.is_official_shop),
    shopeeVerified: Boolean(item?.shopee_verified),
    freeShipping: Boolean(item?.show_free_shipping),
    shopName: item?.shop_name ?? item?.shop_detailed?.name ?? '',
    shopLocation: item?.shop_location ?? '',
    models,
    productUrl: `https://shopee.vn/product/${shopId}/${itemId}`,
    priceText: dom?.priceText ?? '',
    originalPriceText: dom?.originalPriceText ?? '',
    soldText: dom?.soldText ?? '',
    ratingText: dom?.ratingText ?? '',
  };
}

/** Tìm object `item` sản phẩm trong initialState (path item.items[itemId]). Trả null nếu không có. */
export function pickShopeeItem(initialState: any, itemId?: string | number): any | null {
  const items = initialState?.item?.items;
  if (!items || typeof items !== 'object') return null;
  const key = itemId != null ? String(itemId) : Object.keys(items)[0];
  return key ? items[key] ?? null : null;
}

/**
 * Trong initialState, item.items[itemId] là skeleton (số bị strip). Metadata ĐẦY ĐỦ
 * (name/description/images/models/categories/brand/shop) nằm ở
 * DOMAIN_PDP.data.PDP_BFF_DATA.cachedMap["<shopId>/<itemId>"].item. Ưu tiên node này.
 */
function pickCachedItem(initialState: any, itemId?: string | number, shopId?: string | number): any | null {
  const cachedMap = initialState?.DOMAIN_PDP?.data?.PDP_BFF_DATA?.cachedMap;
  if (!cachedMap || typeof cachedMap !== 'object') return null;
  // Key ưu tiên "<shopId>/<itemId>"; nếu không khớp, lấy entry đầu tiên có .item.
  if (shopId != null && itemId != null) {
    const exact = cachedMap[`${shopId}/${itemId}`];
    if (exact?.item) return exact;
  }
  if (itemId != null) {
    const hit = Object.values(cachedMap).find(
      (v: any) => String(v?.item?.itemid ?? v?.item?.item_id) === String(itemId)
    );
    if (hit) return hit as any;
  }
  const first = Object.values(cachedMap).find((v: any) => v?.item);
  return (first as any) ?? null;
}

/** Trích sold display string từ cachedMap[key].product_review (VD "90k+"). */
function soldDisplayFrom(cached: any): string {
  const pr = cached?.product_review;
  return (
    pr?.sold_count_display ??
    pr?.global_sold_count_display ??
    pr?.historical_sold_count_display ??
    ''
  );
}

export function parseShopeeInitialState(
  initialState: any,
  itemId?: string | number,
  domData?: ShopeeDomData | null
): ShopeeProductInfo | null {
  const skeleton = pickShopeeItem(initialState, itemId);

  const resolvedShopId0 =
    skeleton?.shopid ?? skeleton?.shop_id ?? initialState?.DOMAIN_CONTEXT?.data?.shopId;

  const cached = pickCachedItem(initialState, itemId, resolvedShopId0);
  const item = cached?.item ?? skeleton;
  if (!item) return null;

  const key =
    itemId != null ? String(itemId) : Object.keys(initialState?.item?.items ?? {})[0];
  const resolvedItemId = Number(item.itemid ?? item.item_id ?? key);
  const shopId = Number(
    item.shopid ?? item.shop_id ?? resolvedShopId0 ?? 0
  );

  // Nếu DOM không có sold nhưng cachedMap có display string → dùng nó.
  const merged: ShopeeDomData = { ...(domData ?? {}) };
  if (!merged.soldText) {
    const disp = soldDisplayFrom(cached);
    if (disp) merged.soldText = disp;
  }

  return mapProduct(item, resolvedItemId, shopId, merged);
}
