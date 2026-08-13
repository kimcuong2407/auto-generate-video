export interface ShopeeProductModel {
  modelId: number;
  name: string;
  price: number;
  priceBeforeDiscount: number;
  stock: number;
}

export interface ShopeeProductInfo {
  itemId: number;
  shopId: number;
  name: string;
  description: string;
  images: string[];
  currency: string;
  price: number;
  priceMin: number;
  priceMax: number;
  priceBeforeDiscount: number;
  discountPercent: number;
  stock: number;
  sold: number;
  historicalSold: number;
  liked: boolean;
  likedCount: number;
  viewCount: number;
  ratingStar: number;
  ratingCount: number;
  categories: string[];
  brand: string;
  isOfficialShop: boolean;
  shopeeVerified: boolean;
  freeShipping: boolean;
  shopName: string;
  shopLocation: string;
  models: ShopeeProductModel[];
  productUrl: string;
  // Text scrape thẳng từ DOM đã render (nguồn DUY NHẤT cho giá/rating/sold vì Shopee
  // strip số này khỏi initialState nhúng). Giữ nguyên chuỗi để hiển thị "y như trang".
  priceText: string;
  originalPriceText: string;
  soldText: string;
  ratingText: string;
}

export interface ShopeeCrawlResult {
  ok: true;
  product: ShopeeProductInfo;
  raw: unknown;
}

export interface ShopeeCrawlError {
  ok: false;
  error: string;
}
