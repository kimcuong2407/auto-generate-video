import assert from 'node:assert';
import { resolveCardOpen } from '../lib/livestream/cardState';

// Chưa từng lưu → theo mặc định của card.
assert.strictEqual(resolveCardOpen(null, false), false);
assert.strictEqual(resolveCardOpen(null, true), true);

// Đã lưu thì LUÔN thắng mặc định — kể cả khi lưu "đóng" mà card mặc định mở.
assert.strictEqual(resolveCardOpen('1', false), true);
assert.strictEqual(resolveCardOpen('0', true), false);

// Giá trị rác (bản cũ / người dùng sửa tay) coi như đóng, không crash.
assert.strictEqual(resolveCardOpen('yes', true), false);

console.log('✅ check-card-state: OK');
