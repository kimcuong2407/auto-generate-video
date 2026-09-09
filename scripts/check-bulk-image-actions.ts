/**
 * Self-check logic bulk action ảnh sản phẩm (JobImagePanel).
 * Route /images/detach là TOGGLE, nên bulk "bật/tắt gen video" chỉ được gọi khi trạng thái LỆCH —
 * gọi thừa sẽ lật ngược đúng cái vừa đặt. Đây là chỗ dễ sai nhất nên chốt lại bằng assert.
 */
import assert from 'node:assert';
import { pathsNeedingToggle } from '../lib/livestream/refImages';

/** Mô phỏng server: mỗi lần gọi detach là toggle. */
function applyToggles(detached: string[], calls: string[]): string[] {
  const set = new Set(detached);
  for (const rel of calls) (set.has(rel) ? set.delete(rel) : set.add(rel));
  return [...set].sort();
}

const all = ['a', 'b', 'c'];

// Bật gen video cho a,b khi chỉ a đang bị tách → chỉ gọi a, kết quả không còn ai bị tách.
let calls = pathsNeedingToggle(['a', 'b'], ['a'], 'active');
assert.deepStrictEqual(calls, ['a']);
assert.deepStrictEqual(applyToggles(['a'], calls), []);

// Tắt gen video cho cả 3 khi a đã tách → chỉ gọi b,c; cả 3 cùng bị tách.
calls = pathsNeedingToggle(all, ['a'], 'inactive');
assert.deepStrictEqual(calls, ['b', 'c']);
assert.deepStrictEqual(applyToggles(['a'], calls), ['a', 'b', 'c']);

// Idempotent: bấm "tắt" lần nữa không gọi gì, trạng thái giữ nguyên.
calls = pathsNeedingToggle(all, all, 'inactive');
assert.deepStrictEqual(calls, []);
assert.deepStrictEqual(applyToggles(all, calls), all);

console.log('✅ check-bulk-image-actions: OK');
