/**
 * Connection pool MariaDB + Drizzle client (singleton).
 *
 * Dùng globalThis guard để không tạo pool trùng khi Next.js hot-reload trong dev (cùng cơ chế
 * với background poller — xem instrumentation.ts). Pool được tạo LAZY ở lần gọi getDb() đầu tiên
 * để import module này không tự mở kết nối lúc build.
 */
import mysql from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import {
  DB_ENABLED,
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  DB_POOL_LIMIT,
} from './config';
import * as schema from './schema';

type Db = MySql2Database<typeof schema>;

interface DbSingleton {
  pool: mysql.Pool;
  db: Db;
}

const globalForDb = globalThis as unknown as { __dbSingleton?: DbSingleton };

function createSingleton(): DbSingleton {
  if (!DB_ENABLED) {
    throw new Error(
      'MariaDB chưa được cấu hình. Cần đặt DB_HOST, DB_USER, DB_NAME (và DB_PASSWORD nếu có) ' +
        'trong .env.local — xem .env.example.'
    );
  }
  const pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    connectionLimit: DB_POOL_LIMIT,
    // MariaDB trả DATETIME dạng string; giữ nguyên để tự parse/format ISO ở tầng store.
    dateStrings: true,
    // Bật hỗ trợ nhiều statement cho migration runner tự viết (chạy file .sql).
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { pool, db };
}

/** Lấy Drizzle client (tạo pool lần đầu). Ném lỗi nếu DB chưa cấu hình. */
export function getDb(): Db {
  if (!globalForDb.__dbSingleton) {
    globalForDb.__dbSingleton = createSingleton();
  }
  return globalForDb.__dbSingleton.db;
}

/** Lấy raw pool (dùng cho migration runner / script import). */
export function getPool(): mysql.Pool {
  if (!globalForDb.__dbSingleton) {
    globalForDb.__dbSingleton = createSingleton();
  }
  return globalForDb.__dbSingleton.pool;
}
