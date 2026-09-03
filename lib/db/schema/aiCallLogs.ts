/**
 * Schema Drizzle cho LOG lượt gọi AI — input/output THẬT đã gửi/nhận của từng bước.
 *
 * Vì sao cần bảng riêng thay vì đọc lại từ job: kết quả các bước được lưu dưới dạng ĐÃ PARSE
 * (job.stageBible, job.productLock) hoặc không lưu ở đâu cả (extract, shorten, script_qa) — chạy
 * xong là mất. Muốn soát chất lượng prompt thì phải có đúng chuỗi đã gửi và bản thô AI trả về,
 * không phải bản dựng lại: dựng lại luôn lệch với thứ thật (VD ${params} đã thay giá trị, ảnh nào
 * thực sự đọc được, prompt tầng nào đang thắng lúc đó).
 *
 * `system_prompt` lưu bản ĐÃ GHÉP ${params} — NGƯỢC với bảng ai_prompts (lưu nguyên ${params}).
 * Đây là điểm khác biệt cố ý: ai_prompts là bản mẫu để sửa, bảng này là bằng chứng đã gửi gì.
 *
 * KHÔNG lưu base64 ảnh (1 ảnh vài trăm KB, 1 lượt tới 4 ảnh) — chỉ lưu relPath ở `image_paths`.
 */
import { mysqlTable, int, bigint, varchar, mediumtext, datetime, index } from 'drizzle-orm/mysql-core';
import { mariaJson } from './mariaJson';

export const aiCallLogs = mysqlTable(
  'ai_call_logs',
  {
    rowId: bigint('row_id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    /** Bước AI — khoá trong PROMPT_STEPS (lib/livestream/promptSteps.ts). */
    stepKey: varchar('step_key', { length: 64 }).notNull(),
    /**
     * '' = bước chạy TRƯỚC khi job tồn tại (extract / vision_screenshot / v2_field_extract lúc tạo
     * job). Chuỗi rỗng chứ KHÔNG NULL, cùng quy ước với ai_prompts — lý do thực dụng: `WHERE
     * job_slug = ?` không bao giờ match NULL, nên cắt tỉa sẽ cần thêm nhánh `IS NULL` riêng, và
     * nhánh đó rất dễ bị quên → 3 bước global phình vô hạn mà không ai thấy.
     */
    jobSlug: varchar('job_slug', { length: 191 }).notNull(),
    /** '' = lượt cấp job. Bước script/shorten/script_qa chạy theo TỪNG sản phẩm trong 1 vòng lặp. */
    productId: varchar('product_id', { length: 64 }).notNull(),
    /** Model thực dùng (đã tính cả override vision) — 2 lượt cùng bước có thể khác model. */
    model: varchar('model', { length: 191 }).notNull(),
    /**
     * Tầng prompt đang thắng lúc chạy: 'job' | 'global' | 'default'. Cần vì sau khi Mr.D bỏ bản
     * riêng của job, so 2 lượt cũ/mới mà không biết lượt nào chạy tầng nào thì không giải thích
     * được vì sao output khác nhau.
     */
    promptScope: varchar('prompt_scope', { length: 16 }).notNull(),
    /** System prompt ĐÃ ghép ${params} — đúng chuỗi đã gửi, xem doc-comment ở trên. */
    systemPrompt: mediumtext('system_prompt').notNull(),
    userPrompt: mediumtext('user_prompt').notNull(),
    /** NULL = lượt lỗi (chưa có output). Chuỗi rỗng KHÁC NULL: AI trả về rỗng thật. */
    output: mediumtext('output'),
    /** NULL = thành công. */
    errorMessage: mediumtext('error_message'),
    /** Số ảnh THỰC SỰ gửi kèm (đã bỏ ảnh đọc không được), lấy từ opts.images.length. */
    imageCount: int('image_count').notNull().default(0),
    /** relPath/tên các ảnh đã gửi (mảng chuỗi). NULL = bước không gửi ảnh. */
    imagePaths: mariaJson('image_paths').$type<string[] | null>(),
    durationMs: int('duration_ms').notNull(),
    /** Số lần thử đã dùng (chatClient tự retry 524/5xx/timeout) — 3 lần thử = AI đang chập chờn. */
    attempts: int('attempts').notNull().default(1),
    createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
  },
  (t) => ({
    /**
     * Trục đọc DUY NHẤT: N lượt gần nhất của 1 cặp (job, bước).
     *
     * Cột thứ 3 là `row_id` chứ KHÔNG phải `created_at`: `created_at` do app sinh (`new Date()`)
     * nên nhiều process PM2 ghi gần nhau có thể cho row_id lớn hơn mà created_at nhỏ hơn. Sắp xếp
     * và cắt tỉa đều theo row_id (thứ tự ghi THẬT của AUTO_INCREMENT); created_at chỉ để hiển thị.
     */
    lookupIdx: index('ix_ai_call_logs_lookup').on(t.jobSlug, t.stepKey, t.rowId),
  })
);
