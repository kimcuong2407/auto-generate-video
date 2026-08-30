import { chatCompletion } from '../ai/chatClient';
import { extractJson } from '../ai/jsonExtract';
import { SCRIPT_QA_SYSTEM_PROMPT } from './promptDefaults';
import type { LivestreamSegment } from './types';

/** 1 cảnh bị QA gắn cờ. `scene` là số thứ tự cảnh (1-based) như hiển thị trên UI. */
export interface ScriptQaIssue {
  scene: number;
  /** id đoạn tương ứng — điền ở đây để UI trỏ đúng đoạn mà không phải tự đếm lại. */
  segmentId: string;
  group: 'vật lý' | 'claim';
  severity: 'cao' | 'thấp';
  /** Trích đoạn gây lỗi, để người đọc tự đối chiếu thay vì tin lời model. */
  quote: string;
  reason: string;
  fix: string;
}

/** Trần số cảnh gửi đi 1 lượt — job dài 32 đoạn nhồi hết vào 1 prompt là quá tải context. */
const MAX_SCENES_PER_BATCH = 12;

function normalizeGroup(raw: unknown): ScriptQaIssue['group'] {
  return String(raw ?? '').toLowerCase().includes('claim') ? 'claim' : 'vật lý';
}

function normalizeSeverity(raw: unknown): ScriptQaIssue['severity'] {
  return String(raw ?? '').toLowerCase().includes('thấp') ? 'thấp' : 'cao';
}

/**
 * Chấm kịch bản đã sinh: lỗi vật lý (trên veoPrompt) + lỗi claim (trên voiceoverVi).
 *
 * CHỈ TRẢ VỀ CẢNH BÁO, KHÔNG sửa gì. Lý do chọn cảnh báo thay vì tự viết lại: kịch bản tới đây đã
 * qua sanitize và rút gọn số từ, ghi đè thêm một lần nữa bằng bản chưa kiểm chứng là rủi ro lớn
 * hơn lợi ích — nhất là khi Mr.D có thể đã sửa tay. Muốn nâng lên tự viết lại thì khuôn đã có sẵn
 * ở shortenOverlongSegments.
 *
 * Best-effort giống mọi bước AI phụ trong luồng này: model lỗi, JSON hỏng, hay chưa cấu hình đều
 * trả mảng rỗng và KHÔNG chặn sinh script — QA hỏng không được phép làm hỏng cả lượt sinh.
 *
 * Chia lô MAX_SCENES_PER_BATCH cảnh/lượt; đánh số cảnh trong prompt là số TUYỆT ĐỐI (1-based
 * trong sản phẩm) để model trả về đúng số cảnh mà UI đang hiển thị, không phải số trong lô.
 */
export async function reviewScriptQuality(
  segments: LivestreamSegment[]
): Promise<ScriptQaIssue[]> {
  if (segments.length === 0) return [];

  const issues: ScriptQaIssue[] = [];

  for (let start = 0; start < segments.length; start += MAX_SCENES_PER_BATCH) {
    const batch = segments.slice(start, start + MAX_SCENES_PER_BATCH);
    const user = batch
      .map((seg, i) => {
        const scene = start + i + 1;
        return `### Cảnh ${scene}\nLời thoại MC: ${seg.voiceoverVi}\nCâu lệnh tạo video: ${seg.veoPrompt}`;
      })
      .join('\n\n');

    try {
      const raw = await chatCompletion(
        SCRIPT_QA_SYSTEM_PROMPT,
        `Chấm các cảnh sau. Đánh số cảnh trong kết quả PHẢI trùng đúng số cảnh ghi ở đây:\n\n${user}`
      );
      const parsed = JSON.parse(extractJson(raw)) as {
        issues?: Array<Record<string, unknown>>;
      };
      if (!Array.isArray(parsed.issues)) continue;

      for (const it of parsed.issues) {
        const scene = Number(it.scene);
        // Model đôi khi trả số cảnh ngoài lô (đếm lại từ 1, hoặc bịa). Bỏ luôn thay vì gán bừa
        // vào một đoạn nào đó — cảnh báo trỏ sai đoạn còn tệ hơn không cảnh báo.
        if (!Number.isInteger(scene) || scene < start + 1 || scene > start + batch.length) continue;
        const seg = segments[scene - 1];
        const reason = String(it.reason ?? '').trim();
        if (!reason) continue;
        issues.push({
          scene,
          segmentId: seg.id,
          group: normalizeGroup(it.group),
          severity: normalizeSeverity(it.severity),
          quote: String(it.quote ?? '').trim(),
          reason,
          fix: String(it.fix ?? '').trim(),
        });
      }
    } catch (err) {
      // Không chặn luồng, nhưng phải LOG — QA im lặng không chạy sẽ bị hiểu nhầm là "kịch bản sạch".
      console.error(`[scriptQa] chấm kịch bản thất bại: ${(err as Error).message}`);
    }
  }

  // Lỗi nặng lên trước, cùng mức thì theo thứ tự cảnh — UI hiển thị từ trên xuống là đọc được ngay.
  return issues.sort((a, b) =>
    a.severity === b.severity ? a.scene - b.scene : a.severity === 'cao' ? -1 : 1
  );
}
