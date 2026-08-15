/**
 * Backfill R2 — upload video của các job cũ đã generate xong nhưng chưa lên Cloudflare R2
 * (videoUrl / concat.outputUrl còn null vì chạy trước khi có tính năng R2).
 *
 * Xử lý CẢ HAI loại job, tái hiện đúng logic của app:
 *
 * A) Pipeline gốc — data/projects/<id>/project.json (script.scenes[]):
 *  - Scene: upload outputs/scenes/<file>.mp4 → key projects/<id>/scenes/<file>.mp4, gán
 *    scene.videoUrl. GIỮ file local (app cũng giữ để bước ghép video đọc lại).
 *  - Final: upload outputs/final.mp4 → key projects/<id>/final.mp4, gán concat.outputUrl,
 *    rồi XOÁ final.mp4 local (giống concat/route.ts) — chỉ xoá sau khi ghi outputUrl.
 *
 * B) Livestream — data/livestream/<id>/job.json (products[].segments[]):
 *  - Segment: upload outputs/segments/<file>.mp4 → key livestream/<id>/segments/<file>.mp4,
 *    gán segment.videoUrl. GIỮ file local (bước concat livestream còn cần đọc; app chỉ xoá
 *    segment local SAU khi concat xong — backfill không tự chạy concat nên không xoá).
 *  - Final: nếu concat.status==='done' & thiếu outputUrl → upload outputs/final.mp4 →
 *    key livestream/<id>/final.mp4, gán concat.outputUrl rồi xoá final.mp4 local.
 *
 * Chỉ upload khi status === 'done', file tồn tại, và url tương ứng còn null (idempotent —
 * chạy lại không upload lại cái đã có url). Ghi job.json atomic (tmp + rename).
 *
 * Chạy:
 *   node scripts/backfill-r2.mjs                     # cả projects + livestream
 *   node scripts/backfill-r2.mjs --dry-run           # chỉ in, không upload / không sửa / không xoá
 *   node scripts/backfill-r2.mjs --livestream        # chỉ livestream
 *   node scripts/backfill-r2.mjs --projects          # chỉ projects
 *   node scripts/backfill-r2.mjs <id> [<id> ...]     # giới hạn theo id (áp dụng cho loại đang chạy)
 */

import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- Load .env.local (không dùng dotenv để khỏi thêm dependency) ----------------------
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, '.env.local'));
loadEnvFile(path.join(ROOT, '.env'));

// ---- R2 config (khớp lib/constants.ts) -----------------------------------------------
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
const R2_ENABLED = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_URL);

const DATA_ROOT =
  process.env.PROJECTS_DIR && process.env.PROJECTS_DIR.trim() !== ''
    ? process.env.PROJECTS_DIR
    : path.join(ROOT, 'data', 'projects');

const LIVESTREAM_ROOT =
  process.env.LIVESTREAM_DIR && process.env.LIVESTREAM_DIR.trim() !== ''
    ? process.env.LIVESTREAM_DIR
    : path.join(ROOT, 'data', 'livestream');

// id job có thể dài hơn (slug tiếng Việt đã chuẩn hoá + hash), nới độ dài cho khớp thực tế.
const PROJECT_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

// ---- CLI args ------------------------------------------------------------------------
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ONLY_LIVESTREAM = argv.includes('--livestream');
const ONLY_PROJECTS = argv.includes('--projects');
const onlyIds = argv.filter((a) => !a.startsWith('--'));

// ---- R2 client (khớp lib/r2/client.ts) -----------------------------------------------
let cachedClient = null;
function client() {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
  }
  return cachedClient;
}

function publicUrlFor(key) {
  return `${R2_PUBLIC_URL}/${key}`;
}

async function uploadFileToR2(localAbsPath, key, contentType) {
  if (DRY_RUN) return publicUrlFor(key); // dry-run: giả lập thành công để in kết quả
  try {
    const body = await fs.readFile(localAbsPath);
    await client().send(
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType })
    );
    return publicUrlFor(key);
  } catch (err) {
    console.error(`  [r2] upload thất bại cho ${key}:`, err?.message || err);
    return null;
  }
}

