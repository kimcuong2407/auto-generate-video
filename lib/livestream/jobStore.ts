/**
 * Store livestream — ruột đã chuyển từ file JSON sang MariaDB (Drizzle).
 *
 * Public API GIỮ NGUYÊN chữ ký cũ (readJob/writeJob/updateJob/listJobs/ensureJobFlowId...) để
 * hàng chục call-site ở app/api/** và lib/** không phải sửa logic — chỉ đọc/ghi object
 * LivestreamJob lồng đầy đủ như trước. Bên trong: SELECT 3 bảng rồi assemble lại nested object;
 * ghi thì tách ra job + products + segments, diff INSERT/UPDATE/DELETE trong 1 transaction.
 *
 * NGOẠI LỆ chữ ký: jobExists cũ là sync (existsSync) → nay async (SELECT 1) vì DB I/O.
 *
 * Chống lost-update: thay write-queue in-memory bằng transaction + SELECT ... FOR UPDATE
 * (an toàn cả khi chạy nhiều process PM2, khác hẳn queue cũ chỉ đúng trong 1 process).
 *
 * Thư mục media (createJobDirs / ensureLivestreamDataRoot) GIỮ NGUYÊN — ảnh/video vẫn ở disk/R2,
 * DB chỉ lưu đường dẫn/URL.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { getDb } from '../db/client';
import * as schema from '../db/schema';
import { isoToSql, sqlToIso } from '../db/datetime';
import { LIVESTREAM_DATA_ROOT } from './constants';
import { jobDir, assertValidJobId } from './paths';
import { resolveFlowProjectIdSafe } from '../googleFlow/flowJobs';
import type {
  ConcatState,
  FlowStatusCache,
  VeoModel,
} from '../types';
import type {
  LivestreamJob,
  LivestreamJobSummary,
  LivestreamJobStatus,
  LivestreamProduct,
  LivestreamSegment,
  LivestreamChaining,
  ProductSourceType,
  IngestStatus,
  ScriptStatus,
  SegmentStatus,
} from './types';

type Db = MySql2Database<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const { livestreamJobs, livestreamProducts, livestreamSegments } = schema;

function nowIso(): string {
  return new Date().toISOString();
}

// ------------------------------------------------------------------
// Assemble: row DB → object LivestreamJob lồng đầy đủ (khớp boundary cũ).
// ------------------------------------------------------------------

type JobRow = typeof livestreamJobs.$inferSelect;
type ProductRow = typeof livestreamProducts.$inferSelect;
type SegmentRow = typeof livestreamSegments.$inferSelect;

function assembleSegment(row: SegmentRow): LivestreamSegment {
  return {
    id: row.segmentKey,
    order: row.order,
    voiceoverVi: row.voiceoverVi,
    veoPrompt: row.veoPrompt,
    duration: row.duration,
    status: row.status as SegmentStatus,
    jobId: row.flowJobId,
    videoPath: row.videoPath,
    videoUrl: row.videoUrl,
    lastFramePath: row.lastFramePath,
    error: row.error,
    attempts: row.attempts,
    lastUpdatedAt: sqlToIso(row.lastUpdatedAt),
  };
}

function assembleProduct(row: ProductRow, segments: LivestreamSegment[]): LivestreamProduct {
  return {
    id: row.productKey,
    order: row.order,
    sourceType: row.sourceType as ProductSourceType,
    sourceLink: row.sourceLink,
    sourceFilePath: row.sourceFilePath,
    rawText: row.rawText,
    ingestStatus: row.ingestStatus as IngestStatus,
    ingestError: row.ingestError,
    name: row.name,
    description: row.description,
    targetDurationSec: row.targetDurationSec,
    scriptStatus: row.scriptStatus as ScriptStatus,
    scriptError: row.scriptError,
    segments,
  };
}

function assembleJob(
  jobRow: JobRow,
  productRows: ProductRow[],
  segmentRows: SegmentRow[]
): LivestreamJob {
  // Nhóm segment theo productRowId, sắp theo order tuyệt đối toàn job.
  const segsByProduct = new Map<number, SegmentRow[]>();
  for (const seg of segmentRows) {
    const list = segsByProduct.get(seg.productRowId) || [];
    list.push(seg);
    segsByProduct.set(seg.productRowId, list);
  }
  const products = [...productRows]
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const segs = (segsByProduct.get(p.rowId) || [])
        .sort((a, b) => a.order - b.order)
        .map(assembleSegment);
      return assembleProduct(p, segs);
    });

  return {
    id: jobRow.slug,
    slug: jobRow.slug,
    name: jobRow.name,
    createdAt: sqlToIso(jobRow.createdAt) ?? jobRow.createdAt,
    updatedAt: sqlToIso(jobRow.updatedAt) ?? jobRow.updatedAt,
    aspectRatio: jobRow.aspectRatio as '9:16' | '16:9',
    veoModel: jobRow.veoModel as VeoModel,
    chaining: jobRow.chaining as LivestreamChaining,
    status: jobRow.status as LivestreamJobStatus,
    products,
    spokespersonImagePaths: jobRow.spokespersonImagePaths,
    selectedRefImagePaths: jobRow.selectedRefImagePaths,
    selectedModelImagePath: jobRow.selectedModelImagePath,
    backgroundImagePaths: jobRow.backgroundImagePaths,
    selectedBackgroundImagePath: jobRow.selectedBackgroundImagePath,
    // null = job tạo trước khi có cột này → chưa tách ảnh nào.
    detachedImagePaths: jobRow.detachedImagePaths ?? [],
    backgroundModel: jobRow.backgroundModel,
    imageR2Urls: jobRow.imageR2Urls,
    flowMediaIds: jobRow.flowMediaIds,
    concat: jobRow.concat,
    flowStatusCache: jobRow.flowStatusCache,
    flowProjectId: jobRow.flowProjectId,
    scriptSystemPromptOverride: jobRow.scriptSystemPromptOverride,
    backgroundPromptOverride: jobRow.backgroundPromptOverride,
    // Cột nullable (ALTER TABLE trên bảng đã có data) — null coi như "chưa chọn", để server tự chọn.
    backgroundRefPaths: jobRow.backgroundRefPaths ?? [],
    scriptRefPaths: jobRow.scriptRefPaths ?? [],
    videoSeed: jobRow.videoSeed,
    stageBible: jobRow.stageBible ?? null,
  };
}

// ------------------------------------------------------------------
// Tách: object LivestreamJob → giá trị cột (dùng khi INSERT/UPDATE).
// ------------------------------------------------------------------

function jobToRow(job: LivestreamJob): Omit<typeof livestreamJobs.$inferInsert, 'id'> {
  return {
    slug: job.slug,
    name: job.name,
    createdAt: isoToSql(job.createdAt) ?? job.createdAt,
    updatedAt: isoToSql(job.updatedAt) ?? job.updatedAt,
    aspectRatio: job.aspectRatio,
    veoModel: job.veoModel,
    chaining: job.chaining,
    status: job.status,
    spokespersonImagePaths: job.spokespersonImagePaths ?? [],
    selectedRefImagePaths: job.selectedRefImagePaths ?? [],
    selectedModelImagePath: job.selectedModelImagePath ?? null,
    backgroundImagePaths: job.backgroundImagePaths ?? [],
    selectedBackgroundImagePath: job.selectedBackgroundImagePath ?? null,
    detachedImagePaths: job.detachedImagePaths ?? [],
    backgroundModel: job.backgroundModel,
    imageR2Urls: job.imageR2Urls ?? {},
    flowMediaIds: job.flowMediaIds ?? {},
    concat: job.concat,
    flowStatusCache: job.flowStatusCache,
    flowProjectId: job.flowProjectId ?? null,
    scriptSystemPromptOverride: job.scriptSystemPromptOverride ?? null,
    backgroundPromptOverride: job.backgroundPromptOverride ?? null,
    backgroundRefPaths: job.backgroundRefPaths ?? [],
    scriptRefPaths: job.scriptRefPaths ?? [],
    videoSeed: job.videoSeed ?? null,
    stageBible: job.stageBible ?? null,
  };
}

// ------------------------------------------------------------------
// Đọc
// ------------------------------------------------------------------

/** Đọc 1 job + products + segments từ DB, assemble thành LivestreamJob lồng đầy đủ. */
export async function readJob(jobId: string): Promise<LivestreamJob> {
  assertValidJobId(jobId);
  const db = getDb();
  const jobRows = await db
    .select()
    .from(livestreamJobs)
    .where(eq(livestreamJobs.slug, jobId))
    .limit(1);
  const jobRow = jobRows[0];
  if (!jobRow) {
    throw new Error(`Livestream job không tồn tại: ${jobId}`);
  }
  const productRows = await db
    .select()
    .from(livestreamProducts)
    .where(eq(livestreamProducts.jobId, jobRow.id));
  const segmentRows = await db
    .select()
    .from(livestreamSegments)
    .where(eq(livestreamSegments.jobId, jobRow.id));
  return assembleJob(jobRow, productRows, segmentRows);
}

