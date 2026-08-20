/**
 * Store project — ruột đã chuyển từ file JSON sang MariaDB (Drizzle). Cùng pattern với
 * lib/livestream/jobStore.ts.
 *
 * Public API GIỮ NGUYÊN chữ ký (readProject/writeProject/updateProject/listProjects/
 * ensureProjectFlowId...). Bên trong: SELECT projects + scenes + storyboard_images rồi
 * assemble lại nested Project; ghi thì tách ra 3 bảng, diff INSERT/UPDATE/DELETE trong 1
 * transaction có SELECT ... FOR UPDATE chống lost-update.
 *
 * NGOẠI LỆ chữ ký: projectExists cũ sync (existsSync) → nay async (SELECT 1).
 *
 * Thư mục media (createProjectDirs / ensureDataRoot) GIỮ NGUYÊN — ảnh/video vẫn ở disk/R2.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { getDb } from '../db/client';
import * as schema from '../db/schema';
import { isoToSql, sqlToIso } from '../db/datetime';
import { DATA_ROOT } from '../constants';
import { projectDir, assertValidProjectId } from '../paths';
import { resolveFlowProjectIdSafe } from '../googleFlow/flowJobs';
import type {
  Project,
  ProjectSummary,
  Scene,
  SceneStatus,
  StoryboardImage,
  StoryboardStatus,
  Template,
  ProductInfo,
  ProjectInputs,
  MusicConfig,
  ConcatState,
  FlowStatusCache,
  VeoModel,
} from '../types';

type Db = MySql2Database<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const { projects, scenes, storyboardImages } = schema;

function nowIso(): string {
  return new Date().toISOString();
}

// ------------------------------------------------------------------
// Assemble: row DB → Project lồng đầy đủ (khớp boundary cũ).
// ------------------------------------------------------------------

type ProjectRow = typeof projects.$inferSelect;
type SceneRow = typeof scenes.$inferSelect;
type StoryboardRow = typeof storyboardImages.$inferSelect;

function assembleScene(row: SceneRow): Scene {
  return {
    id: row.sceneKey,
    order: row.order,
    label: row.label,
    duration: row.duration,
    camera: row.camera,
    type: row.type ?? undefined,
    voiceoverVi: row.voiceoverVi,
    onScreenText: row.onScreenText,
    veoPrompt: row.veoPrompt,
    negativePrompt: row.negativePrompt,
    status: row.status as SceneStatus,
    jobId: row.flowJobId,
    videoPath: row.videoPath,
    videoUrl: row.videoUrl,
    error: row.error,
    attempts: row.attempts,
    lastUpdatedAt: sqlToIso(row.lastUpdatedAt),
    lastFramePath: row.lastFramePath,
    chainedFromPrevious: row.chainedFromPrevious,
  };
}

function assembleStoryboardImage(row: StoryboardRow): StoryboardImage {
  return {
    sceneId: row.sceneId,
    order: row.order,
    prompt: row.prompt,
    imagePath: row.imagePath,
    imageUrl: row.imageUrl,
    status: row.status as StoryboardStatus,
    error: row.error,
    attempts: row.attempts,
    lastUpdatedAt: sqlToIso(row.lastUpdatedAt),
  };
}

function assembleProject(
  row: ProjectRow,
  sceneRows: SceneRow[],
  storyboardRows: StoryboardRow[]
): Project {
  const sortedScenes = [...sceneRows].sort((a, b) => a.order - b.order).map(assembleScene);
  const images = storyboardRows
    .filter((r) => r.kind === 'image')
    .sort((a, b) => a.order - b.order)
    .map(assembleStoryboardImage);
  const backgrounds = storyboardRows
    .filter((r) => r.kind === 'background')
    .sort((a, b) => a.order - b.order)
    .map(assembleStoryboardImage);

  return {
    id: row.id,
    name: row.name,
    createdAt: sqlToIso(row.createdAt) ?? row.createdAt,
    updatedAt: sqlToIso(row.updatedAt) ?? row.updatedAt,
    currentStep: row.currentStep,
    aspectRatio: row.aspectRatio as '9:16' | '16:9',
    veoModel: row.veoModel as VeoModel,
    sceneChaining: row.sceneChaining,
    burnOnScreenText: row.burnOnScreenText,
    flowProjectId: row.flowProjectId,
    template: row.template,
    product: row.product,
    inputs: row.inputs,
    storyboard: {
      model: row.storyboardModel,
      useProductReference: row.storyboardUseProductReference,
      productReferenceImagePath: row.storyboardProductImagePath ?? null,
      useSpokespersonReference: row.storyboardUseSpokespersonReference,
      images,
      backgrounds,
    },
    script: {
      totalDuration: row.scriptTotalDuration,
      aspectRatio: row.scriptAspectRatio as '9:16' | '16:9',
      scenes: sortedScenes,
    },
    scriptAngleId: row.scriptAngleId,
    music: row.music,
    concat: row.concat,
    flowStatusCache: row.flowStatusCache,
  };
}

// ------------------------------------------------------------------
// Tách: Project → giá trị cột projects (dùng khi INSERT/UPDATE).
// ------------------------------------------------------------------

function projectToRow(project: Project): typeof projects.$inferInsert {
  return {
    id: project.id,
    name: project.name,
    createdAt: isoToSql(project.createdAt) ?? project.createdAt,
    updatedAt: isoToSql(project.updatedAt) ?? project.updatedAt,
    currentStep: project.currentStep,
    aspectRatio: project.aspectRatio,
    veoModel: project.veoModel,
    sceneChaining: project.sceneChaining,
    burnOnScreenText: project.burnOnScreenText,
    flowProjectId: project.flowProjectId ?? null,
    scriptAngleId: project.scriptAngleId ?? null,
    template: project.template as Template,
    product: project.product as ProductInfo,
    inputs: project.inputs as ProjectInputs,
    music: project.music as MusicConfig,
    concat: project.concat as ConcatState,
    flowStatusCache: project.flowStatusCache as FlowStatusCache,
    storyboardModel: project.storyboard.model,
    storyboardUseProductReference: project.storyboard.useProductReference,
    storyboardProductImagePath: project.storyboard.productReferenceImagePath ?? null,
    storyboardUseSpokespersonReference: project.storyboard.useSpokespersonReference,
    scriptTotalDuration: project.script.totalDuration,
    scriptAspectRatio: project.script.aspectRatio,
  };
}

// ------------------------------------------------------------------
// Đọc
// ------------------------------------------------------------------

export async function readProject(projectId: string): Promise<Project> {
  assertValidProjectId(projectId);
  const db = getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`Project không tồn tại: ${projectId}`);
  }
  const sceneRows = await db.select().from(scenes).where(eq(scenes.projectId, projectId));
  const storyboardRows = await db
    .select()
    .from(storyboardImages)
    .where(eq(storyboardImages.projectId, projectId));
  return assembleProject(row, sceneRows, storyboardRows);
}

/** Kiểm tra project tồn tại (async — cũ là sync existsSync). Mọi call-site cần thêm await. */
export async function projectExists(projectId: string): Promise<boolean> {
  try {
    assertValidProjectId(projectId);
  } catch {
    return false;
  }
  const db = getDb();
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows.length > 0;
}

