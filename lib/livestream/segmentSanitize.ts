import { MIN_SEGMENT_DURATION_SEC, SEGMENT_TARGET_DURATION_SEC } from './constants';
import type { LivestreamSegment } from './types';

/**
 * Tính danh sách thời lượng (giây) cho từng đoạn từ tổng thời lượng mục tiêu — mỗi đoạn
 * SEGMENT_TARGET_DURATION_SEC (8s), phần dư cuối < MIN_SEGMENT_DURATION_SEC (4s, dưới mức
 * Veo cho phép) được gộp vào đoạn áp chót thay vì tạo 1 đoạn riêng quá ngắn.
 */
export function computeSegmentDurations(targetDurationSec: number): number[] {
  const safeTarget = Math.max(SEGMENT_TARGET_DURATION_SEC, Math.round(targetDurationSec) || 0);
  const full = Math.floor(safeTarget / SEGMENT_TARGET_DURATION_SEC);
  const remainder = safeTarget - full * SEGMENT_TARGET_DURATION_SEC;

  const durations = Array.from({ length: full }, () => SEGMENT_TARGET_DURATION_SEC);
  if (remainder === 0) {
    return durations;
  }
  if (remainder < MIN_SEGMENT_DURATION_SEC && durations.length > 0) {
    durations[durations.length - 1] += remainder;
  } else {
    durations.push(Math.max(MIN_SEGMENT_DURATION_SEC, remainder));
  }
  return durations;
}

/**
 * Chuẩn hoá danh sách đoạn thô từ AI theo đúng số lượng/thời lượng đã tính trước
 * (computeSegmentDurations). Thừa thì cắt bớt về đúng N (giữ N đoạn đầu). Thiếu thì ném lỗi
 * yêu cầu sinh lại — KHÔNG tự bịa thêm đoạn rỗng (tốn quota Veo cho video vô nghĩa).
 */
export function sanitizeSegments(
  raw: Array<{ voiceoverVi?: string; veoPrompt?: string }>,
  durations: number[]
): LivestreamSegment[] {
  if (!Array.isArray(raw) || raw.length < durations.length) {
    throw new Error(
      `AI chỉ trả về ${Array.isArray(raw) ? raw.length : 0}/${durations.length} đoạn — vui lòng sinh lại`
    );
  }
  const trimmed = raw.slice(0, durations.length);

  return trimmed.map((item, index) => {
    const voiceoverVi = (item.voiceoverVi || '').trim();
    const veoPrompt = (item.veoPrompt || '').trim();
    if (!voiceoverVi || !veoPrompt) {
      throw new Error(`Đoạn thứ ${index + 1} thiếu voiceoverVi hoặc veoPrompt — vui lòng sinh lại`);
    }
    return {
      id: `seg-${(index + 1).toString().padStart(2, '0')}`,
      order: 0, // gán lại giá trị thật (xuyên suốt cả job) qua recomputeSegmentOrder()
      voiceoverVi,
      veoPrompt,
      duration: durations[index],
      status: 'idle',
      jobId: null,
      videoPath: null,
      lastFramePath: null,
      error: null,
      attempts: 0,
      lastUpdatedAt: null,
    };
  });
}