/** Kiểm tra job tồn tại (async — cũ là sync existsSync). Mọi call-site cần thêm await. */
export async function jobExists(jobId: string): Promise<boolean> {
  try {
    assertValidJobId(jobId);
  } catch {
    return false;
  }
  const db = getDb();
  const rows = await db
    .select({ id: livestreamJobs.id })
    .from(livestreamJobs)
    .where(eq(livestreamJobs.slug, jobId))
    .limit(1);
  return rows.length > 0;
}

// ------------------------------------------------------------------
// Ghi (diff nested arrays trong transaction)
// ------------------------------------------------------------------

/**
 * Ghi toàn bộ job vào DB trong 1 transaction, rồi diff products/segments để INSERT/UPDATE/DELETE.
 * updatedAt cấp job luôn được đặt = now (giữ ngữ nghĩa writeJobRaw cũ).
 *
 * existingDbId = null nghĩa là job MỚI (chưa có PK bigint) → INSERT không set `id` (autoincrement),
 * lấy insertId. existingDbId != null nghĩa là job đã tồn tại (đọc qua updateJob) → UPDATE where
 * id = existingDbId. Trả về PK bigint thật để caller dùng tiếp cho products/segments.
 */
async function persistJob(tx: Tx, job: LivestreamJob, existingDbId: number | null): Promise<number> {
  job.updatedAt = nowIso();
  const row = jobToRow(job);
  let dbId: number;

  if (existingDbId === null) {
    const [result] = await tx.insert(livestreamJobs).values(row);
    dbId = Number((result as unknown as { insertId: number }).insertId);
  } else {
    dbId = existingDbId;
    await tx.update(livestreamJobs).set(row).where(eq(livestreamJobs.id, dbId));
  }

  // 2) Products: đọc row hiện có (lấy rowId theo productKey) để diff.
  const existingProducts = await tx
    .select({
      rowId: livestreamProducts.rowId,
      productKey: livestreamProducts.productKey,
    })
    .from(livestreamProducts)
    .where(eq(livestreamProducts.jobId, dbId));
  const productRowIdByKey = new Map(existingProducts.map((p) => [p.productKey, p.rowId]));
  const keepProductKeys = new Set(job.products.map((p) => p.id));

  // Xóa product không còn (cascade tay: xóa segment của nó trước — không đặt FK cứng).
  const removedProductRowIds = existingProducts
    .filter((p) => !keepProductKeys.has(p.productKey))
    .map((p) => p.rowId);
  if (removedProductRowIds.length > 0) {
    await tx
      .delete(livestreamSegments)
      .where(inArray(livestreamSegments.productRowId, removedProductRowIds));
    await tx
      .delete(livestreamProducts)
      .where(inArray(livestreamProducts.rowId, removedProductRowIds));
  }

  // Dấu thời gian dùng cho created_at/updated_at cấp product/segment — đã ở dạng SQL DATETIME.
  const nowStamp = isoToSql(nowIso())!;

  // Batch upsert TOÀN BỘ products trong 1 câu (thay vì loop INSERT/UPDATE tuần tự từng cái —
  // với DB remote (~56ms RTT/query), N product = N+ round-trip khiến transaction giữ
  // FOR UPDATE lock quá lâu và dễ rớt kết nối giữa chừng, xem sự cố EPIPE/"Failed query: rollback").
  if (job.products.length > 0) {
    const productValuesList = job.products.map((product) => ({
      jobId: dbId,
      productKey: product.id,
      order: product.order,
      sourceType: product.sourceType,
      sourceLink: product.sourceLink ?? null,
      sourceFilePath: product.sourceFilePath ?? null,
      rawText: product.rawText ?? null,
      ingestStatus: product.ingestStatus,
      ingestError: product.ingestError ?? null,
      name: product.name,
      description: product.description,
      targetDurationSec: product.targetDurationSec,
      scriptStatus: product.scriptStatus,
      scriptError: product.scriptError ?? null,
      createdAt: nowStamp,
      updatedAt: nowStamp,
    }));
    await tx
      .insert(livestreamProducts)
      .values(productValuesList)
      .onDuplicateKeyUpdate({
        set: {
          order: sql`values(${livestreamProducts.order})`,
          sourceType: sql`values(${livestreamProducts.sourceType})`,
          sourceLink: sql`values(${livestreamProducts.sourceLink})`,
          sourceFilePath: sql`values(${livestreamProducts.sourceFilePath})`,
          rawText: sql`values(${livestreamProducts.rawText})`,
          ingestStatus: sql`values(${livestreamProducts.ingestStatus})`,
          ingestError: sql`values(${livestreamProducts.ingestError})`,
          name: sql`values(${livestreamProducts.name})`,
          description: sql`values(${livestreamProducts.description})`,
          targetDurationSec: sql`values(${livestreamProducts.targetDurationSec})`,
          scriptStatus: sql`values(${livestreamProducts.scriptStatus})`,
          scriptError: sql`values(${livestreamProducts.scriptError})`,
          updatedAt: sql`values(${livestreamProducts.updatedAt})`,
        },
      });
  }

  // Đọc lại rowId của mọi product (kể cả vừa insert) trong 1 câu duy nhất.
  const productRows = await tx
    .select({ rowId: livestreamProducts.rowId, productKey: livestreamProducts.productKey })
    .from(livestreamProducts)
    .where(eq(livestreamProducts.jobId, dbId));
  const productRowIdByKeyAfter = new Map(productRows.map((p) => [p.productKey, p.rowId]));

  await persistSegments(tx, dbId, job.products, productRowIdByKeyAfter, nowStamp);

  return dbId;
}

