/**
 * Self-check: thu hồi đoạn kẹt 'generating' mà không có jobId (lib/livestream/segmentSync.ts).
 *
 * Vì sao cần: đây là bug đã thực sự làm job combo-100-khay…f46090 đứng im nhiều giờ trong khi
 * UI vẫn hiển thị "đang chạy". Trạng thái đó lọt qua cả ba đường tự phục hồi (poll cần jobId,
 * resume thoát khi thấy 'generating', cascade chỉ chạy cho đoạn vừa done) nên không có gì kéo
 * job ra được. Guard này là thứ DUY NHẤT chữa, hỏng thì bug quay lại y nguyên và rất khó thấy.
 */
import assert from 'node:assert/strict';
import { __testables } from '../lib/livestream/segmentSync';
import type { LivestreamJob, LivestreamSegment } from '../lib/livestream/types';

const { reclaimOrphanGenerating, ORPHAN_GENERATING_MS } = __testables;

const NOW = Date.parse('2026-09-09T15:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function seg(over: Partial<LivestreamSegment>): LivestreamSegment {
  return {
    id: 'seg-01', order: 1, voiceoverVi: 'x', veoPrompt: 'p', duration: 8,
    status: 'idle', jobId: null, videoPath: null, videoUrl: null,
    attempts: 0, error: null, lastUpdatedAt: ago(60 * 60 * 1000),
    ...over,
  } as LivestreamSegment;
}

const job = (segments: LivestreamSegment[]): LivestreamJob =>
  ({ products: [{ segments }] } as unknown as LivestreamJob);

// --- Ca thật: generating + jobId rỗng + đã lâu → thu hồi về failed.
{
  const j = job([seg({ status: 'generating', jobId: null, attempts: 13 })]);
  assert.equal(reclaimOrphanGenerating(j, NOW), 1);
  const s = j.products[0].segments[0];
  assert.equal(s.status, 'failed', 'phải hạ về failed — trạng thái CÓ đường phục hồi');
  assert.match(s.error ?? '', /không có job Flow/, 'lỗi phải nói rõ nguyên nhân');
  assert.equal(s.attempts, 13, 'KHÔNG được tự tăng/reset attempts: trần retry là thứ chặn đốt quota');
}

// --- Đoạn generating CÓ jobId là đoạn đang chạy thật → tuyệt đối không đụng.
{
  const j = job([seg({ status: 'generating', jobId: 'op-123', lastUpdatedAt: ago(10 * 60 * 60 * 1000) })]);
  assert.equal(reclaimOrphanGenerating(j, NOW), 0, 'đoạn đang chạy thật không được thu hồi dù đã lâu');
  assert.equal(j.products[0].segments[0].status, 'generating');
}

// --- Vừa mới đặt generating (trong cửa sổ ân hạn) → chưa đụng, tránh cắt ngang lúc đang ghi.
{
  const j = job([seg({ status: 'generating', jobId: null, lastUpdatedAt: ago(ORPHAN_GENERATING_MS - 10_000) })]);
  assert.equal(reclaimOrphanGenerating(j, NOW), 0, 'chưa quá cửa sổ ân hạn thì để yên');
  assert.equal(j.products[0].segments[0].status, 'generating');
}

// --- Vừa quá cửa sổ ân hạn → thu hồi.
{
  const j = job([seg({ status: 'generating', jobId: null, lastUpdatedAt: ago(ORPHAN_GENERATING_MS + 1000) })]);
  assert.equal(reclaimOrphanGenerating(j, NOW), 1);
}

// --- lastUpdatedAt rỗng → coi như rất cũ, thu hồi (không để kẹt vô thời hạn vì thiếu mốc thời gian).
{
  const j = job([seg({ status: 'generating', jobId: null, lastUpdatedAt: '' })]);
  assert.equal(reclaimOrphanGenerating(j, NOW), 1, 'thiếu lastUpdatedAt vẫn phải thu hồi được');
}

// --- Các status khác không bị đụng tới.
{
  const j = job([
    seg({ id: 'a', status: 'idle' }),
    seg({ id: 'b', status: 'done' }),
    seg({ id: 'c', status: 'failed' }),
  ]);
  assert.equal(reclaimOrphanGenerating(j, NOW), 0);
  assert.deepEqual(j.products[0].segments.map((s) => s.status), ['idle', 'done', 'failed']);
}

// --- Nhiều product, nhiều đoạn mồ côi → thu hồi hết, đếm đúng.
{
  const j = {
    products: [
      { segments: [seg({ id: 'a', status: 'generating', jobId: null }), seg({ id: 'b', status: 'generating', jobId: 'op-1' })] },
      { segments: [seg({ id: 'c', status: 'generating', jobId: null })] },
    ],
  } as unknown as LivestreamJob;
  assert.equal(reclaimOrphanGenerating(j, NOW), 2, 'phải quét mọi product');
  assert.equal(j.products[0].segments[1].status, 'generating', 'đoạn có jobId vẫn nguyên');
}

// --- Idempotent: chạy lại không đổi gì thêm (poller gọi mỗi 15s).
{
  const j = job([seg({ status: 'generating', jobId: null })]);
  assert.equal(reclaimOrphanGenerating(j, NOW), 1);
  assert.equal(reclaimOrphanGenerating(j, NOW), 0, 'lần hai không được thu hồi lại');
}

console.log('check-orphan-generating: OK');
