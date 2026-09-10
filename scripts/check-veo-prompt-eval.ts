/**
 * Self-check cho parseEvaluation() + buildEvalUserPrompt() — bước chấm điểm veoPrompt.
 *
 * Vì sao cần: output của model là JSON tự do, KHÔNG được tin. Thiếu field, sai kiểu, bọc trong
 * ```json đều đã gặp thật ở các bước khác của project này. Bước chấm điểm chạy TỰ ĐỘNG ngay sau
 * khi sinh kịch bản, nên nếu nó ném lỗi thì có nguy cơ kéo đổ cả lượt sinh kịch bản vừa tốn tiền.
 * Hợp đồng bắt buộc: parse hỏng → điểm 0 + summary báo lỗi, KHÔNG BAO GIỜ ném.
 *
 * Chạy: npx tsx scripts/check-veo-prompt-eval.ts
 */
import assert from 'node:assert/strict';
import { parseEvaluation, buildEvalUserPrompt, EVAL_WARN_THRESHOLD } from '../lib/data/veoPromptEvaluate';
import type { AuditFinding } from '../lib/data/veoPromptAudit';
import type { Scene } from '../lib/types';

const NO_AUDIT: AuditFinding[] = [];

function scene(over: Partial<Scene> & { id: string; order: number }): Scene {
  return {
    label: '', duration: 8, camera: 'static', voiceoverVi: '', onScreenText: '',
    veoPrompt: '', negativePrompt: '', status: 'idle', jobId: null, videoPath: null,
    videoUrl: null, error: null, attempts: 0, lastUpdatedAt: null, lastFramePath: null,
    chainedFromPrevious: false, ...over,
  } as Scene;
}

// 1. Output chuẩn → parse đủ, overall là trung bình 4 chiều.
{
  const raw = JSON.stringify({
    scores: { visualCompleteness: 8, consistency: 9, productFidelity: 7, continuity: 6 },
    issues: [{ sceneId: 'hook', severity: 'error', message: 'Thiếu mô tả góc máy' }],
    summary: 'Khá tốt',
  });
  const e = parseEvaluation(raw, NO_AUDIT);
  assert.equal(e.scores.consistency, 9);
  assert.equal(e.overall, 7.5, '(8+9+7+6)/4 = 7.5');
  assert.equal(e.issues.length, 1);
  assert.equal(e.summary, 'Khá tốt');
}

// 2. Bọc trong ```json → vẫn phải parse được (model rất hay làm vậy dù đã dặn).
{
  const raw = '```json\n{"scores":{"visualCompleteness":10,"consistency":10,"productFidelity":10,"continuity":10},"issues":[],"summary":"Tốt"}\n```';
  const e = parseEvaluation(raw, NO_AUDIT);
  assert.equal(e.overall, 10);
  assert.equal(e.summary, 'Tốt');
}

// 3. Rác hoàn toàn → KHÔNG ném, điểm 0, summary báo lỗi. Đây là hợp đồng quan trọng nhất:
//    chấm điểm chạy tự động sau khi sinh kịch bản, ném lỗi ở đây là mất cả kịch bản vừa tốn tiền.
{
  const e = parseEvaluation('AI hôm nay mệt quá không chấm được', NO_AUDIT);
  assert.equal(e.overall, 0);
  assert.deepEqual(e.issues, []);
  assert.match(e.summary, /Không đọc được/);
}

// 4. Thiếu field / sai kiểu → về 0, không NaN. NaN lọt xuống UI là hiện "NaN điểm".
{
  const e = parseEvaluation('{"scores":{"visualCompleteness":"tám"},"summary":"x"}', NO_AUDIT);
  assert.equal(e.scores.visualCompleteness, 0);
  assert.equal(e.scores.consistency, 0, 'field thiếu hẳn cũng phải về 0');
  assert.ok(Number.isFinite(e.overall), 'overall không được là NaN');
}

// 5. Điểm ngoài thang 0-10 → kẹp lại. Model đã từng trả 100 và -5.
{
  const e = parseEvaluation('{"scores":{"visualCompleteness":100,"consistency":-5,"productFidelity":10,"continuity":10}}', NO_AUDIT);
  assert.equal(e.scores.visualCompleteness, 10);
  assert.equal(e.scores.consistency, 0);
}

// 6. issues rác (thiếu message / không phải mảng) → lọc sạch, không crash UI.
{
  const e = parseEvaluation('{"scores":{},"issues":[{"sceneId":"a"},{"message":"  "},{"message":"thật"}],"summary":"x"}', NO_AUDIT);
  assert.equal(e.issues.length, 1, 'chỉ giữ issue có message thật');
  assert.equal(e.issues[0].message, 'thật');
  assert.equal(e.issues[0].severity, 'warn', 'severity lạ/thiếu → warn, không được mặc định thành error');
}

// 7. audit được giữ NGUYÊN, tách khỏi issues của AI — đây là phần chắc chắn đúng vì code đo được.
{
  const audit: AuditFinding[] = [{ code: 'x', severity: 'error', sceneId: 'a', message: 'lỗi máy đo' }];
  const e = parseEvaluation('{"scores":{},"issues":[],"summary":"x"}', audit);
  assert.deepEqual(e.audit, audit);
}

// 8. buildEvalUserPrompt: kết quả audit PHẢI có mặt, nếu không model tự đoán lại thứ máy đã đo.
{
  const scenes = [scene({ id: 'hook', order: 1, voiceoverVi: 'Chào', veoPrompt: 'mô tả cảnh' })];
  const product = { name: 'Hộp Gấu', tagline: '', category: '', colors: [], material: '', keyFeatures: [], visualDescription: 'hộp hình mèo' };
  const audit: AuditFinding[] = [{ code: 'product_identity_conflict', severity: 'error', sceneId: '', message: 'ảnh là mèo, tên ghi gấu' }];
  const u = buildEvalUserPrompt(scenes, product, audit);
  assert.ok(u.includes('ảnh là mèo, tên ghi gấu'), 'phải nhét kết quả audit vào prompt');
  assert.ok(u.includes('hộp hình mèo'), 'phải nhét visualDescription — nguồn đúng về hình dáng');
  assert.ok(u.includes('mô tả cảnh') && u.includes('hook'), 'phải có veoPrompt và id cảnh');
}

// 9. Không có audit → vẫn phải nói rõ "không phát hiện", đừng để trống gây hiểu nhầm là chưa đo.
{
  const product = { name: 'x', tagline: '', category: '', colors: [], material: '', keyFeatures: [], visualDescription: '' };
  const u = buildEvalUserPrompt([scene({ id: 'a', order: 1 })], product, []);
  assert.ok(u.includes('không phát hiện vi phạm nào'));
}

// 10. Ngưỡng cảnh báo nằm trong thang điểm, nếu không UI cảnh báo sai mọi lúc hoặc không bao giờ.
assert.ok(EVAL_WARN_THRESHOLD > 0 && EVAL_WARN_THRESHOLD < 10);

console.log('✅ check-veo-prompt-eval: 10/10 pass');