/** Batch upsert TOÀN BỘ segments của TOÀN BỘ product (1 câu) + xoá segment không còn tồn tại. */
async function persistSegments(
  tx: Tx,
  dbJobId: number,
  products: LivestreamJob['products'],
  productRowIdByKey: Map<string, number>,
  nowStamp: string
): Promise<void> {
  const productRowIds = products.map((p) => productRowIdByKey.get(p.id)!);

  const existing = await tx
    .select({
      rowId: livestreamSegments.rowId,
      segmentKey: livestreamSegments.segmentKey,
      productRowId: livestreamSegments.productRowId,
    })
    .from(livestreamSegments)
    .where(inArray(livestreamSegments.productRowId, productRowIds));

  const keepKeys = new Set(
    products.flatMap((p) => p.segments.map((s) => `${productRowIdByKey.get(p.id)}:${s.id}`))
  );
  const removedRowIds = existing
    .filter((s) => !keepKeys.has(`${s.productRowId}:${s.segmentKey}`))
    .map((s) => s.rowId);
  if (removedRowIds.length > 0) {
    await tx.delete(livestreamSegments).where(inArray(livestreamSegments.rowId, removedRowIds));
  }

  const allSegmentValues = products.flatMap((product) => {
    const productRowId = productRowIdByKey.get(product.id)!;
    return product.segments.map((seg) => ({
      productRowId,
      jobId: dbJobId,
      segmentKey: seg.id,
      order: seg.order,
      voiceoverVi: seg.voiceoverVi,
      veoPrompt: seg.veoPrompt,
      duration: seg.duration,
      status: seg.status,
      flowJobId: seg.jobId ?? null,
      videoPath: seg.videoPath ?? null,
      videoUrl: seg.videoUrl ?? null,
      lastFramePath: seg.lastFramePath ?? null,
      error: seg.error ?? null,
      attempts: seg.attempts,
      lastUpdatedAt: isoToSql(seg.lastUpdatedAt),
      createdAt: nowStamp,
      updatedAt: nowStamp,
    }));
  });
  if (allSegmentValues.length === 0) return;

  await tx
    .insert(livestreamSegments)
    .values(allSegmentValues)
    .onDuplicateKeyUpdate({
      set: {
        order: sql`values(${livestreamSegments.order})`,
        voiceoverVi: sql`values(${livestreamSegments.voiceoverVi})`,
        veoPrompt: sql`values(${livestreamSegments.veoPrompt})`,
        duration: sql`values(${livestreamSegments.duration})`,
        status: sql`values(${livestreamSegments.status})`,
        flowJobId: sql`values(${livestreamSegments.flowJobId})`,
        videoPath: sql`values(${livestreamSegments.videoPath})`,
        videoUrl: sql`values(${livestreamSegments.videoUrl})`,
        lastFramePath: sql`values(${livestreamSegments.lastFramePath})`,
        error: sql`values(${livestreamSegments.error})`,
        attempts: sql`values(${livestreamSegments.attempts})`,
        lastUpdatedAt: sql`values(${livestreamSegments.lastUpdatedAt})`,
        updatedAt: sql`values(${livestreamSegments.updatedAt})`,
      },
    });
}