// ---- project.json helpers (atomic write khớp projectStore.ts) ------------------------
function projectJsonPath(id) {
  return path.join(DATA_ROOT, id, 'project.json');
}
function resolveWithinProject(id, relPath) {
  const base = path.join(DATA_ROOT, id);
  const normalized = path.normalize(relPath).replace(/^([.]{2}[/\\])+/, '');
  const resolved = path.resolve(base, normalized);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (!resolved.startsWith(baseWithSep) && resolved !== base) {
    throw new Error('Đường dẫn không hợp lệ (path traversal bị chặn)');
  }
  return resolved;
}

async function readProjectRaw(id) {
  const raw = await fs.readFile(projectJsonPath(id), 'utf-8');
  return JSON.parse(raw);
}
async function writeProjectAtomic(project) {
  project.updatedAt = new Date().toISOString();
  const jsonPath = projectJsonPath(project.id);
  const tmpPath = `${jsonPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(project, null, 2), 'utf-8');
  await fs.rename(tmpPath, jsonPath);
}

// ---- Backfill 1 project --------------------------------------------------------------
async function backfillProject(id) {
  const project = await readProjectRaw(id);
  let changed = false;
  const summary = { scenesUploaded: 0, scenesSkipped: 0, finalUploaded: false };

  // 1) Video từng scene
  const scenes = project.script?.scenes || [];
  for (const scene of scenes) {
    if (scene.status !== 'done' || !scene.videoPath) continue;
    if (scene.videoUrl) {
      summary.scenesSkipped++;
      continue; // đã có url → bỏ qua (idempotent)
    }
    let abs;
    try {
      abs = resolveWithinProject(id, scene.videoPath);
    } catch (e) {
      console.error(`  ✗ scene ${scene.id}: ${e.message}`);
      continue;
    }
    if (!existsSync(abs)) {
      console.warn(`  ⚠ scene ${scene.id}: thiếu file local ${scene.videoPath} → bỏ qua`);
      continue;
    }
    const destFileName = path.basename(scene.videoPath);
    const key = `projects/${id}/scenes/${destFileName}`;
    const url = await uploadFileToR2(abs, key, 'video/mp4');
    if (url) {
      scene.videoUrl = url;
      changed = true;
      summary.scenesUploaded++;
      console.log(`  ✓ scene ${scene.id} → ${key}`);
    }
  }

  // 2) Video final (concat) — upload xong ghi outputUrl rồi xoá final.mp4 local
  const concat = project.concat;
  if (concat && concat.status === 'done' && !concat.outputUrl) {
    const relFinal = concat.outputPath || 'outputs/final.mp4';
    const absFinal = resolveWithinProject(id, relFinal);
    if (existsSync(absFinal)) {
      const key = `projects/${id}/final.mp4`;
      const url = await uploadFileToR2(absFinal, key, 'video/mp4');
      if (url) {
        concat.outputPath = relFinal;
        concat.outputUrl = url;
        changed = true;
        summary.finalUploaded = true;
        console.log(`  ✓ final → ${key}`);
        // Ghi project.json TRƯỚC khi xoá local (giống app), tránh mất dữ liệu nếu crash giữa chừng.
        if (!DRY_RUN) {
          await writeProjectAtomic(project);
          await fs.unlink(absFinal).catch(() => {});
          console.log(`  🗑  đã xoá final.mp4 local`);
        } else {
          console.log(`  (dry-run) sẽ xoá final.mp4 local sau khi ghi outputUrl`);
        }
        return summary; // đã ghi ở trên, không ghi lại lần nữa
      }
    } else {
      console.warn(`  ⚠ final: thiếu file local ${relFinal} → bỏ qua`);
    }
  } else if (concat && concat.outputUrl) {
    console.log(`  = final: đã có outputUrl, bỏ qua`);
  }

  if (changed && !DRY_RUN) {
    await writeProjectAtomic(project);
  }
  return summary;
}

// ---- livestream job.json helpers (atomic write khớp jobStore.ts) ---------------------
function jobJsonPath(id) {
  return path.join(LIVESTREAM_ROOT, id, 'job.json');
}
function resolveWithinJob(id, relPath) {
  const base = path.join(LIVESTREAM_ROOT, id);
  const normalized = path.normalize(relPath).replace(/^([.]{2}[/\\])+/, '');
  const resolved = path.resolve(base, normalized);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (!resolved.startsWith(baseWithSep) && resolved !== base) {
    throw new Error('Đường dẫn không hợp lệ (path traversal bị chặn)');
  }
  return resolved;
}
async function readJobRaw(id) {
  const raw = await fs.readFile(jobJsonPath(id), 'utf-8');
  return JSON.parse(raw);
}
async function writeJobAtomic(job) {
  job.updatedAt = new Date().toISOString();
  const jsonPath = jobJsonPath(job.id);
  const tmpPath = `${jsonPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(job, null, 2), 'utf-8');
  await fs.rename(tmpPath, jsonPath);
}

