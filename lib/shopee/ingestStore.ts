import type { ShopeeProductInfo } from './types';

interface IngestEntry {
  product: ShopeeProductInfo;
  raw: unknown;
  receivedAt: string;
}

const MAX_ENTRIES = 50;

// Store in-memory: data extension gửi về chỉ phục vụ màn hình test hiển thị real-time,
// không cần bền vững qua restart. Key = itemId (string).
const store = new Map<string, IngestEntry>();

/** Lưu 1 sản phẩm extension vừa gửi về. Tự cắt bớt mục cũ nhất khi vượt MAX_ENTRIES. */
export function saveIngest(itemId: string | number, product: ShopeeProductInfo, raw: unknown): IngestEntry {
  const entry: IngestEntry = { product, raw, receivedAt: new Date().toISOString() };
  store.set(String(itemId), entry);

  if (store.size > MAX_ENTRIES) {
    // Map giữ thứ tự chèn — key đầu tiên là cũ nhất.
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
  return entry;
}

/**
 * Lấy 1 mục: theo itemId nếu truyền, ngược lại lấy mục có receivedAt mới nhất.
 * Trả null nếu store rỗng hoặc không có itemId tương ứng.
 */
export function getLatest(itemId?: string | number | null): IngestEntry | null {
  if (itemId != null && itemId !== '') {
    return store.get(String(itemId)) ?? null;
  }
  let latest: IngestEntry | null = null;
  for (const entry of store.values()) {
    if (!latest || entry.receivedAt > latest.receivedAt) latest = entry;
  }
  return latest;
}