/** Ghi job MỚI (transaction). Giữ chữ ký cũ — PK bigint tự sinh bên trong, không lộ ra ngoài. */
export async function writeJob(job: LivestreamJob): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await persistJob(tx, job, null);
  });
}

/**
 * Đọc → sửa → ghi nguyên tử trong 1 transaction. SELECT ... FOR UPDATE khóa row job để
 * chống lost-update (thay hàng đợi in-memory cũ). GIỮ ràng buộc KHÔNG gọi updateJob lồng
 * nhau (deadlock — xem cảnh báo ở segmentSync.ts).
 */
export async function updateJob<T = void>(
  jobId: string,
  mutator: (job: LivestreamJob) => T | Promise<T>
): Promise<{ job: LivestreamJob; result: T }> {
  assertValidJobId(jobId);
  const db = getDb();
  return db.transaction(async (tx) => {
    // Khóa row job trong transaction (chống 2 update chồng nhau).
    const lockedRows = await tx
      .select()
      .from(livestreamJobs)
      .where(eq(livestreamJobs.slug, jobId))
      .for('update')
      .limit(1);
    const jobRow = lockedRows[0];
    if (!jobRow) {
      throw new Error(`Livestream job không tồn tại: ${jobId}`);
    }
    const productRows = await tx
      .select()
      .from(livestreamProducts)
      .where(eq(livestreamProducts.jobId, jobRow.id));
    const segmentRows = await tx
      .select()
      .from(livestreamSegments)
      .where(eq(livestreamSegments.jobId, jobRow.id));
    const job = assembleJob(jobRow, productRows, segmentRows);

    const result = await mutator(job);
    await persistJob(tx, job, jobRow.id);
    return { job, result };
  });
}

