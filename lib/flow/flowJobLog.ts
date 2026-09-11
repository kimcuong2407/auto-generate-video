/**
 * Ghi LOG 1 lượt gửi video lên Google Veo/Flow (bảng flow_job_logs).
 *
 * Vì sao cần bên cạnh data/logs/flow.log: file text xoay vòng ở 10MB và không lọc/sắp/đối chiếu
 * được. Muốn trả lời "cảnh này hôm qua gửi prompt gì, ảnh nào, vì sao fail" thì phải có bảng.
 * flow.log vẫn giữ nguyên cho dòng sự kiện chi tiết (poll/cascade/auto-trigger) — hai thứ bổ sung
 * nhau, không thay thế.
 *
 * HỢP ĐỒNG (giống recordAiCall ở lib/ai/callLog.ts, và phải giữ y hệt):
 *   - TUYỆT ĐỐI KHÔNG NÉM. Log là phụ trợ; để nó làm fail một lượt gen là đổi tính năng quan sát
 *     lấy một hồi quy thật.
 *   - Gọi bằng `void recordFlowJob(...)`, KHÔNG await: một lượt gen livestream có tới 32 đoạn,
 *     await ở đây là cộng độ trễ DB vào từng đoạn.
 *   - DB chưa cấu hình → return sớm, không phải lỗi.
 */
import { getDb } from '../db/client';
import { DB_ENABLED } from '../db/config';
import { flowJobLogs } from '../db/schema/flowJobLogs';

export interface FlowJobLogRow {
  /** 'livestream-v1' | 'livestream-v2' | 'product-review' — xem lib/logs/sourceKind.ts. */
  sourceKind: string;
  /** Chủ sở hữu: livestream dùng jobSlug, review dùng projectId. Cái còn lại để ''. */
  jobSlug?: string;
  projectId?: string;
  /** sceneId (review) hoặc segmentId (livestream). */
  unitId: string;
  unitOrder: number;
  /** job_id Google trả về. Bỏ trống = hỏng trước khi gửi được. */
  flowJobId?: string;
  flowProjectId?: string;
  model: string;
  aspect: string;
  durationSec: number;
  /**
   * Prompt ĐÚNG NHƯ ĐÃ GỬI (đã ghép lời Việt + chặn phụ đề + negative).
   * Nếu buộc phải ghi bản thô thì đặt promptIsRaw = true — đừng để người đọc tưởng đây là bản thật.
   */
  veoPrompt: string;
  promptIsRaw?: boolean;
  voiceoverVi?: string | null;
  negativePrompt?: string | null;
  refImagePaths?: string[] | null;
  startImagePath?: string;
  chained?: boolean;
  errorMessage?: string | null;
  /** 'quota' | 'mcp' | 'api' | '' — lấy từ isQuotaError/isMcpUnavailableError đã tính ở call-site. */
  errorKind?: string;
  attempts: number;
  durationMs: number;
}

export async function recordFlowJob(row: FlowJobLogRow): Promise<void> {
  if (!DB_ENABLED) return;
  try {
    // UTC, cùng quy ước isoToSql (lib/db/datetime.ts): cột DATETIME không mang timezone nên phải
    // thống nhất ghi UTC, hiển thị mới đổi sang +7.
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    await getDb()
      .insert(flowJobLogs)
      .values({
        sourceKind: row.sourceKind,
        jobSlug: row.jobSlug ?? '',
        projectId: row.projectId ?? '',
        unitId: row.unitId,
        unitOrder: row.unitOrder,
        flowJobId: row.flowJobId ?? '',
        flowProjectId: row.flowProjectId ?? '',
        model: row.model,
        aspect: row.aspect,
        durationSec: row.durationSec,
        veoPrompt: row.veoPrompt,
        promptIsRaw: row.promptIsRaw ?? false,
        voiceoverVi: row.voiceoverVi ?? null,
        negativePrompt: row.negativePrompt ?? null,
        refImagePaths: row.refImagePaths ?? null,
        startImagePath: row.startImagePath ?? '',
        chained: row.chained ?? false,
        errorMessage: row.errorMessage ?? null,
        errorKind: row.errorKind ?? '',
        attempts: row.attempts,
        durationMs: row.durationMs,
        createdAt: now,
      });
  } catch (err) {
    console.error(`[flowJobLog] ghi log thất bại (unit=${row.unitId}): ${(err as Error).message}`);
  }
}
