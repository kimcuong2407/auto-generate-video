/**
 * Barrel export toàn bộ bảng Drizzle — client.ts import `* as schema from './schema'`
 * để bật quan hệ + type-safe query. Hai nhóm bảng (livestream / projects) tách file,
 * gộp lại ở đây cho một điểm import duy nhất.
 */
export * from './livestream';
export * from './projects';
