import { desc, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { DB_ENABLED } from '../db/config';
import { shopeeIngests } from '../db/schema/shopeeIngests';
import type { ShopeeProductInfo } from './types';

interface IngestEntry {
  product: ShopeeProductInfo;
  raw: unknown;
  receivedAt: string;
}

const MAX_ENTRIES = 50;

/**
 * Cache đọc nhanh trong process. KHÔNG còn là nguồn sự thật — DB mới là.
 *
 * Vì sao giữ lại: trang crawl poll liên tục để hiện data real-time, đi thẳng DB mỗi nhịp là thừa.
 * Vì sao không còn đủ một mình: Map mất sạch khi PM2 reload, nên bấm "Tạo project" sau một lần
 * deploy là trắng tay. Chính app/shopee-crawl/page.tsx đã phải lách bằng cách nhét sourceRaw vào
 * job livestream lúc tạo, kèm ghi chú "không gửi bây giờ là mất hẳn cơ hội đối chiếu" — tức là đã
 * trả giá cho chuyện này một lần rồi.
 */
const store = new Map<string, IngestEntry>();

/**
 * Lưu 1 sản phẩm extension vừa gửi về: ghi Map (nhanh) + UPSERT vào DB (bền).
 *
 * Upsert theo itemId — gửi lại cùng sản phẩm thì ĐÈ bản cũ, giữ `received_at` của lần đầu để biết
 * sản phẩm vào kho từ bao giờ.
 *
 * Ghi DB best-effort: DB hỏng thì vẫn trả entry để trang crawl chạy tiếp như trước khi có bảng.
 * Ném ở đây sẽ làm extension nhận lỗi và Mr.D tưởng crawl hỏng, trong khi data vẫn dùng được.
 */
export async function saveIngest(
  itemId: string | number,
  product: ShopeeProductInfo,
  raw: unknown
): Promise<IngestEntry> {
  const now = new Date().toISOString();
  const entry: IngestEntry = { product, raw, receivedAt: now };
  const key = String(itemId);
  store.set(key, entry);

  if (store.size > MAX_ENTRIES) {
    // Map giữ thứ tự chèn — key đầu tiên là cũ nhất. Chỉ cắt CACHE, DB giữ nguyên.
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }

  if (DB_ENABLED) {
    try {
      // DATETIME không mang timezone → ghi UTC, hiển thị mới đổi sang +7 (lib/format/datetime.ts).
      const sqlNow = now.replace('T', ' ').replace('Z', '');
      const row = {
        itemId: key,
        shopId: String(product.shopId ?? ''),
        name: product.name || '',
        productUrl: product.productUrl || '',
        product,
        sourceRaw: raw ?? null,
        receivedAt: sqlNow,
        updatedAt: sqlNow,
      };
      await getDb()
        .insert(shopeeIngests)
        .values(row)
        // received_at KHÔNG nằm trong set: đó là mốc "vào kho lần đầu", đè đi là mất.
        .onDuplicateKeyUpdate({
          set: {
            shopId: row.shopId,
            name: row.name,
            productUrl: row.productUrl,
            product: row.product,
            sourceRaw: row.sourceRaw,
            updatedAt: sqlNow,
          },
        });
    } catch (err) {
      console.error(`[shopeeIngest] không lưu được sản phẩm ${key}: ${(err as Error).message}`);
    }
  }

  return entry;
}

/** Chuyển 1 row DB về dạng entry mà trang crawl đang đọc. */
function rowToEntry(row: typeof shopeeIngests.$inferSelect): IngestEntry {
  return {
    product: row.product,
    raw: row.sourceRaw ?? null,
    // Trả lần gửi GẦN NHẤT: đây là thứ trang crawl hiển thị ("Nhận lúc ...").
    receivedAt: `${row.updatedAt.replace(' ', 'T')}Z`,
  };
}

/**
 * Lấy 1 mục: theo itemId nếu truyền, ngược lại lấy mục gửi gần nhất.
 *
 * Thử cache trước rồi mới tới DB — chính nhánh DB là thứ chữa bug "PM2 reload xong trang crawl
 * trắng trơn dù vừa gửi data".
 */
export async function getLatest(itemId?: string | number | null): Promise<IngestEntry | null> {
  const key = itemId != null && itemId !== '' ? String(itemId) : null;

  if (key) {
    const cached = store.get(key);
    if (cached) return cached;
  } else {
    let latest: IngestEntry | null = null;
    for (const entry of store.values()) {
      if (!latest || entry.receivedAt > latest.receivedAt) latest = entry;
    }
    if (latest) return latest;
  }

  if (!DB_ENABLED) return null;
  try {
    const db = getDb();
    const rows = key
      ? await db.select().from(shopeeIngests).where(eq(shopeeIngests.itemId, key)).limit(1)
      : await db.select().from(shopeeIngests).orderBy(desc(shopeeIngests.updatedAt)).limit(1);
    if (!rows[0]) return null;
    const entry = rowToEntry(rows[0]);
    // Nạp lại cache để nhịp poll kế không phải hỏi DB nữa.
    store.set(rows[0].itemId, entry);
    return entry;
  } catch (err) {
    console.error(`[shopeeIngest] không đọc được kho sản phẩm: ${(err as Error).message}`);
    return null;
  }
}