// ------------------------------------------------------------------
// Ghi (diff nested arrays trong transaction)
// ------------------------------------------------------------------

async function persistProject(tx: Tx, project: Project): Promise<void> {
  project.updatedAt = nowIso();

  // 1) Upsert projects.
  const row = projectToRow(project);
  await tx
    .insert(projects)
    .values(row)
    .onDuplicateKeyUpdate({ set: { ...row, id: sql`id` } });

  const nowStamp = isoToSql(nowIso())!;
  await persistScenes(tx, project.id, project.script.scenes, nowStamp);
  await persistStoryboard(tx, project.id, project.storyboard.images, project.storyboard.backgrounds);
}

/** Diff scenes theo sceneKey: INSERT/UPDATE/DELETE. */
async function persistScenes(
  tx: Tx,
  projectId: string,
  sceneList: Scene[],
  nowStamp: string
): Promise<void> {
  const existing = await tx
    .select({ rowId: scenes.rowId, sceneKey: scenes.sceneKey })
    .from(scenes)
    .where(eq(scenes.projectId, projectId));
  const rowIdByKey = new Map(existing.map((s) => [s.sceneKey, s.rowId]));
  const keepKeys = new Set(sceneList.map((s) => s.id));

  const removedRowIds = existing
    .filter((s) => !keepKeys.has(s.sceneKey))
    .map((s) => s.rowId);
  if (removedRowIds.length > 0) {
    await tx.delete(scenes).where(inArray(scenes.rowId, removedRowIds));
  }

  for (const scene of sceneList) {
    const values = {
      projectId,
      sceneKey: scene.id,
      order: scene.order,
      label: scene.label,
      duration: scene.duration,
      camera: scene.camera,
      type: scene.type ?? null,
      voiceoverVi: scene.voiceoverVi,
      onScreenText: scene.onScreenText,
      veoPrompt: scene.veoPrompt,
      negativePrompt: scene.negativePrompt,
      status: scene.status,
      flowJobId: scene.jobId ?? null,
      videoPath: scene.videoPath ?? null,
      videoUrl: scene.videoUrl ?? null,
      error: scene.error ?? null,
      attempts: scene.attempts,
      lastUpdatedAt: isoToSql(scene.lastUpdatedAt),
      lastFramePath: scene.lastFramePath ?? null,
      chainedFromPrevious: scene.chainedFromPrevious,
      updatedAt: nowStamp,
    };
    const rowId = rowIdByKey.get(scene.id);
    if (rowId === undefined) {
      await tx.insert(scenes).values({ ...values, createdAt: nowStamp });
    } else {
      await tx.update(scenes).set(values).where(eq(scenes.rowId, rowId));
    }
  }
}

