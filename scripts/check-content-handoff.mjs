// Self-check: instance mới phải tắt được instance cũ qua DOM CustomEvent.
// Mô phỏng isolated world: mỗi instance có scope RIÊNG, chỉ chung `document`.
import assert from 'node:assert';

function makeDocument() {
  const listeners = new Map();
  return {
    addEventListener: (t, fn) => listeners.set(t, [...(listeners.get(t) || []), fn]),
    removeEventListener: (t, fn) =>
      listeners.set(t, (listeners.get(t) || []).filter((f) => f !== fn)),
    dispatchEvent: (ev) => [...(listeners.get(ev.type) || [])].forEach((f) => f()),
    count: (t) => (listeners.get(t) || []).length,
  };
}

const STOP = '__flowGrabberStop';
const live = new Set();

// Mỗi lần gọi = một content script instance mới, scope hoàn toàn tách biệt.
function inject(doc, id) {
  doc.dispatchEvent({ type: STOP });        // hạ instance cũ trước
  let timerId = { id };
  live.add(id);
  doc.addEventListener(STOP, function onStop() {
    doc.removeEventListener(STOP, onStop);
    if (timerId) live.delete(timerId.id);
    timerId = null;
  });
}

const doc = makeDocument();
inject(doc, 1);
assert.deepEqual([...live], [1], 'instance đầu phải sống');

inject(doc, 2);
assert.deepEqual([...live], [2], 'inject lần 2: chỉ instance mới còn sống');

// Reinject nhiều lần (alarm keepalive mỗi phút) không được cộng dồn tick loop.
for (let i = 3; i <= 12; i++) inject(doc, i);
assert.equal(live.size, 1, 'không bao giờ có >1 tick loop chồng nhau');
assert.deepEqual([...live], [12], 'chỉ instance cuối cùng sống');

// Listener đã dùng phải được gỡ, tránh rò rỉ sau nhiều giờ reinject.
assert.equal(doc.count(STOP), 1, 'chỉ còn đúng 1 listener, không rò rỉ');

console.log('✅ handoff content script: tất cả assert pass');