/** Fallback tạo/lưu flowProjectId muộn cho job — xem ensureProjectFlowId ở lib/data/projectStore.ts. */
export async function ensureJobFlowId(jobId: string): Promise<string | null> {
  const job = await readJob(jobId);
  if (job.flowProjectId) return job.flowProjectId;

  const flowProjectId = await resolveFlowProjectIdSafe(job.name);
  if (!flowProjectId) return null;

  const { job: updated } = await updateJob(jobId, (j) => {
    if (!j.flowProjectId) j.flowProjectId = flowProjectId;
  });
  return updated.flowProjectId;
}

/**
 * Seed video cố định cho job — tạo random 1 LẦN DUY NHẤT ở lần gen video đầu tiên rồi giữ nguyên
 * suốt vòng đời job (thay vì random mỗi đoạn), để Veo ổn định hơn giữa các đoạn liên tiếp.
 */
export async function ensureJobVideoSeed(jobId: string): Promise<number> {
  const job = await readJob(jobId);
  if (job.videoSeed != null) return job.videoSeed;

  const seed = Math.floor(Math.random() * 1_000_000);
  const { job: updated } = await updateJob(jobId, (j) => {
    if (j.videoSeed == null) j.videoSeed = seed;
  });
  return updated.videoSeed as number;
}