/**
 * Ghi lại storyboard_images (images[] + backgrounds[]). Vì bảng KHÔNG có key ổn định
 * (sceneId có thể lệch/trùng sau chỉnh tay), ta thay bằng chiến lược REPLACE toàn bộ theo
 * project: xóa hết rồi chèn lại — đơn giản, đúng, và số dòng nhỏ (vài scene/project).
 */
async function persistStoryboard(
  tx: Tx,
  projectId: string,
  images: StoryboardImage[],
  backgrounds: StoryboardImage[]
): Promise<void> {
  await tx.delete(storyboardImages).where(eq(storyboardImages.projectId, projectId));

  const rowsToInsert: (typeof storyboardImages.$inferInsert)[] = [];
  images.forEach((img, i) => {
    rowsToInsert.push({
      projectId,
      kind: 'image',
      sceneId: img.sceneId,
      order: img.order ?? i + 1,
      prompt: img.prompt,
      imagePath: img.imagePath ?? null,
      imageUrl: img.imageUrl ?? null,
      status: img.status,
      error: img.error ?? null,
      attempts: img.attempts,
      lastUpdatedAt: isoToSql(img.lastUpdatedAt),
    });
  });
  backgrounds.forEach((bg, i) => {
    rowsToInsert.push({
      projectId,
      kind: 'background',
      sceneId: bg.sceneId,
      order: bg.order ?? i + 1,
      prompt: bg.prompt,
      imagePath: bg.imagePath ?? null,
      imageUrl: bg.imageUrl ?? null,
      status: bg.status,
      error: bg.error ?? null,
      attempts: bg.attempts,
      lastUpdatedAt: isoToSql(bg.lastUpdatedAt),
    });
  });
  if (rowsToInsert.length > 0) {
    await tx.insert(storyboardImages).values(rowsToInsert);
  }
}

export async function writeProject(project: Project): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await persistProject(tx, project);
  });
}

