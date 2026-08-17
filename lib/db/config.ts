/**
 * Cấu hình kết nối MariaDB — đọc trực tiếp từ process.env theo đúng pattern lib/constants.ts
 * (không có lớp config tập trung). Thiếu bất kỳ biến bắt buộc nào = DB_ENABLED false; store
 * sẽ báo lỗi rõ ràng khi bị gọi thay vì fail âm thầm ở tầng driver.
 */

export const DB_HOST = process.env.DB_HOST || '';
export const DB_PORT = Number(process.env.DB_PORT || 3306);
export const DB_USER = process.env.DB_USER || '';
export const DB_PASSWORD = process.env.DB_PASSWORD || '';
export const DB_NAME = process.env.DB_NAME || '';

// Số kết nối tối đa trong pool. Đủ cho vài request đồng thời + background poller.
export const DB_POOL_LIMIT = Number(process.env.DB_POOL_LIMIT || 10);

// Đủ 4 biến cốt lõi (host/user/name + password có thể rỗng với user không mật khẩu ở dev) = bật.
export const DB_ENABLED = !!(DB_HOST && DB_USER && DB_NAME);
