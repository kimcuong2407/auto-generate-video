/**
 * Schema Drizzle nhóm Livestream: job → product → segment (2 tầng).
 *
 * Nguyên tắc map (khớp lib/livestream/types.ts):
 * - Field scalar → cột riêng. Union literal → mysqlEnum.
 * - Mảng nhỏ / map / object cấu hình (spokespersonImagePaths, imageR2Urls, concat, flowStatusCache)
 *   → cột JSON, giữ đúng gu "tường minh, ít bảng phụ" của dự án. Store tự assemble lại object gốc.
 * - Timestamp ISO8601 (mili-giây) → datetime(3) fsp=3, dùng dateStrings ở pool nên đọc/ghi là string.
 * - createdAt/updatedAt cấp product/segment là MỚI (JSON cũ không có) — giá trị gia tăng để truy
 *   vết "block/segment tạo lúc nào". Import set từ job.createdAt nếu thiếu.
 */
import {
  mysqlTable,
  varchar,
  int,
  text,
  mediumtext,
  datetime,
  json,
  mysqlEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import type {
  ConcatState,
  FlowStatusCache,
  VeoModel,
} from '../../types';

const VEO_MODELS = [
  'veo_3_1_quality',
  'veo_3_1_fast',
  'veo_3_1_lite',
  'veo_3_1_lite_low_priority',
  'abra',
] as const;

const ASPECT_RATIOS = ['9:16', '16:9'] as const;

export const livestreamJobs = mysqlTable('livestream_jobs', {
  id: varchar('id', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 512 }).notNull(),
  createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
  updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
  aspectRatio: mysqlEnum('aspect_ratio', ASPECT_RATIOS).notNull(),
  veoModel: mysqlEnum('veo_model', VEO_MODELS).notNull(),
  chaining: mysqlEnum('chaining', ['off', 'per_product', 'continuous']).notNull(),
  status: mysqlEnum('status', [
    'draft',
    'scripting',
    'generating',
    'concatenating',
    'done',
    'failed',
  ]).notNull(),
  // Kho ảnh + ảnh chọn + map URL R2: gom vào JSON cho gọn (mảng string / Record<string,string|null>).
  spokespersonImagePaths: json('spokesperson_image_paths').$type<string[]>().notNull(),
  selectedRefImagePaths: json('selected_ref_image_paths').$type<string[]>().notNull(),
  selectedModelImagePath: varchar('selected_model_image_path', { length: 1024 }),
  backgroundImagePaths: json('background_image_paths').$type<string[]>().notNull(),
  selectedBackgroundImagePath: varchar('selected_background_image_path', { length: 1024 }),
  imageR2Urls: json('image_r2_urls').$type<Record<string, string | null>>().notNull(),
  // Cache mediaId Flow đã upload cho từng ảnh (key=relPath) — tránh upload trùng, xem types.ts.
  flowMediaIds: json('flow_media_ids').$type<Record<string, string>>().notNull(),
  concat: json('concat').$type<ConcatState>().notNull(),
  flowStatusCache: json('flow_status_cache').$type<FlowStatusCache>().notNull(),
  flowProjectId: varchar('flow_project_id', { length: 255 }),
  scriptSystemPromptOverride: mediumtext('script_system_prompt_override'),
  // Seed cố định dùng chung MỌI lần gen video của job (thay vì random mỗi đoạn) để giữ giọng/hình
  // ổn định hơn giữa các đoạn — xem ensureJobVideoSeed ở jobStore.ts. null = chưa gen lần nào.
  videoSeed: int('video_seed'),
});

export const livestreamProducts = mysqlTable(
  'livestream_products',
  {
    // Surrogate PK autoincrement; productKey giữ id gốc dạng slug (chỉ unique trong job).
    rowId: int('row_id').autoincrement().primaryKey(),
    jobId: varchar('job_id', { length: 128 }).notNull(),
    productKey: varchar('product_key', { length: 191 }).notNull(),
    order: int('order').notNull(),
    sourceType: mysqlEnum('source_type', ['link', 'file_text', 'file_image', 'manual']).notNull(),
    sourceLink: text('source_link'),
    sourceFilePath: varchar('source_file_path', { length: 1024 }),
    rawText: mediumtext('raw_text'),
    ingestStatus: mysqlEnum('ingest_status', [
      'pending',
      'fetched',
      'needs_manual',
      'ready',
      'failed',
    ]).notNull(),
    ingestError: text('ingest_error'),
    name: varchar('name', { length: 512 }).notNull(),
    description: mediumtext('description').notNull(),
    targetDurationSec: int('target_duration_sec').notNull(),
    scriptStatus: mysqlEnum('script_status', ['idle', 'generating', 'done', 'failed']).notNull(),
    scriptError: text('script_error'),
    createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
  },
  (t) => ({
    jobIdx: index('idx_products_job_order').on(t.jobId, t.order),
    jobKeyUnique: uniqueIndex('uq_products_job_key').on(t.jobId, t.productKey),
  })
);

export const livestreamSegments = mysqlTable(
  'livestream_segments',
  {
    rowId: int('row_id').autoincrement().primaryKey(),
    productRowId: int('product_row_id').notNull(),
    // Denormalize job_id vì `order` là thứ tự tuyệt đối TOÀN JOB (dùng khi concat xuyên product).
    jobId: varchar('job_id', { length: 128 }).notNull(),
    segmentKey: varchar('segment_key', { length: 191 }).notNull(),
    order: int('order').notNull(),
    voiceoverVi: mediumtext('voiceover_vi').notNull(),
    veoPrompt: mediumtext('veo_prompt').notNull(),
    duration: int('duration').notNull(),
    status: mysqlEnum('status', ['idle', 'generating', 'done', 'failed']).notNull(),
    flowJobId: varchar('flow_job_id', { length: 255 }),
    videoPath: varchar('video_path', { length: 1024 }),
    videoUrl: varchar('video_url', { length: 2048 }),
    lastFramePath: varchar('last_frame_path', { length: 1024 }),
    error: text('error'),
    attempts: int('attempts').notNull().default(0),
    lastUpdatedAt: datetime('last_updated_at', { fsp: 3, mode: 'string' }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
  },
  (t) => ({
    jobIdx: index('idx_segments_job_order').on(t.jobId, t.order),
    productIdx: index('idx_segments_product').on(t.productRowId),
    productKeyUnique: uniqueIndex('uq_segments_product_key').on(t.productRowId, t.segmentKey),
  })
);

export type VeoModelType = VeoModel;
