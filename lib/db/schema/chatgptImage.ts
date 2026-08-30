/**
 * Schema Drizzle cho queue gen ảnh qua ChatGPT web (browser automation, xem
 * lib/chatgptImage/). Tách file riêng vì không thuộc nhóm projects lẫn livestream —
 * cả hai nhóm đó đều là NGƯỜI DÙNG của queue này, không phải chủ sở hữu.
 *
 * Vì sao cần bảng thật thay vì biến in-memory: 1 lượt gen ảnh mất tới vài phút. PM2
 * reload giữa chừng (mỗi lần deploy) sẽ mất sạch job in-memory, không cách nào biết
 * job nào đang dở. Có bảng thì job dở dang còn nguyên trạng thái để nhận diện và dọn.
 */
import {
  mysqlTable,
  varchar,
  int,
  text,
  mediumtext,
  datetime,
  mysqlEnum,
  index,
} from 'drizzle-orm/mysql-core';
import { mariaJson } from './mariaJson';

const ASPECT_RATIOS = ['9:16', '16:9'] as const;

export const chatgptImageJobs = mysqlTable(
  'chatgpt_image_jobs',
  {
    id: varchar('id', { length: 128 }).primaryKey(),
    prompt: mediumtext('prompt').notNull(),
    aspect: mysqlEnum('aspect', ASPECT_RATIOS).notNull(),
    /** Đường dẫn file local của ảnh tham chiếu, JSON array. */
    refImagePaths: mariaJson('ref_image_paths').$type<string[]>(),
    status: mysqlEnum('status', ['queued', 'running', 'done', 'failed']).notNull(),
    /** Account đã/đang xử lý job (id trong data/chatgpt-auth/accounts.json). */
    accountId: varchar('account_id', { length: 128 }),
    /** Đường dẫn file ảnh kết quả đã ghi ra đĩa. */
    imagePath: varchar('image_path', { length: 1024 }),
    error: text('error'),
    attempts: int('attempts').notNull().default(0),
    createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
    startedAt: datetime('started_at', { fsp: 3, mode: 'string' }),
    finishedAt: datetime('finished_at', { fsp: 3, mode: 'string' }),
  },
  (t) => ({
    // Worker claim job: quét status='queued' theo thứ tự vào trước ra trước.
    statusCreatedIdx: index('idx_chatgpt_image_status_created').on(t.status, t.createdAt),
  })
);
