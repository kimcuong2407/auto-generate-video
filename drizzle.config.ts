/**
 * Cấu hình drizzle-kit: nơi khai báo schema + đích sinh migration SQL.
 *
 * Đọc env DB_* trực tiếp (drizzle-kit chạy ngoài Next nên không có sẵn .env.local —
 * dùng `dotenv` inline qua tsx hoặc export env trước khi chạy). dialect 'mysql' dùng
 * chung cho MariaDB (wire-compatible).
 */
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Next.js đọc .env.local nhưng drizzle-kit chạy độc lập — nạp .env.local trước rồi .env
// (không override biến đã có), để migrate/generate trên VPS dùng đúng cấu hình DB thật.
loadEnv({ path: '.env.local' });
loadEnv();

export default defineConfig({
  dialect: 'mysql',
  schema: './lib/db/schema/index.ts',
  out: './lib/db/migrations',
  dbCredentials: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
  },
  // Log SQL khi push/generate cho dễ soi.
  verbose: true,
  strict: true,
});
