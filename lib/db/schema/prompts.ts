/**
 * Schema Drizzle cho prompt AI người dùng chỉnh — HAI TẦNG trong cùng một bảng.
 *
 * Vì sao 1 bảng cho cả 2 tầng: `jobSlug = ''` là tầng MẶC ĐỊNH TOÀN HỆ THỐNG, `jobSlug = slug`
 * là bản riêng của job đó. Cùng một hình dạng dữ liệu, cùng đường đọc/ghi, chỉ khác giá trị 1 cột
 * — tách 2 bảng chỉ nhân đôi code cho cùng một việc.
 *
 * Vì sao dùng chuỗi rỗng chứ KHÔNG phải NULL cho tầng global: MySQL/MariaDB coi mỗi NULL là
 * distinct trong UNIQUE index, nên `UNIQUE(step_key, job_slug)` với NULL sẽ KHÔNG chặn được 2 row
 * global trùng bước — DB hết vai trò gác cổng và app phải tự kiểm, sớm muộn cũng lọt.
 *
 * NGỮ NGHĨA 3 TRẠNG THÁI (bắt buộc giữ — negative prompt dựa vào nó, xem resolveNegativePrompt):
 *   - KHÔNG có row       → chưa đụng tới, dùng prompt mặc định trong code.
 *   - có row, body = ''  → người dùng CHỦ ĐỘNG xoá sạch ô để TẮT HẲN bước phụ trợ đó.
 *   - có row, body != '' → dùng đúng nội dung đó.
 * Đây là lý do dùng "có row / không row" thay cho một cột nullable: NULL và '' trong cùng một cột
 * rất dễ bị `?? default` làm mất phân biệt, đúng cái bug đã ghi ở refImages.ts.
 *
 * `body` LƯU NGUYÊN `${params}`, không bao giờ lưu bản đã thay giá trị: params được fill lúc gen
 * theo từng sản phẩm (xem fillPromptParams), lưu bản đã fill thì prompt kẹt vào sản phẩm đầu tiên.
 */
import { mysqlTable, int, varchar, mediumtext, datetime, uniqueIndex } from 'drizzle-orm/mysql-core';

export const aiPrompts = mysqlTable(
  'ai_prompts',
  {
    rowId: int('row_id').autoincrement().primaryKey(),
    /** Bước AI — khoá trong PROMPT_STEPS (lib/livestream/promptSteps.ts). */
    stepKey: varchar('step_key', { length: 64 }).notNull(),
    /** '' = mặc định toàn hệ thống; slug job = bản riêng của job đó. Xem doc-comment ở trên. */
    jobSlug: varchar('job_slug', { length: 191 }).notNull(),
    /** Nội dung prompt, GIỮ NGUYÊN ${params}. Rỗng = tắt hẳn, KHÁC với không có row. */
    body: mediumtext('body').notNull(),
    createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
  },
  (t) => ({
    stepScopeIdx: uniqueIndex('uq_ai_prompts_step_scope').on(t.stepKey, t.jobSlug),
  })
);