// ---- Backfill 1 livestream job -------------------------------------------------------
async function backfillLivestream(id) {
  const job = await readJobRaw(id);
  let changed = false;
  const summary = { segmentsUploaded: 0, segmentsSkipped: 0, finalUploaded: false };

  // 1) Video từng segment (nested trong products[])
  for (const product of job.products || []) {
    for (const segment of product.segments || []) {
      if (segment.status !== 'done' || !segment.videoPath) continue;
      if (segment.videoUrl) {
        summary.segmentsSkipped++;
        continue; // đã có url → bỏ qua (idempotent)
      }
      let abs;
      try {
        abs = resolveWithinJob(id, segment.videoPath);
      } catch (e) {
        console.error(`  ✗ segment ${segment.id}: ${e.message}`);
        continue;
      }
      if (!existsSync(abs)) {
        console.warn(`  ⚠ segment ${segment.id}: thiếu file local ${segment.videoPath} → bỏ qua`);
        continue;
      }
      const destFileName = path.basename(segment.videoPath);
      const key = `livestream/${id}/segments/${destFileName}`;
      const url = await uploadFileToR2(abs, key, 'video/mp4');
      if (url) {
        segment.videoUrl = url;
        changed = true;
        summary.segmentsUploaded++;
        console.log(`  ✓ segment ${segment.id} → ${key}`);
      }
    }
  }

  // 2) Video final (concat) — upload xong ghi outputUrl rồi xoá final.mp4 local
  const concat = job.concat;
  if (concat && concat.status === 'done' && !concat.outputUrl) {
    const relFinal = concat.outputPath || 'outputs/final.mp4';
    const absFinal = resolveWithinJob(id, relFinal);
    if (existsSync(absFinal)) {
      const key = `livestream/${id}/final.mp4`;
      const url = await uploadFileToR2(absFinal, key, 'video/mp4');
      if (url) {
        concat.outputPath = relFinal;
        concat.outputUrl = url;
        changed = true;
        summary.finalUploaded = true;
        console.log(`  ✓ final → ${key}`);
        if (!DRY_RUN) {
          await writeJobAtomic(job); // ghi TRƯỚC khi xoá local, tránh mất dữ liệu nếu crash
          await fs.unlink(absFinal).catch(() => {});
          console.log(`  🗑  đã xoá final.mp4 local`);
        } else {
          console.log(`  (dry-run) sẽ xoá final.mp4 local sau khi ghi outputUrl`);
        }
        return summary;
      }
    } else {
      console.warn(`  ⚠ final: thiếu file local ${relFinal} → bỏ qua`);
    }
  } else if (concat && concat.outputUrl) {
    console.log(`  = final: đã có outputUrl, bỏ qua`);
  }

  if (changed && !DRY_RUN) {
    await writeJobAtomic(job);
  }
  return summary;
}