// ------------------------------------------------------------------
// Thư mục media — GIỮ NGUYÊN (không đụng đến DB)
// ------------------------------------------------------------------

export async function ensureLivestreamDataRoot(): Promise<void> {
  await fs.mkdir(LIVESTREAM_DATA_ROOT, { recursive: true });
}

/** Danh sách job (1 query JOIN + COUNT products) thay vì đọc mọi file JSON. */
export async function listJobs(): Promise<LivestreamJobSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: livestreamJobs.slug,
      name: livestreamJobs.name,
      updatedAt: livestreamJobs.updatedAt,
      status: livestreamJobs.status,
      aspectRatio: livestreamJobs.aspectRatio,
      productCount: sql<number>`count(${livestreamProducts.rowId})`,
    })
    .from(livestreamJobs)
    .leftJoin(livestreamProducts, eq(livestreamProducts.jobId, livestreamJobs.id))
    .groupBy(
      livestreamJobs.id,
      livestreamJobs.slug,
      livestreamJobs.name,
      livestreamJobs.updatedAt,
      livestreamJobs.status,
      livestreamJobs.aspectRatio
    );
  const summaries: LivestreamJobSummary[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: sqlToIso(r.updatedAt) ?? r.updatedAt,
    status: r.status as LivestreamJobStatus,
    aspectRatio: r.aspectRatio as '9:16' | '16:9',
    // count() trả string qua mysql2 ở một số cấu hình → ép số cho chắc.
    productCount: Number(r.productCount),
  }));
  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return summaries;
}

/** Xóa row job + products + segments (media dir do call-site tự fs.rm riêng). */
export async function deleteJob(jobId: string): Promise<void> {
  assertValidJobId(jobId);
  const db = getDb();
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: livestreamJobs.id })
      .from(livestreamJobs)
      .where(eq(livestreamJobs.slug, jobId))
      .limit(1);
    const dbId = rows[0]?.id;
    if (dbId === undefined) return; // job không tồn tại — no-op, giữ ngữ nghĩa idempotent cũ
    await tx.delete(livestreamSegments).where(eq(livestreamSegments.jobId, dbId));
    await tx.delete(livestreamProducts).where(eq(livestreamProducts.jobId, dbId));
    await tx.delete(livestreamJobs).where(eq(livestreamJobs.id, dbId));
  });
}

export async function createJobDirs(slug: string): Promise<void> {
  const dir = jobDir(slug);
  await fs.mkdir(path.join(dir, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'segments'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'frames'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'tmp'), { recursive: true });
}
