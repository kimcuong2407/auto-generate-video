import assert from 'node:assert/strict';
import { mysqlTable } from 'drizzle-orm/mysql-core';
import { mariaJson } from '../lib/db/schema/mariaJson';

const table = mysqlTable('json_check', { value: mariaJson('value') });
const column = table.value;
const values = [['a', 'b'], { nested: { ok: true } }];

assert.equal(column.getSQLType(), 'json');
for (const value of values) {
  const encoded = column.mapToDriverValue(value);
  assert.deepEqual(column.mapFromDriverValue(encoded), value);
  assert.equal(column.mapFromDriverValue(value), value);
  assert.equal(column.mapToDriverValue(encoded), encoded);
  assert.deepEqual(column.mapFromDriverValue(JSON.stringify(encoded)), value);
}
assert.throws(() => column.mapFromDriverValue('not-json'));
assert.throws(() => column.mapFromDriverValue('"scalar"'));

console.log('MariaDB JSON mapper: OK');
