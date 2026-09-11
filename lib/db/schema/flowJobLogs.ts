/**
 * Schema Drizzle cho LOG GEN VIDEO (Google Veo/Flow) — 1 dòng mỗi LƯỢT GỬI.
 *
 * Vì sao cần bảng riêng cạnh ai_call_logs: gen video KHÔNG đi qua chatCompletion nên không có
 * dòng nào trong ai_call_logs. Trước bảng này, dấu vết duy nhất là data/logs/flow.log — file text
 * xoay vòng ở 10MB, không lọc/sắp/đối chiếu được, và mất lịch sử cũ mỗi lần xoay.
 *
 * Vì sao 1 dòng mỗi LƯỢT GỬI chứ không đổ mọi sự kiện flowLog: poller chạy 15s/vòng ghi liên tục
 * cả ngày; đổ hết vào DB là bảng phình vì tiếng ồn, trong khi thứ cần truy vết là "lượt gen này
 * gửi prompt gì, ảnh nào, model nào, kết quả ra sao". flow.log vẫn giữ nguyên cho phần sự kiện
 * chi tiết (poll/cascade/auto-trigger).
 *
 * KHÔNG lưu ảnh, chỉ relPath — cùng lý do đã ghi ở ai_call_logs.
 */
import { mysqlTable, int, bigint, varchar, mediumtext, datetime, boolean, index } from 'drizzle-orm/mysql-core';
import { mariaJson } from './mariaJson';

export const flowJobLogs = mysqlTable(
  'flow_job_logs',
  {
    rowId: bigint('row_id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    /** 'livestream-v1' | 'livestream-v2' | 'product-review' — CÙNG tập giá trị với ai_call_logs. */
    sourceKind: varchar('source_kind', { length: 24 }).notNull(),
    /**
     * Chủ sở hữu lượt gen. Cùng quy ước 2 cột của ai_call_logs: livestream ghi (slug, ''),
     * review ghi ('', projectId). Chuỗi rỗng chứ không NULL vì `WHERE col = ?` không match NULL —
     * dùng NULL là mọi truy vấn lọc phải thêm nhánh `IS NULL` và chỉ cần quên một chỗ là rơi dòng.
     */
    jobSlug: varchar('job_slug', { length: 191 }).notNull().default(''),
    projectId: varchar('project_id', { length: 128 }).notNull().default(''),
    /** sceneId (review) hoặc segmentId (livestream) — đơn vị được gen. */
    unitId: varchar('unit_id', { length: 128 }).notNull(),
    /** order của scene/segment: đọc log không phải tra ngược id mới biết đang ở cảnh thứ mấy. */
    unitOrder: int('unit_order').notNull().default(0),
    /** job_id Google trả về. '' = lượt hỏng TRƯỚC khi gửi được (hết quota, MCP chết, ảnh lỗi). */
    flowJobId: varchar('flow_job_id', { length: 191 }).notNull().default(''),
    flowProjectId: varchar('flow_project_id', { length: 255 }).notNull().default(''),
    model: varchar('model', { length: 64 }).notNull(),
    aspect: varchar('aspect', { length: 8 }).notNull(),
    durationSec: int('duration_sec').notNull().default(0),
    /**
     * Prompt Veo ĐÚNG NHƯ ĐÃ GỬI — sau khi generateSceneVideo ghép lời thoại Việt, chặn phụ đề và
     * nối negative prompt. KHÔNG phải scene.veoPrompt thô.
     *
     * Vì sao nhấn mạnh: bản dựng lại từ scene.veoPrompt luôn lệch với thứ Google thật sự nhận, và
     * soát prompt trên một bản lệch thì kết luận nào cũng sai — đúng bài học doc-comment của
     * ai_call_logs đã ghi cho system_prompt.
     */
    veoPrompt: mediumtext('veo_prompt').notNull(),
    /** true = veo_prompt là bản THÔ chưa ghép (lượt hỏng trước khi dựng xong prompt cuối). */
    promptIsRaw: boolean('prompt_is_raw').notNull().default(false),
    voiceoverVi: mediumtext('voiceover_vi'),
    negativePrompt: mediumtext('negative_prompt'),
    /** relPath ảnh tham chiếu đã gửi. NULL = lượt không gửi ảnh ref nào. */
    refImagePaths: mariaJson('ref_image_paths').$type<string[] | null>(),
    /** Khung hình khởi điểm (ảnh storyboard, hoặc frame cuối cảnh trước khi nối cảnh). */
    startImagePath: varchar('start_image_path', { length: 1024 }).notNull().default(''),
    /** true = start_image là frame cuối cảnh TRƯỚC (nối cảnh), không phải ảnh storyboard của cảnh này. */
    chained: boolean('chained').notNull().default(false),
    /** NULL = gửi thành công. */
    errorMessage: mediumtext('error_message'),
    /**
     * Phân loại lỗi: 'quota' | 'mcp' | 'api' | '' (không lỗi).
     *
     * Lấy từ isQuotaError/isMcpUnavailableError đã tính sẵn tại call-site, KHÔNG so chuỗi lỗi lại
     * lần nữa. Đây chính là thứ quyết định lượt đó có tính vào attempts hay không — log thiếu nó
     * thì nhìn 3 lượt failed liên tiếp vẫn phải đoán vì sao cảnh chưa hết cửa auto-retry.
     */
    errorKind: varchar('error_kind', { length: 16 }).notNull().default(''),
    /** attempts của scene/segment TẠI thời điểm gửi — để đối chiếu với trần MAX_SEGMENT_AUTO_RETRIES. */
    attempts: int('attempts').notNull().default(0),
    /** Thời gian bỏ ra cho lượt GỬI (upload ảnh + mint token + submit), không phải thời gian render. */
    durationMs: int('duration_ms').notNull().default(0),
    createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
  },
  (t) => ({
    /** Mọi lượt gen của 1 job/project, mới nhất trước. */
    ownerIdx: index('ix_flow_job_logs_owner').on(t.jobSlug, t.projectId, t.rowId),
    /** Trục đọc của tab log toàn cục: lọc theo loại rồi lật trang theo row_id. */
    sourceIdx: index('ix_flow_job_logs_source').on(t.sourceKind, t.rowId),
  })
);
