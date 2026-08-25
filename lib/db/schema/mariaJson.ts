import { customType } from 'drizzle-orm/mysql-core';

export function parseMariaJson(value: unknown): object {
  let parsed = value;
  while (typeof parsed === 'string') parsed = JSON.parse(parsed);
  if (parsed === null || typeof parsed !== 'object') {
    throw new TypeError('Cột JSON MariaDB phải chứa array hoặc object');
  }
  return parsed;
}

/** MariaDB trả cột JSON dưới dạng LONGTEXT, nên cần parse thủ công khi đọc qua mysql2. */
export const mariaJson = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'json',
  // Cột JSON nullable (VD stage_bible) ghi/đọc null hợp lệ — chỉ parse khi thực sự có giá trị,
  // nếu không parseMariaJson sẽ ném TypeError làm hỏng cả lượt ghi job.
  toDriver: (value) => (value == null ? null : JSON.stringify(parseMariaJson(value))),
  fromDriver: (value) => (value == null ? null : parseMariaJson(value)),
});
