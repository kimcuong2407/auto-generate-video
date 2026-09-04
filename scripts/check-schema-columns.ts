/**
 * Self-check: MỌI cột khai báo trong schema Drizzle phải thực sự tồn tại trong DB.
 *
 * Vì sao cần: hai cột (`negative_prompt_override`, `video_seed`) từng được thêm TAY thẳng vào DB
 * production, không qua migration. Production chạy bình thường nên không ai phát hiện — nhưng DB
 * nào dựng sạch từ migration thì thiếu cột, và mọi INSERT job trả 500 "Unknown column". Nặng hơn:
 * 0018_ai_prompts.sql SELECT một trong hai cột đó nên nó chết và chặn luôn 0019/0020/0021.
 *
 * verify-migrations.ts KHÔNG bắt được ca này: nó so hash file .sql đã áp, mà lỗi ở đây là DB có
 * cột nhưng migration không tạo (hoặc ngược lại) — hash vẫn khớp hoàn hảo.
 *
 * Chạy được khi có DB; không cấu hình DB thì skip (để CI không đỏ vì thiếu secret).
 */
import assert from 'node:assert/strict';
import type { RowDataPacket } from 'mysql2';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { getPool } from '../lib/db/client';
import { DB_ENABLED, DB_NAME } from '../lib/db/config';
import * as schema from '../lib/db/schema';

async function main() {
  if (!DB_ENABLED) {
    console.log('⏭  check-schema-columns: DB chưa cấu hình — bỏ qua.');
    return;
  }

  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()`
    );
    const inDb = new Set(rows.map((r) => `${r.t}.${r.c}`));

    const missing: string[] = [];
    let tables = 0;
    let columns = 0;

    for (const table of Object.values(schema)) {
      let cfg: ReturnType<typeof getTableConfig>;
      try {
        cfg = getTableConfig(table as never);
      } catch {
        continue; // không phải bảng (type, enum, helper...)
      }
      tables += 1;
      for (const col of cfg.columns) {
        columns += 1;
        if (!inDb.has(`${cfg.name}.${col.name}`)) missing.push(`${cfg.name}.${col.name}`);
      }
    }

    assert.equal(
      missing.length,
      0,
      `Schema khai báo cột mà DB "${DB_NAME}" KHÔNG có: ${missing.join(', ')}\n` +
        'Thiếu migration tạo cột này. Thêm migration ADD COLUMN IF NOT EXISTS rồi chạy db:migrate.'
    );

    console.log(
      `✅ check-schema-columns: ${columns} cột / ${tables} bảng trong schema đều có trong DB "${DB_NAME}".`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`❌ check-schema-columns: ${(err as Error).message}`);
  process.exit(1);
});
