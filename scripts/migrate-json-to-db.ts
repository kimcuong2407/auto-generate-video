/**
 * Import dữ liệu JSON cũ (data/livestream/<id>/job.json, data/projects/<id>/project.json) → MariaDB.
 *
 * Đặc điểm:
 * - GIỮ NGUYÊN createdAt/updatedAt gốc (không set = now như writeJob/writeProject) để không mất
 *   dấu thời gian lịch sử. Timestamp cấp product/segment/scene (JSON cũ KHÔNG có) → set =
 *   job/project.createdAt làm mốc hợp lý nhất.
 * - Áp đúng logic backfill của store cũ (sao lại inline ở đây) để field thiếu có default chuẩn.
 * - IDEMPOTENT: mỗi job/project xóa sạch row cũ (job+products+segments / project+scenes+storyboard)
 *   rồi insert lại → chạy nhiều lần không nhân đôi.
 * - Media (ảnh/video) KHÔNG đụng — vẫn ở disk/R2, DB chỉ lưu path/URL.
 *
 * Chạy: npm run db:import   (tsx scripts/migrate-json-to-db.ts)
 */
// DB_* được nạp qua `tsx --env-file=.env.local` (xem script db:import trong package.json) —
// phải nạp bằng flag runtime chứ không dùng dotenv trong file, vì ESM hoist mọi `import`
// (kể cả lib/db/client) lên trước thân module, khiến config.ts đọc process.env khi còn rỗng.
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb, getPool } from '../lib/db/client';
import * as schema from '../lib/db/schema';
import { isoToSql } from '../lib/db/datetime';
import { DATA_ROOT, DEFAULT_STORYBOARD_MODEL } from '../lib/constants';
import { LIVESTREAM_DATA_ROOT } from '../lib/livestream/constants';
import type { LivestreamJob } from '../lib/livestream/types';
import type { Project } from '../lib/types';

const {
  livestreamJobs,
  livestreamProducts,
  livestreamSegments,
  projects,
  scenes,
  storyboardImages,
} = schema;

const db = getDb();

// ------------------------------------------------------------------
// Backfill livestream (khớp readJob cũ trước migrate).
// ------------------------------------------------------------------
function backfillJob(job: LivestreamJob): LivestreamJob {
  for (const product of job.products || []) {
    if (product.sourceFilePath === undefined) product.sourceFilePath = null;
    for (const segment of product.segments || []) {
      if (segment.lastFramePath === undefined) segment.lastFramePath = null;
      if (segment.videoUrl === undefined) segment.videoUrl = null;
    }
  }
  if (!Array.isArray(job.spokespersonImagePaths)) job.spokespersonImagePaths = [];
  // JSON cũ (trước đổi sang mảng) có thể còn field số ít `selectedRefImagePath: string | null`.
  const legacySingle = (job as unknown as { selectedRefImagePath?: string | null }).selectedRefImagePath;
  if (!Array.isArray(job.selectedRefImagePaths)) {
    job.selectedRefImagePaths = legacySingle ? [legacySingle] : [];
  }
  if (job.selectedModelImagePath === undefined) job.selectedModelImagePath = null;
  if (!Array.isArray(job.backgroundImagePaths)) job.backgroundImagePaths = [];
  if (job.selectedBackgroundImagePath === undefined) job.selectedBackgroundImagePath = null;
  if (!job.imageR2Urls || typeof job.imageR2Urls !== 'object') job.imageR2Urls = {};
  if (!job.flowMediaIds || typeof job.flowMediaIds !== 'object') job.flowMediaIds = {};
  if (job.scriptSystemPromptOverride === undefined) job.scriptSystemPromptOverride = null;
  return job;
}

// ------------------------------------------------------------------
// Backfill project (khớp readProject cũ trước migrate).
// ------------------------------------------------------------------
function backfillProject(project: Project): Project {
  if (project.sceneChaining === undefined) project.sceneChaining = true;
  if (project.burnOnScreenText === undefined) project.burnOnScreenText = false;
  for (const scene of project.script?.scenes || []) {
    if (scene.lastFramePath === undefined) scene.lastFramePath = null;
    if (scene.chainedFromPrevious === undefined) scene.chainedFromPrevious = false;
    if (scene.videoUrl === undefined) scene.videoUrl = null;
  }
  if (project.concat && project.concat.outputUrl === undefined) project.concat.outputUrl = null;
  if (project.inputs) {
    if (project.inputs.productImageUrls === undefined) {
      project.inputs.productImageUrls = project.inputs.productImages.map(() => null);
    }
    if (project.inputs.backgroundUrl === undefined) project.inputs.backgroundUrl = null;
    if (project.inputs.spokespersonImageUrl === undefined) project.inputs.spokespersonImageUrl = null;
  }
  if (!project.storyboard) {
    project.storyboard = {
      model: DEFAULT_STORYBOARD_MODEL,
      useProductReference: true,
      productReferenceImagePath: null,
      useSpokespersonReference: true,
      images: (project.template?.scenes || []).map((s, i) => ({
        sceneId: s.id,
        order: i + 1,
        prompt: '',
        imagePath: null,
        imageUrl: null,
        status: 'idle' as const,
        error: null,
        attempts: 0,
        lastUpdatedAt: null,
      })),
      backgrounds: [],
    };
  }
  if (project.storyboard.useSpokespersonReference === undefined) {
    project.storyboard.useSpokespersonReference = true;
  }
  if (!project.storyboard.backgrounds) {
    project.storyboard.backgrounds = project.storyboard.images.map((img) => ({
      sceneId: img.sceneId,
      order: img.order,
      prompt: '',
      imagePath: null,
      imageUrl: null,
      status: 'idle' as const,
      error: null,
      attempts: 0,
      lastUpdatedAt: null,
    }));
  }
  for (const img of [...project.storyboard.images, ...project.storyboard.backgrounds]) {
    if (img.imageUrl === undefined) img.imageUrl = null;
  }
  return project;
}