// ---- main ----------------------------------------------------------------------------
async function main() {
  if (!R2_ENABLED) {
    console.error('✗ R2 chưa cấu hình đủ (thiếu R2_ACCOUNT_ID/ACCESS_KEY/SECRET/BUCKET/PUBLIC_URL). Dừng.');
    process.exit(1);
  }
  console.log(`R2 bucket: ${R2_BUCKET} | public: ${R2_PUBLIC_URL}`);
  if (DRY_RUN) console.log('*** DRY-RUN: không upload, không sửa file, không xoá ***');
  console.log('');

  // Mặc định chạy cả 2 loại; --projects / --livestream để giới hạn.
  const runProjects = !ONLY_LIVESTREAM || ONLY_PROJECTS;
  const runLivestream = !ONLY_PROJECTS || ONLY_LIVESTREAM;

  const totals = {
    projects: 0, scenesUploaded: 0, scenesSkipped: 0, projectFinals: 0,
    jobs: 0, segmentsUploaded: 0, segmentsSkipped: 0, jobFinals: 0,
  };

  // ---- A) Projects (pipeline gốc) ----
  if (runProjects && existsSync(DATA_ROOT)) {
    console.log(`═══ PROJECTS (${DATA_ROOT}) ═══`);
    let ids = onlyIds.length > 0
      ? onlyIds
      : (await fs.readdir(DATA_ROOT, { withFileTypes: true }))
          .filter((e) => e.isDirectory()).map((e) => e.name);
    for (const id of ids.sort()) {
      if (!PROJECT_ID_REGEX.test(id)) { console.warn(`⚠ bỏ qua id không hợp lệ: ${id}`); continue; }
      if (!existsSync(projectJsonPath(id))) { if (onlyIds.length > 0) console.warn(`⚠ ${id}: không có project.json`); continue; }
      console.log(`■ ${id}`);
      try {
        const s = await backfillProject(id);
        totals.projects++;
        totals.scenesUploaded += s.scenesUploaded;
        totals.scenesSkipped += s.scenesSkipped;
        if (s.finalUploaded) totals.projectFinals++;
        if (s.scenesUploaded === 0 && !s.finalUploaded) console.log('  (không có gì để upload)');
      } catch (err) {
        console.error(`  ✗ lỗi khi xử lý ${id}:`, err?.message || err);
      }
      console.log('');
    }
  }

  // ---- B) Livestream ----
  if (runLivestream && existsSync(LIVESTREAM_ROOT)) {
    console.log(`═══ LIVESTREAM (${LIVESTREAM_ROOT}) ═══`);
    let ids = onlyIds.length > 0
      ? onlyIds
      : (await fs.readdir(LIVESTREAM_ROOT, { withFileTypes: true }))
          .filter((e) => e.isDirectory()).map((e) => e.name);
    for (const id of ids.sort()) {
      if (!PROJECT_ID_REGEX.test(id)) { console.warn(`⚠ bỏ qua id không hợp lệ: ${id}`); continue; }
      if (!existsSync(jobJsonPath(id))) { if (onlyIds.length > 0) console.warn(`⚠ ${id}: không có job.json`); continue; }
      console.log(`■ ${id}`);
      try {
        const s = await backfillLivestream(id);
        totals.jobs++;
        totals.segmentsUploaded += s.segmentsUploaded;
        totals.segmentsSkipped += s.segmentsSkipped;
        if (s.finalUploaded) totals.jobFinals++;
        if (s.segmentsUploaded === 0 && !s.finalUploaded) console.log('  (không có gì để upload)');
      } catch (err) {
        console.error(`  ✗ lỗi khi xử lý ${id}:`, err?.message || err);
      }
      console.log('');
    }
  }

  console.log('──────── Tổng kết ────────');
  console.log(`Projects xử lý: ${totals.projects} | scene upload: ${totals.scenesUploaded} | bỏ qua: ${totals.scenesSkipped} | final: ${totals.projectFinals}`);
  console.log(`Livestream xử lý: ${totals.jobs} | segment upload: ${totals.segmentsUploaded} | bỏ qua: ${totals.segmentsSkipped} | final: ${totals.jobFinals}`);
  if (DRY_RUN) console.log('(dry-run — chưa thực sự thay đổi gì)');
}

main().catch((err) => {
  console.error('Lỗi không mong đợi:', err);
  process.exit(1);
});
