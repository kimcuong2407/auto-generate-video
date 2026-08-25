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
  bigint,
  text,
  mediumtext,
  datetime,
  mysqlEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import type {
  ConcatState,
  FlowStatusCache,
  VeoModel,
} from '../../types';
import type { LivestreamStageBible } from '../../livestream/types';
import { mariaJson } from './mariaJson';

const VEO_MODELS = [
  'veo_3_1_quality',
  'veo_3_1_fast',
  'veo_3_1_lite',
  'veo_3_1_lite_low_priority',
  'abra',
] as const;

const ASPECT_RATIOS = ['9:16', '16:9'] as const;

export const livestreamJobs = mysqlTable(
  'livestream_jobs',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // Slug public (dùng làm tên thư mục filesystem + R2 object key) — giữ nguyên định danh cũ.
    slug: varchar('slug', { length: 191 }).notNull(),
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
  spokespersonImagePaths: mariaJson('spokesperson_image_paths').$type<string[]>().notNull(),
  selectedRefImagePaths: mariaJson('selected_ref_image_paths').$type<string[]>().notNull(),
  selectedModelImagePath: varchar('selected_model_image_path', { length: 1024 }),
  backgroundImagePaths: mariaJson('background_image_paths').$type<string[]>().notNull(),
  selectedBackgroundImagePath: varchar('selected_background_image_path', { length: 1024 }),
  // Model ảnh dùng khi gen background bằng AI — default cho ALTER TABLE trên bảng đã có data.
  backgroundModel: varchar('background_model', { length: 128 }).notNull().default('chatgpt-web/gpt-5.5'),
  imageR2Urls: mariaJson('image_r2_urls').$type<Record<string, string | null>>().notNull(),
  // Cache mediaId Flow đã upload cho từng ảnh (key=relPath) — tránh upload trùng, xem types.ts.
  flowMediaIds: mariaJson('flow_media_ids').$type<Record<string, string>>().notNull(),
  concat: mariaJson('concat').$type<ConcatState>().notNull(),
  flowStatusCache: mariaJson('flow_status_cache').$type<FlowStatusCache>().notNull(),
  flowProjectId: varchar('flow_project_id', { length: 255 }),
  scriptSystemPromptOverride: mediumtext('script_system_prompt_override'),
  // Seed cố định dùng chung MỌI lần gen video của job (thay vì random mỗi đoạn) để giữ giọng/hình
  // ổn định hơn giữa các đoạn — xem ensureJobVideoSeed ở jobStore.ts. null = chưa gen lần nào.
  videoSeed: int('video_seed'),
  // Sân khấu cố định (người dẫn/bối cảnh/góc máy/giọng) dùng chung MỌI sản phẩm trong job — chốt
  // 1 lần để nhiều sản phẩm vẫn ra 1 buổi live thống nhất, xem lib/livestream/stageBible.ts.
  stageBible: mariaJson('stage_bible').$type<LivestreamStageBible | null>(),
  },
  (t) => ({
    slugUnique: uniqueIndex('uq_jobs_slug').on(t.slug),
  })
);

export const livestreamProducts = mysqlTable(
  'livestream_products',
  {
    // Surrogate PK autoincrement; productKey giữ id gốc dạng slug (chỉ unique trong job).
    rowId: int('row_id').autoincrement().primaryKey(),
    jobId: bigint('job_id', { mode: 'number', unsigned: true }).notNull(),
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
    jobId: bigint('job_id', { mode: 'number', unsigned: true }).notNull(),
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

/** Gộp nhiều job (đã ghép video xong) thành 1 video liên tục — chỉ là list slug + 1 ConcatState. */
export const livestreamMerges = mysqlTable(
  'livestream_merges',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    slug: varchar('slug', { length: 191 }).notNull(),
    name: varchar('name', { length: 512 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
    jobSlugs: mariaJson('job_slugs').$type<string[]>().notNull(),
    concat: mariaJson('concat').$type<ConcatState>().notNull(),
  },
  (t) => ({
    slugUnique: uniqueIndex('uq_merges_slug').on(t.slug),
  })
);

export type VeoModelType = VeoModel;