// ------------------------------------------------------------------
// Import 1 job livestream (giữ timestamp gốc).
// ------------------------------------------------------------------
async function importJob(jobId: string): Promise<{ products: number; segments: number }> {
  const raw = await fs.readFile(path.join(LIVESTREAM_DATA_ROOT, jobId, 'job.json'), 'utf-8');
  const job = backfillJob(JSON.parse(raw) as LivestreamJob);
  const jobCreated = isoToSql(job.createdAt) ?? job.createdAt;
  const jobUpdated = isoToSql(job.updatedAt) ?? job.updatedAt;

  let productCount = 0;
  let segmentCount = 0;

  await db.transaction(async (tx) => {
    // Idempotent: xóa sạch row cũ của job này (tra theo slug — PK giờ là bigint autoincrement).
    const existing = await tx
      .select({ id: livestreamJobs.id })
      .from(livestreamJobs)
      .where(eq(livestreamJobs.slug, job.id))
      .limit(1);
    const existingDbId = existing[0]?.id;
    if (existingDbId !== undefined) {
      await tx.delete(livestreamSegments).where(eq(livestreamSegments.jobId, existingDbId));
      await tx.delete(livestreamProducts).where(eq(livestreamProducts.jobId, existingDbId));
      await tx.delete(livestreamJobs).where(eq(livestreamJobs.id, existingDbId));
    }

    const [insertResult] = await tx.insert(livestreamJobs).values({
      slug: job.id,
      name: job.name,
      createdAt: jobCreated,
      updatedAt: jobUpdated,
      aspectRatio: job.aspectRatio,
      veoModel: job.veoModel,
      chaining: job.chaining,
      status: job.status,
      spokespersonImagePaths: job.spokespersonImagePaths ?? [],
      selectedRefImagePaths: job.selectedRefImagePaths ?? [],
      selectedModelImagePath: job.selectedModelImagePath ?? null,
      backgroundImagePaths: job.backgroundImagePaths ?? [],
      selectedBackgroundImagePath: job.selectedBackgroundImagePath ?? null,
      imageR2Urls: job.imageR2Urls ?? {},
      flowMediaIds: job.flowMediaIds ?? {},
      concat: job.concat,
      flowStatusCache: job.flowStatusCache,
      flowProjectId: job.flowProjectId ?? null,
      scriptSystemPromptOverride: job.scriptSystemPromptOverride ?? null,
      videoSeed: job.videoSeed ?? null,
    });
    const dbJobId = Number((insertResult as unknown as { insertId: number }).insertId);

    for (const product of job.products) {
      // Timestamp product/segment (JSON cũ không có) = job.createdAt.
      await tx.insert(livestreamProducts).values({
        jobId: dbJobId,
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
        createdAt: jobCreated,
        updatedAt: jobUpdated,
      });
      const inserted = await tx
        .select({ rowId: livestreamProducts.rowId })
        .from(livestreamProducts)
        .where(
          and(
            eq(livestreamProducts.jobId, dbJobId),
            eq(livestreamProducts.productKey, product.id)
          )
        )
        .limit(1);
      const rowId = inserted[0]?.rowId;
      if (rowId === undefined) {
        throw new Error(`Không lấy được rowId cho product ${product.id}`);
      }
      productCount += 1;

      for (const seg of product.segments) {
        await tx.insert(livestreamSegments).values({
          productRowId: rowId,
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
          createdAt: jobCreated,
          updatedAt: jobUpdated,
        });
        segmentCount += 1;
      }
    }
  });

  return { products: productCount, segments: segmentCount };
}

