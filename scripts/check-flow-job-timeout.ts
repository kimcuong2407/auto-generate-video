/**
 * Self-check: timeout KHÔNG được giết job mà Google vẫn báo đang chạy.
 *
 * Vì sao cần (xác minh 2026-09-09, job combo-100-khay…f46090 seg1): Veo tier low_priority
 * render lâu hơn 15 phút là bình thường. Timeout mềm cũ giết đoạn khi Flow vẫn 'running' →
 * người dùng bấm gen lại → tốn thêm một lượt quota → lại timeout. Lặp 14 lần, còn job Veo bị
 * bỏ rơi vẫn chạy tiếp bên Google (poll thủ công lúc app đã 'failed' vẫn trả 'running').
 *
 * Ranh giới cần giữ:
 * - Flow nói pending/running  → chỉ bỏ cuộc ở TRẦN TUYỆT ĐỐI (job kẹt thật phía Google).
 * - Poll lỗi (không biết gì)  → giữ timeout mềm, vì ở đó ta thật sự mù thông tin.
 */
import assert from 'node:assert/strict';
import { __testables } from '../lib/livestream/segmentSync';
import { FLOW_JOB_TIMEOUT_MS, FLOW_JOB_HARD_TIMEOUT_MS } from '../lib/constants';
import type { LivestreamSegment } from '../lib/livestream/types';

const { isTimedOut, isHardTimedOut } = __testables;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const seg = (lastUpdatedAt: string): LivestreamSegment =>
  ({ id: 'seg-01', status: 'generating', jobId: 'op-1', lastUpdatedAt } as LivestreamSegment);

// --- Trần tuyệt đối phải NỚI HƠN timeout mềm, nếu không việc tách hai khái niệm là vô nghĩa.
//
// Đây là ràng buộc chặn tái phát bug gốc: hạ trần xuống <= 15 phút là quay lại đúng hành vi
// giết job mà Google vẫn báo 'running'. Trần có thể chỉnh theo dữ liệu log, nhưng không được
// chỉnh xuống dưới mốc này.
{
  assert.ok(
    FLOW_JOB_HARD_TIMEOUT_MS > FLOW_JOB_TIMEOUT_MS,
    `trần tuyệt đối (${FLOW_JOB_HARD_TIMEOUT_MS}ms) phải lớn hơn timeout mềm (${FLOW_JOB_TIMEOUT_MS}ms)`
  );
}

// --- Ca gây bug: job chạy 16 phút, Flow vẫn 'running'.
// Timeout mềm ĐÃ quá hạn (đó là lý do bug xảy ra) nhưng trần tuyệt đối thì chưa →
// nhánh running không được giết nó.
{
  const s = seg(ago(16 * 60 * 1000));
  assert.equal(isTimedOut(s), true, 'timeout mềm đã quá hạn ở mốc 16 phút (bối cảnh của bug)');
  assert.equal(isHardTimedOut(s), false, 'nhưng trần tuyệt đối CHƯA — job đang chạy phải được để yên');
}

// --- Ngay dưới trần tuyệt đối: vẫn để yên.
{
  assert.equal(isHardTimedOut(seg(ago(FLOW_JOB_HARD_TIMEOUT_MS - 60_000))), false);
}

// --- Vượt trần tuyệt đối: bỏ cuộc, nếu không đoạn kẹt 'generating' vĩnh viễn.
{
  assert.equal(isHardTimedOut(seg(ago(FLOW_JOB_HARD_TIMEOUT_MS + 60_000))), true);
}

// --- lastUpdatedAt rỗng: KHÔNG được coi là quá trần.
// Chuỗi rỗng → getTime() ra 0 → Date.now() - 0 luôn > mọi ngưỡng, tức mọi đoạn thiếu mốc
// thời gian sẽ bị giết oan ngay vòng poll đầu. Đây là bẫy thật, không phải ca giả định.
{
  assert.equal(isHardTimedOut(seg('')), false, 'thiếu lastUpdatedAt không được giết oan');
  assert.equal(isHardTimedOut(seg('không-phải-ngày')), false, 'ngày hỏng không được giết oan');
}

// --- Timeout mềm giữ nguyên hành vi cũ (nhánh catch vẫn dựa vào nó).
{
  assert.equal(isTimedOut(seg(ago(FLOW_JOB_TIMEOUT_MS + 60_000))), true);
  assert.equal(isTimedOut(seg(ago(FLOW_JOB_TIMEOUT_MS - 60_000))), false);
}

console.log('check-flow-job-timeout: OK');
