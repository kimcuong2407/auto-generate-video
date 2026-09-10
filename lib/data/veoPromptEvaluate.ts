/**
 * Chấm điểm bộ veoPrompt của một project TRƯỚC khi đốt lượt Veo.
 *
 * Vì sao cần: 1 lượt Veo hỏng tốn tiền thật, mà nguyên nhân thường nằm ở prompt chứ không ở
 * model. Trước bước này, prompt sinh xong là dùng luôn — không có điểm nào chặn.
 *
 * Kết hợp 2 nguồn, cố ý:
 *  - auditVeoPrompts(): thứ ĐẾM ĐƯỢC bằng code (thiếu "không phụ đề", giọng lệch, mâu thuẫn
 *    ảnh-vs-tên). Chắc chắn đúng, không tốn lượt AI.
 *  - AI chấm: thứ định tính (prompt có mơ hồ không, tiếp nối có hợp lý không).
 * Kết quả audit được nhét vào user prompt làm dữ kiện đã kiểm chứng, để model khỏi tự đoán
 * những gì máy đã đo chính xác — và để điểm số phản ánh đúng lỗi thật.
 */
import { auditVeoPrompts, EVAL_WARN_THRESHOLD, type AuditFinding } from './veoPromptAudit';
import { loadPromptSet } from '../livestream/promptStore';
import { generateScriptText } from '../googleFlow/flowJobs';
import { withAiCallContext } from '../ai/callLog';
import type { Project, Scene } from '../types';

export interface EvalScores {
  visualCompleteness: number;
  consistency: number;
  productFidelity: number;
  continuity: number;
}

export interface EvalIssue {
  sceneId: string;
  severity: 'error' | 'warn';
  message: string;
}

export interface ScriptEvaluation {
  scores: EvalScores;
  /** Trung bình 4 chiều, làm tròn 1 chữ số — con số Mr.D nhìn đầu tiên. */
  overall: number;
  issues: EvalIssue[];
  summary: string;
  /** Vi phạm do code đo được, tách khỏi `issues` của AI để biết cái nào chắc chắn đúng. */
  audit: AuditFinding[];
  evaluatedAt: string;
}

export { EVAL_WARN_THRESHOLD };

const SCORE_KEYS = ['visualCompleteness', 'consistency', 'productFidelity', 'continuity'] as const;

function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

/**
 * Parse output của model. Model trả JSON nhưng KHÔNG được tin: thiếu field, sai kiểu, bọc trong
 * ```json đều đã gặp thật ở các bước khác. Thiếu gì thì về 0/rỗng chứ không được ném — chấm điểm
 * hỏng không được phép làm hỏng kịch bản vừa sinh.
 */
export function parseEvaluation(raw: string, audit: AuditFinding[]): ScriptEvaluation {
  let obj: Record<string, unknown> = {};
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    // Giữ obj rỗng → điểm 0 + summary báo lỗi parse, xem dưới.
  }

  const rawScores = (obj.scores ?? {}) as Record<string, unknown>;
  const scores = Object.fromEntries(SCORE_KEYS.map((k) => [k, clampScore(rawScores[k])])) as unknown as EvalScores;
  const overall = Math.round((SCORE_KEYS.reduce((n, k) => n + scores[k], 0) / SCORE_KEYS.length) * 10) / 10;

  const issues: EvalIssue[] = Array.isArray(obj.issues)
    ? (obj.issues as Record<string, unknown>[])
        .filter((i) => i && typeof i.message === 'string' && i.message.trim())
        .map((i) => ({
          sceneId: typeof i.sceneId === 'string' ? i.sceneId : '',
          severity: i.severity === 'error' ? 'error' : 'warn',
          message: String(i.message).trim(),
        }))
    : [];

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim()
      : 'Không đọc được kết quả chấm điểm từ AI';

  return { scores, overall, issues, summary, audit, evaluatedAt: new Date().toISOString() };
}

/** Gói kịch bản + kết quả audit thành tin nhắn cho model chấm. */
export function buildEvalUserPrompt(scenes: Scene[], product: Project['product'], audit: AuditFinding[]): string {
  const auditBlock =
    audit.length > 0
      ? audit.map((a) => `- [${a.severity}] ${a.sceneId || 'toàn kịch bản'}: ${a.message}`).join('\n')
      : '- (không phát hiện vi phạm nào)';

  const sceneBlock = scenes
    .map((s) => `### Cảnh ${s.order} — id: ${s.id}\nLời thoại: ${s.voiceoverVi || '(cảnh im lặng)'}\nveoPrompt: ${s.veoPrompt}`)
    .join('\n\n');

  return [
    `Sản phẩm: ${product.name}`,
    product.visualDescription.trim()
      ? `Mô tả hình ảnh THẬT do AI vision đọc từ ảnh sản phẩm (đây là nguồn đúng về hình dáng, ưu tiên hơn tên sản phẩm):\n${product.visualDescription}`
      : 'Chưa có mô tả hình ảnh thật từ ảnh sản phẩm.',
    `\nKết quả máy đã đo (đã kiểm chứng bằng code, tin tưởng và phản ánh vào điểm số):\n${auditBlock}`,
    `\nBộ kịch bản cần chấm (${scenes.length} cảnh):\n\n${sceneBlock}`,
  ].join('\n');
}

/**
 * Chấm điểm 1 project. Ném lỗi nếu AI không trả lời được — caller quyết định nuốt hay không.
 * Đường tự chạy sau khi sinh kịch bản PHẢI nuốt lỗi (xem script/generate/route.ts).
 */
export async function evaluateScript(project: Project): Promise<ScriptEvaluation> {
  const scenes = project.script.scenes;
  const audit = auditVeoPrompts(scenes, project.product);

  const prompts = await loadPromptSet();
  const system = prompts.get('veo_prompt_eval');
  const user = buildEvalUserPrompt(scenes, project.product, audit);

  const raw = await withAiCallContext(
    { stepKey: 'veo_prompt_eval', projectId: project.id, promptScope: prompts.scopeOf('veo_prompt_eval') },
    () => generateScriptText(system, user)
  );
  return parseEvaluation(raw, audit);
}
