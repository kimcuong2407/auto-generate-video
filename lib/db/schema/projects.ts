/**
 * Schema Drizzle nhóm Projects: project → scene (1 tầng) + storyboard_images.
 *
 * Khác nhóm livestream: phân cấp 1 tầng (project → scene), có nhiều object cấu hình đầu vào
 * (template/product/inputs/music/storyboard-meta) → dồn vào JSON column vì thuần cấu hình, ít
 * query lẻ. Scene và StoryboardImage tách bảng riêng vì cần query/cập nhật per-item khi gen video/ảnh.
 */
import {
  mysqlTable,
  varchar,
  int,
  boolean,
  text,
  mediumtext,
  datetime,
  mysqlEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import type {
  Template,
  ProductInfo,
  ProjectInputs,
  MusicConfig,
  ConcatState,
  FlowStatusCache,
  VeoModel,
} from '../../types';
import { mariaJson } from './mariaJson';

const VEO_MODELS = [
  'veo_3_1_quality',
  'veo_3_1_fast',
  'veo_3_1_lite',
  'veo_3_1_lite_low_priority',
  'abra',
] as const;

const ASPECT_RATIOS = ['9:16', '16:9'] as const;

export const projects = mysqlTable('projects', {
  id: varchar('id', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 512 }).notNull(),
  createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
  updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
  currentStep: int('current_step').notNull(),
  aspectRatio: mysqlEnum('aspect_ratio', ASPECT_RATIOS).notNull(),
  veoModel: mysqlEnum('veo_model', VEO_MODELS).notNull(),
  sceneChaining: boolean('scene_chaining').notNull(),
  burnOnScreenText: boolean('burn_on_screen_text').notNull(),
  flowProjectId: varchar('flow_project_id', { length: 255 }),
  scriptAngleId: varchar('script_angle_id', { length: 255 }),
  // Cấu hình đầu vào + trạng thái tổng hợp → JSON.
  template: mariaJson('template').$type<Template>().notNull(),
  product: mariaJson('product').$type<ProductInfo>().notNull(),
  inputs: mariaJson('inputs').$type<ProjectInputs>().notNull(),
  music: mariaJson('music').$type<MusicConfig>().notNull(),
  concat: mariaJson('concat').$type<ConcatState>().notNull(),
  flowStatusCache: mariaJson('flow_status_cache').$type<FlowStatusCache>().notNull(),
  // Storyboard meta (model + 2 cờ dùng ref) — ảnh tách bảng storyboard_images.
  storyboardModel: varchar('storyboard_model', { length: 128 }).notNull(),
  storyboardUseProductReference: boolean('storyboard_use_product_reference').notNull(),
  storyboardUseSpokespersonReference: boolean('storyboard_use_spokesperson_reference').notNull(),
  // Script meta (totalDuration + aspectRatio) — scenes tách bảng scenes.
  scriptTotalDuration: int('script_total_duration').notNull(),
  scriptAspectRatio: mysqlEnum('script_aspect_ratio', ASPECT_RATIOS).notNull(),
});

export const scenes = mysqlTable(
  'scenes',
  {
    rowId: int('row_id').autoincrement().primaryKey(),
    projectId: varchar('project_id', { length: 128 }).notNull(),
    sceneKey: varchar('scene_key', { length: 191 }).notNull(),
    order: int('order').notNull(),
    label: varchar('label', { length: 512 }).notNull(),
    duration: int('duration').notNull(),
    camera: text('camera').notNull(),
    type: varchar('type', { length: 128 }),
    voiceoverVi: mediumtext('voiceover_vi').notNull(),
    onScreenText: mediumtext('on_screen_text').notNull(),
    veoPrompt: mediumtext('veo_prompt').notNull(),
    negativePrompt: mediumtext('negative_prompt').notNull(),
    status: mysqlEnum('status', ['idle', 'queued', 'generating', 'done', 'failed']).notNull(),
    flowJobId: varchar('flow_job_id', { length: 255 }),
    videoPath: varchar('video_path', { length: 1024 }),
    videoUrl: varchar('video_url', { length: 2048 }),
    error: text('error'),
    attempts: int('attempts').notNull().default(0),
    lastUpdatedAt: datetime('last_updated_at', { fsp: 3, mode: 'string' }),
    lastFramePath: varchar('last_frame_path', { length: 1024 }),
    chainedFromPrevious: boolean('chained_from_previous').notNull().default(false),
    createdAt: datetime('created_at', { fsp: 3, mode: 'string' }).notNull(),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'string' }).notNull(),
  },
  (t) => ({
    projectIdx: index('idx_scenes_project_order').on(t.projectId, t.order),
    projectKeyUnique: uniqueIndex('uq_scenes_project_key').on(t.projectId, t.sceneKey),
  })
);

export const storyboardImages = mysqlTable(
  'storyboard_images',
  {
    rowId: int('row_id').autoincrement().primaryKey(),
    projectId: varchar('project_id', { length: 128 }).notNull(),
    // Gộp images[] + backgrounds[] vào 1 bảng, phân biệt bằng kind.
    kind: mysqlEnum('kind', ['image', 'background']).notNull(),
    // sceneId khớp Scene.id (mềm, có thể lệch sau chỉnh tay) — không đặt FK cứng.
    sceneId: varchar('scene_id', { length: 191 }).notNull(),
    order: int('order').notNull(),
    prompt: mediumtext('prompt').notNull(),
    imagePath: varchar('image_path', { length: 1024 }),
    status: mysqlEnum('status', ['idle', 'generating', 'done', 'failed']).notNull(),
    error: text('error'),
    attempts: int('attempts').notNull().default(0),
    lastUpdatedAt: datetime('last_updated_at', { fsp: 3, mode: 'string' }),
  },
  (t) => ({
    projectKindIdx: index('idx_storyboard_project_kind_order').on(t.projectId, t.kind, t.order),
  })
);

export type ProjectVeoModel = VeoModel;
