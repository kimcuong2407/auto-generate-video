/**
 * Self-check mergeSegmentsKeepingVideos (lib/livestream/segmentSanitize.ts):
 * sinh lại kịch bản KHÔNG được xoá video của đoạn có nội dung không đổi,
 * nhưng PHẢI bỏ video khi lời thoại/prompt/thời lượng đổi.
 * Chạy: npx tsx scripts/check-segment-merge.ts
 */
import assert from 'node:assert';
import { mergeSegmentsKeepingVideos } from '../lib/livestream/segmentSanitize';
import type { LivestreamSegment } from '../lib/livestream/types';

const seg = (over: Partial<LivestreamSegment> = {}): LivestreamSegment => ({
  id: 'seg-01',
  order: 1,
  voiceoverVi: 'xin chào',
  veoPrompt: 'a man holding a bottle',
  duration: 8,
  status: 'idle',
  jobId: null,
  videoPath: null,
  videoUrl: null,
  lastFramePath: null,
  error: null,
  attempts: 0,
  lastUpdatedAt: null,
  ...over,
});

const doneSeg = (over: Partial<LivestreamSegment> = {}) =>
  seg({
    status: 'done',
    jobId: 'flow-123',
    videoPath: 'outputs/segments/001_seg-01.mp4',
    videoUrl: 'https://r2/001_seg-01.mp4',
    lastFramePath: 'outputs/frames/001.jpg',
    attempts: 2,
    lastUpdatedAt: '2026-08-27T03:08:00.000Z',
    ...over,
  });

// 1. Nội dung y hệt → giữ nguyên video + jobId + attempts.
{
  const [m] = mergeSegmentsKeepingVideos([seg()], [doneSeg()]);
  assert.equal(m.status, 'done');
  assert.equal(m.videoPath, 'outputs/segments/001_seg-01.mp4');
  assert.equal(m.videoUrl, 'https://r2/001_seg-01.mp4');
  assert.equal(m.jobId, 'flow-123');
  assert.equal(m.lastFramePath, 'outputs/frames/001.jpg');
  assert.equal(m.attempts, 2);
}

// 2. Đổi lời thoại / prompt / thời lượng → KHÔNG giữ video (kịch bản đã khác).
for (const over of [
  { voiceoverVi: 'lời thoại mới' },
  { veoPrompt: 'a woman holding a box' },
  { duration: 6 },
]) {
  const [m] = mergeSegmentsKeepingVideos([seg(over)], [doneSeg()]);
  assert.equal(m.status, 'idle', `phải reset khi đổi ${Object.keys(over)[0]}`);
  assert.equal(m.videoPath, null);
  assert.equal(m.videoUrl, null);
  assert.equal(m.attempts, 0);
}

// 3. Đoạn cũ chưa done (failed/generating/idle) → không mang trạng thái cũ sang.
for (const status of ['idle', 'failed', 'generating'] as const) {
  const [m] = mergeSegmentsKeepingVideos([seg()], [doneSeg({ status })]);
  assert.equal(m.status, 'idle');
  assert.equal(m.videoPath, null);
}

// 4. Đoạn cũ done nhưng mất videoPath → coi như không có video.
{
  const [m] = mergeSegmentsKeepingVideos([seg()], [doneSeg({ videoPath: null })]);
  assert.equal(m.status, 'idle');
  assert.equal(m.videoPath, null);
}

// 5. Kịch bản mới dài hơn: đoạn cũ trùng giữ video, đoạn mới hoàn toàn thì idle.
{
  const next = [seg(), seg({ id: 'seg-02', voiceoverVi: 'đoạn hai' })];
  const merged = mergeSegmentsKeepingVideos(next, [doneSeg()]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].status, 'done');
  assert.equal(merged[1].status, 'idle');
  assert.equal(merged[1].videoPath, null);
}

// 6. Kịch bản mới ngắn hơn: đoạn cũ dư bị bỏ, không rò rỉ sang kết quả.
{
  const merged = mergeSegmentsKeepingVideos(
    [seg()],
    [doneSeg(), doneSeg({ id: 'seg-02', voiceoverVi: 'đoạn hai' })]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'seg-01');
}

// 7. Không làm biến dạng mảng cũ (thuần hàm).
{
  const prev = [doneSeg()];
  const snapshot = JSON.stringify(prev);
  mergeSegmentsKeepingVideos([seg({ voiceoverVi: 'khác' })], prev);
  assert.equal(JSON.stringify(prev), snapshot);
}

console.log('✓ check-segment-merge OK');