/** Đọc → sửa → ghi nguyên tử trong 1 transaction (SELECT ... FOR UPDATE khóa row project). */
export async function updateProject<T = void>(
  projectId: string,
  mutator: (project: Project) => T | Promise<T>
): Promise<{ project: Project; result: T }> {
  assertValidProjectId(projectId);
  const db = getDb();
  return db.transaction(async (tx) => {
    const lockedRows = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update')
      .limit(1);
    const row = lockedRows[0];
    if (!row) {
      throw new Error(`Project không tồn tại: ${projectId}`);
    }
    const sceneRows = await tx.select().from(scenes).where(eq(scenes.projectId, projectId));
    const storyboardRows = await tx
      .select()
      .from(storyboardImages)
      .where(eq(storyboardImages.projectId, projectId));
    const project = assembleProject(row, sceneRows, storyboardRows);

    const result = await mutator(project);
    await persistProject(tx, project);
    return { project, result };
  });
}

/**
 * Trả về flowProjectId hiện có của project, hoặc tạo mới (qua flow_create_project) và
 * lưu lại nếu chưa có — dùng làm fallback khi bước gán sớm lúc tạo project đã thất bại.
 * Không throw khi Flow không kết nối được — trả về null.
 */
export async function ensureProjectFlowId(projectId: string): Promise<string | null> {
  const project = await readProject(projectId);
  if (project.flowProjectId) return project.flowProjectId;

  const flowProjectId = await resolveFlowProjectIdSafe(project.name);
  if (!flowProjectId) return null;

  const { project: updated } = await updateProject(projectId, (p) => {
    if (!p.flowProjectId) p.flowProjectId = flowProjectId;
  });
  return updated.flowProjectId;
}

// ------------------------------------------------------------------
// Thư mục media — GIỮ NGUYÊN (không đụng đến DB)
// ------------------------------------------------------------------

export async function ensureDataRoot(): Promise<void> {
  await fs.mkdir(DATA_ROOT, { recursive: true });
}

/** Danh sách project (1 query JOIN scenes + tổng hợp) thay vì đọc mọi file JSON. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = getDb();
  const projectRows = await db.select().from(projects);
  if (projectRows.length === 0) return [];

  // Lấy scenes 1 lần cho toàn bộ project để tính sceneCount/promptReadyCount/hasGeneratingScene.
  const ids = projectRows.map((p) => p.id);
  const sceneRows = await db
    .select({
      projectId: scenes.projectId,
      veoPrompt: scenes.veoPrompt,
      status: scenes.status,
    })
    .from(scenes)
    .where(inArray(scenes.projectId, ids));

  const byProject = new Map<string, { count: number; promptReady: number; generating: boolean }>();
  for (const s of sceneRows) {
    const agg = byProject.get(s.projectId) || { count: 0, promptReady: 0, generating: false };
    agg.count += 1;
    if (s.veoPrompt.trim().length > 0) agg.promptReady += 1;
    if (s.status === 'generating') agg.generating = true;
    byProject.set(s.projectId, agg);
  }

  const summaries: ProjectSummary[] = projectRows.map((p) => {
    const agg = byProject.get(p.id) || { count: 0, promptReady: 0, generating: false };
    return {
      id: p.id,
      name: p.name,
      createdAt: sqlToIso(p.createdAt) ?? p.createdAt,
      updatedAt: sqlToIso(p.updatedAt) ?? p.updatedAt,
      currentStep: p.currentStep,
      aspectRatio: p.aspectRatio as '9:16' | '16:9',
      productName: (p.product as ProductInfo).name,
      scriptAngleId: p.scriptAngleId,
      sceneCount: agg.count,
      promptReadyCount: agg.promptReady,
      hasGeneratingScene: agg.generating,
    };
  });
  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return summaries;
}

/** Xóa row project + scenes + storyboard_images (media dir do call-site tự fs.rm riêng). */
export async function deleteProject(projectId: string): Promise<void> {
  assertValidProjectId(projectId);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(scenes).where(eq(scenes.projectId, projectId));
    await tx.delete(storyboardImages).where(eq(storyboardImages.projectId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}

export async function createProjectDirs(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  await fs.mkdir(path.join(dir, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'scenes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'tmp'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'frames'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'storyboard'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'backgrounds'), { recursive: true });
}
