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
  toDriver: (value) => JSON.stringify(parseMariaJson(value)),
  fromDriver: parseMariaJson,
});