// ------------------------------------------------------------------
// Import 1 project (giữ timestamp gốc).
// ------------------------------------------------------------------
async function importProject(projectId: string): Promise<{ scenes: number; storyboard: number }> {
  const raw = await fs.readFile(path.join(DATA_ROOT, projectId, 'project.json'), 'utf-8');
  const project = backfillProject(JSON.parse(raw) as Project);
  const created = isoToSql(project.createdAt) ?? project.createdAt;
  const updated = isoToSql(project.updatedAt) ?? project.updatedAt;

  let sceneCount = 0;
  let storyboardCount = 0;

  await db.transaction(async (tx) => {
    await tx.delete(scenes).where(eq(scenes.projectId, project.id));
    await tx.delete(storyboardImages).where(eq(storyboardImages.projectId, project.id));
    await tx.delete(projects).where(eq(projects.id, project.id));

    await tx.insert(projects).values({
      id: project.id,
      name: project.name,
      createdAt: created,
      updatedAt: updated,
      currentStep: project.currentStep,
      aspectRatio: project.aspectRatio,
      veoModel: project.veoModel,
      sceneChaining: project.sceneChaining,
      burnOnScreenText: project.burnOnScreenText,
      flowProjectId: project.flowProjectId ?? null,
      scriptAngleId: project.scriptAngleId ?? null,
      template: project.template,
      product: project.product,
      inputs: project.inputs,
      music: project.music,
      concat: project.concat,
      flowStatusCache: project.flowStatusCache,
      storyboardModel: project.storyboard.model,
      storyboardUseProductReference: project.storyboard.useProductReference,
      storyboardUseSpokespersonReference: project.storyboard.useSpokespersonReference,
      scriptTotalDuration: project.script.totalDuration,
      scriptAspectRatio: project.script.aspectRatio,
    });

    for (const scene of project.script.scenes) {
      await tx.insert(scenes).values({
        projectId: project.id,
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
        createdAt: created,
        updatedAt: updated,
      });
      sceneCount += 1;
    }

    const storyboardRows: (typeof storyboardImages.$inferInsert)[] = [];
    project.storyboard.images.forEach((img, i) => {
      storyboardRows.push({
        projectId: project.id,
        kind: 'image',
        sceneId: img.sceneId,
        order: img.order ?? i + 1,
        prompt: img.prompt,
        imagePath: img.imagePath ?? null,
        status: img.status,
        error: img.error ?? null,
        attempts: img.attempts,
        lastUpdatedAt: isoToSql(img.lastUpdatedAt),
      });
    });
    project.storyboard.backgrounds.forEach((bg, i) => {
      storyboardRows.push({
        projectId: project.id,
        kind: 'background',
        sceneId: bg.sceneId,
        order: bg.order ?? i + 1,
        prompt: bg.prompt,
        imagePath: bg.imagePath ?? null,
        status: bg.status,
        error: bg.error ?? null,
        attempts: bg.attempts,
        lastUpdatedAt: isoToSql(bg.lastUpdatedAt),
      });
    });
    if (storyboardRows.length > 0) {
      await tx.insert(storyboardImages).values(storyboardRows);
    }
    storyboardCount = storyboardRows.length;
  });

  return { scenes: sceneCount, storyboard: storyboardCount };
}

// ------------------------------------------------------------------
// Quét thư mục + chạy.
// ------------------------------------------------------------------
async function listSubdirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function main() {
  console.log('=== Import JSON → MariaDB ===');

  // --- Livestream jobs ---
  const jobIds = await listSubdirs(LIVESTREAM_DATA_ROOT);
  let jobOk = 0;
  let jobFail = 0;
  let totalProducts = 0;
  let totalSegments = 0;
  for (const id of jobIds) {
    try {
      const { products, segments } = await importJob(id);
      totalProducts += products;
      totalSegments += segments;
      jobOk += 1;
      console.log(`✓ job ${id}: ${products} product, ${segments} segment`);
    } catch (err) {
      jobFail += 1;
      console.error(`✗ job ${id}: ${(err as Error).message}`);
    }
  }

  // --- Projects ---
  const projectIds = await listSubdirs(DATA_ROOT);
  let projOk = 0;
  let projFail = 0;
  let totalScenes = 0;
  let totalStoryboard = 0;
  for (const id of projectIds) {
    try {
      const { scenes: sc, storyboard } = await importProject(id);
      totalScenes += sc;
      totalStoryboard += storyboard;
      projOk += 1;
      console.log(`✓ project ${id}: ${sc} scene, ${storyboard} storyboard-image`);
    } catch (err) {
      projFail += 1;
      console.error(`✗ project ${id}: ${(err as Error).message}`);
    }
  }

  console.log('\n=== Tổng kết ===');
  console.log(`Livestream: ${jobOk} job OK (${jobFail} lỗi), ${totalProducts} product, ${totalSegments} segment`);
  console.log(`Projects:   ${projOk} project OK (${projFail} lỗi), ${totalScenes} scene, ${totalStoryboard} storyboard-image`);

  await getPool().end();
  if (jobFail > 0 || projFail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Import thất bại:', err);
  process.exit(1);
});
