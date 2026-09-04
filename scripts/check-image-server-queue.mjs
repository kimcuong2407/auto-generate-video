/**
 * Self-check cho hàng đợi của chatgpt-image-server: enqueue → claim → complete và reap job treo.
 * Assert thuần, không framework. Chạy: `node scripts/check-image-server-queue.mjs`
 */
import assert from 'node:assert/strict';
import { createQueue } from './chatgpt-image-server.mjs';

// --- Vòng đời cơ bản: enqueue → claim → complete ---
{
  const q = createQueue();
  const j = q.enqueue({ prompt: 'con mèo', refImages: [] });
  assert.equal(j.status, 'queued', 'job mới phải queued');

  const claimed = q.claimNext(1000);
  assert.equal(claimed.id, j.id, 'claim đúng job vừa đẩy');
  assert.equal(claimed.status, 'running', 'claim xong phải running');
  assert.equal(claimed.startedAt, 1000, 'startedAt = now truyền vào');

  assert.equal(q.claimNext(1000), null, 'không còn job queued thì trả null');

  q.complete(j.id, { imageBase64: 'QUJD', ext: 'png' });
  const done = q.get(j.id);
  assert.equal(done.status, 'done', 'complete có ảnh → done');
  assert.equal(done.imageBase64, 'QUJD');
  assert.equal(done.ext, 'png');
}

// --- FIFO: job cũ hơn được giao trước ---
{
  const q = createQueue();
  const a = q.enqueue({ prompt: 'A' });
  const b = q.enqueue({ prompt: 'B' });
  assert.equal(q.claimNext(10).id, a.id, 'job đẩy trước phải được giao trước');
  assert.equal(q.claimNext(11).id, b.id, 'rồi tới job sau');
}

// --- complete với error → status error, không có ảnh ---
{
  const q = createQueue();
  const j = q.enqueue({ prompt: 'X' });
  q.claimNext(0);
  q.complete(j.id, { error: 'ChatGPT trả text' });
  const g = q.get(j.id);
  assert.equal(g.status, 'error');
  assert.equal(g.imageBase64, null);
  assert.match(g.error, /trả text/);
}

// --- reap: job running quá staleMs → error ---
{
  const q = createQueue({ staleMs: 1000 });
  const j = q.enqueue({ prompt: 'lâu' });
  q.claimNext(100); // startedAt = 100
  q.reap(100 + 500); // chưa quá hạn
  assert.equal(q.get(j.id).status, 'running', 'chưa quá staleMs thì vẫn running');
  q.reap(100 + 2000); // quá hạn
  assert.equal(q.get(j.id).status, 'error', 'quá staleMs thì thành error');
  assert.match(q.get(j.id).error, /timeout/);
}

// --- claimNext tự reap job treo trước khi giao job mới ---
{
  const q = createQueue({ staleMs: 1000 });
  const stuck = q.enqueue({ prompt: 'treo' });
  q.claimNext(0); // stuck → running tại t=0
  const fresh = q.enqueue({ prompt: 'mới' });
  const next = q.claimNext(5000); // t=5000 > staleMs → stuck bị reap, giao 'mới'
  assert.equal(q.get(stuck.id).status, 'error', 'job treo bị reap khi claim lượt sau');
  assert.equal(next.id, fresh.id, 'giao job mới, không kẹt vì job treo');
}

// --- complete job không tồn tại → null, không ném ---
{
  const q = createQueue();
  assert.equal(q.complete('không-có', { imageBase64: 'x' }), null);
}

// --- stats phản ánh đúng số lượng ---
{
  const q = createQueue();
  q.enqueue({ prompt: '1' });
  const running = q.enqueue({ prompt: '2' });
  q.claimNext(0);
  const s = q.stats(0);
  assert.equal(s.total, 2);
  assert.equal(s.queued, 1);
  assert.equal(s.running, 1);
  void running;
}

console.log('check-image-server-queue: OK');
