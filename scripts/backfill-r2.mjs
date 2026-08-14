/**
 * Backfill R2 — upload video của các job (project) cũ đã generate xong nhưng chưa lên
 * Cloudflare R2 (videoUrl / concat.outputUrl còn null vì chạy trước khi có tính năng R2).
 *
 * Tái hiện đúng logic của app:
 *  - Scene: upload outputs/scenes/<file>.mp4 với key projects/<id>/scenes/<file>.mp4,
 *    gán scene.videoUrl. GIỮ file local (app cũng giữ để bước ghép video đọc lại).
 *  - Final: upload outputs/final.mp4 với key projects/<id>/final.mp4, gán concat.outputUrl,
 *    rồi XOÁ final.mp4 local (giống concat/route.ts) — chỉ xoá sau khi project.json đã ghi outputUrl.
 *
 * Chỉ upload khi status === 'done', file tồn tại, và url tương ứng còn null (idempotent —
 * chạy lại không upload lại cái đã có url). Ghi project.json atomic (tmp + rename).
 *
 * Chạy:
 *   node scripts/backfill-r2.mjs            # thực thi
 *   node scripts/backfill-r2.mjs --dry-run  # chỉ in ra sẽ làm gì, không upload / không sửa file
 *   node scripts/backfill-r2.mjs <projectId> [<projectId> ...]   # giới hạn theo project id
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

const PROJECT_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ---- CLI args ------------------------------------------------------------------------
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
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

// ---- main ----------------------------------------------------------------------------
async function main() {
  if (!R2_ENABLED) {
    console.error('✗ R2 chưa cấu hình đủ (thiếu R2_ACCOUNT_ID/ACCESS_KEY/SECRET/BUCKET/PUBLIC_URL). Dừng.');
    process.exit(1);
  }
  console.log(`R2 bucket: ${R2_BUCKET} | public: ${R2_PUBLIC_URL}`);
  console.log(`DATA_ROOT: ${DATA_ROOT}`);
  if (DRY_RUN) console.log('*** DRY-RUN: không upload, không sửa file, không xoá ***');
  console.log('');

  let ids;
  if (onlyIds.length > 0) {
    ids = onlyIds;
  } else {
    const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  const totals = { scenesUploaded: 0, scenesSkipped: 0, finalsUploaded: 0, projects: 0 };
  for (const id of ids.sort()) {
    if (!PROJECT_ID_REGEX.test(id)) {
      console.warn(`⚠ bỏ qua id không hợp lệ: ${id}`);
      continue;
    }
    if (!existsSync(projectJsonPath(id))) {
      console.warn(`⚠ bỏ qua ${id}: không có project.json`);
      continue;
    }
    console.log(`■ ${id}`);
    try {
      const s = await backfillProject(id);
      totals.projects++;
      totals.scenesUploaded += s.scenesUploaded;
      totals.scenesSkipped += s.scenesSkipped;
      if (s.finalUploaded) totals.finalsUploaded++;
      if (s.scenesUploaded === 0 && !s.finalUploaded) console.log('  (không có gì để upload)');
    } catch (err) {
      console.error(`  ✗ lỗi khi xử lý ${id}:`, err?.message || err);
    }
    console.log('');
  }

  console.log('──────── Tổng kết ────────');
  console.log(`Projects xử lý:     ${totals.projects}`);
  console.log(`Scene đã upload:    ${totals.scenesUploaded}`);
  console.log(`Scene bỏ qua (đã có url): ${totals.scenesSkipped}`);
  console.log(`Final đã upload:    ${totals.finalsUploaded}`);
  if (DRY_RUN) console.log('(dry-run — chưa thực sự thay đổi gì)');
}

main().catch((err) => {
  console.error('Lỗi không mong đợi:', err);
  process.exit(1);
});
