// Self-check: logic chọn timeout + không-reject-sớm của requestFreshToken.
import assert from 'node:assert';

const POLLER_STALE_MS = 180_000;
const MINT_TIMEOUT_MS = 20_000;
const MINT_TIMEOUT_ASLEEP_MS = 90_000;

function plan(lastPollAt, now) {
  const staleForMs = lastPollAt > 0 ? now - lastPollAt : 0;
  const asleep = staleForMs > POLLER_STALE_MS;
  return { asleep, timeout: asleep ? MINT_TIMEOUT_ASLEEP_MS : MINT_TIMEOUT_MS, rejectsEarly: false };
}

const now = 10_000_000; // đủ lớn để now - 3_529_000 vẫn dương
// Tab nền bị throttle 60s: KHÔNG được coi là chết (bug cũ fail ở đây).
assert.equal(plan(now - 60_000, now).asleep, false, 'throttle 60s không được coi là offline');
// Lỡ 2 nhịp alarm (2 phút) vẫn phải sống.
assert.equal(plan(now - 120_000, now).asleep, false, 'lỡ 2 alarm vẫn phải sống');
// Quá 3 phút -> nghi ngủ, nhưng vẫn tạo pending và chờ lâu hơn.
const deep = plan(now - 3_529_000, now);
assert.equal(deep.asleep, true);
assert.equal(deep.timeout, MINT_TIMEOUT_ASLEEP_MS, 'poller ngủ phải chờ đủ 1 chu kỳ alarm');
assert(deep.timeout > 60_000, 'timeout phải lớn hơn chu kỳ alarm 1 phút');
// Server vừa khởi động (chưa từng poll) -> không phạt.
assert.equal(plan(0, now).asleep, false, 'chưa từng poll thì không fail oan');
// Bất biến cốt lõi: không bao giờ reject trước khi tạo pending.
for (const lp of [0, now - 1000, now - 3_529_000]) {
  assert.equal(plan(lp, now).rejectsEarly, false, 'không được reject trước khi tạo pending');
}
console.log('✅ tất cả assert pass');
