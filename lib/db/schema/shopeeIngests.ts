/**
 * Schema Drizzle cho DATA CRAWL SHOPEE — bản gốc extension gửi về, lưu bền.
 *
 * Vì sao cần bảng: lib/shopee/ingestStore.ts là Map in-memory nên PM2 reload là mất sạch. Chính
 * app/shopee-crawl/page.tsx đã phải lách bằng cách nhét `sourceRaw` vào job livestream lúc tạo,
 * với ghi chú "không gửi bây giờ là mất hẳn cơ hội đối chiếu" — tức là đã trả giá một lần rồi.
 *
 * Vì sao cần cả `product` (đã parse) LẪN `source_raw` (thô): `product` là thứ trang crawl render
 * và project lấy dữ liệu; `source_raw` là bằng chứng để đối chiếu khi nghi mapping sai. Giữ mỗi
 * bản parse thì lúc mapping hỏng không còn gì để soi lại — đúng bài học của ai_call_logs.
 *
 * `source_raw` chỉ chứa node `item` (pickShopeeItem), KHÔNG phải cả initialState ~342KB.
 */
import { mysqlTable, varchar, datetime, index } from 'drizzle-orm/mysql-core';
import { mariaJson } from './mariaJson';
import type { ShopeeProductInfo } from '../../shopee/types';

export const shopeeIngests = mysqlTable(
  'shopee_ingests',
  {
    /**
     * itemId Shopee — PRIMARY KEY, tức UPSERT: gửi lại cùng sản phẩm sẽ ĐÈ bản cũ.
     *
     * varchar chứ không bigint: saveIngest() vốn nhận `string | number` rồi ép String() làm khoá
     * Map. Đổi sang số ở đây sẽ tạo hai cách định danh cho cùng một sản phẩm, và chỉ cần một chỗ
     * quên ép kiểu là tra không ra.
     */
    itemId: varchar('item_id', { length: 64 }).primaryKey(),
    shopId: varchar('shop_id', { length: 64 }).notNull().default(''),
    /** Tên sản phẩm — tách khỏi `product` để danh sách/tìm kiếm không phải kéo cả cột JSON. */
    name: varchar('name', { length: 512 }).notNull(),
    productUrl: varchar('product_url', { length: 1024 }).notNull().default(''),
    /** ShopeeProductInfo đã parse — nguồn trang crawl đọc để render. */
    product: mariaJson('product').$type<ShopeeProductInfo>().notNull(),
    /** Node `item` thô Shopee trả về. NULL = extension chỉ bóc được DOM, không có initialState. */
    sourceRaw: mariaJson('source_raw').$type<unknown>(),
    /** Lần gửi ĐẦU TIÊN của itemId này — upsert KHÔNG đụng vào, để biết biết sản phẩm vào kho lúc nào. */
    receivedAt: datetime('received_at', { fsp: 3, mode: 'string' }).notNull(),
    /** Lần gửi GẦN NHẤT. Upsert cập nhật cột này, nên đây là trục sắp xếp "mới nhất". */
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
  },
  (t) => ({
    /** Trang crawl mở lên là lấy sản phẩm nhận gần nhất — index đúng trục đó. */
    recentIdx: index('ix_shopee_ingests_recent').on(t.updatedAt),
  })
);
