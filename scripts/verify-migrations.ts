/**
 * Kiểm tra MỌI migration trong journal đã thực sự được áp lên DB, chạy NGAY SAU `db:migrate`
 * trong pipeline deploy (xem .github/workflows/deploy.yml).
 *
 * Vì sao cần: `drizzle-kit migrate` có thể exit 0 mà không áp gì (kết nối vào nhầm database, file
 * .sql thiếu, journal lệch). Deploy vẫn xanh, PM2 vẫn reload, app chạy với schema thiếu bảng và
 * lỗi chỉ lộ ra khi người dùng bấm nút. Fail ở đây thì `set -e` dừng deploy TRƯỚC lúc reload nên
 * app cũ vẫn phục vụ bình thường.
 *
 * Cách kiểm: so HASH, đúng cơ chế drizzle dùng — mỗi migration đã áp là 1 row trong
 * `__drizzle_migrations` với hash = sha256 nội dung file .sql (xem drizzle-orm/migrator.js).
 * KHÔNG đếm số row: bảng này có thể chứa ít row hơn journal một cách hợp lệ (migration viết tay áp
 * trực tiếp rồi mới bổ sung vào journal), nên đếm sẽ báo động giả mãi mãi.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../lib/db/client';
import { DB_ENABLED, DB_NAME } from '../lib/db/config';

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const MIGRATIONS_DIR = path.join(process.cwd(), 'lib/db/migrations');

async function main(): Promise<void> {
  if (!DB_ENABLED) {
    throw new Error('DB chưa cấu hình (thiếu DB_HOST/DB_USER/DB_NAME) — không verify được migration.');
  }

  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')
  ) as Journal;

  // hash sha256 nội dung file .sql — giống hệt readMigrationFiles() của drizzle-orm.
  const expected = journal.entries.map((e) => {
    const file = path.join(MIGRATIONS_DIR, `${e.tag}.sql`);
    if (!fs.existsSync(file)) {
      throw new Error(`Journal trỏ tới migration không tồn tại: ${e.tag}.sql`);
    }
    return { tag: e.tag, hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  });

  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT `hash` FROM `__drizzle_migrations`');
    const appliedHashes = new Set(rows.map((r) => String(r.hash)));

    const missing = expected.filter((m) => !appliedHashes.has(m.hash));
    if (missing.length > 0) {
      throw new Error(
        `Migration CHƯA áp trên "${DB_NAME}": ${missing.map((m) => m.tag).join(', ')}\n` +
          'Deploy dừng lại để app không chạy với schema thiếu bảng/cột.'
      );
    }

    console.log(
      `✅ verify-migrations: ${expected.length}/${expected.length} migration đã áp trên "${DB_NAME}".`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`❌ verify-migrations: ${(err as Error).message}`);
  process.exit(1);
});
