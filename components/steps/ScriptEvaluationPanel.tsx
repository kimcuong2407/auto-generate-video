'use client';

import { useState } from 'react';
import { EVAL_WARN_THRESHOLD } from '@/lib/data/veoPromptAudit';
import type { Project, ScriptEvaluation } from '@/lib/types';

const DIMENSION_LABELS: Record<string, string> = {
  visualCompleteness: 'Đủ 7 thành phần',
  consistency: 'Nhất quán xuyên cảnh',
  productFidelity: 'Bám sản phẩm thật',
  continuity: 'Tiếp nối khung hình',
};

function scoreColor(v: number): string {
  if (v >= 8) return 'var(--green, #16a34a)';
  if (v >= EVAL_WARN_THRESHOLD) return 'var(--amber, #d97706)';
  return 'var(--red, #dc2626)';
}

/**
 * Điểm chất lượng bộ veoPrompt + danh sách chỗ cần sửa, đặt ở Bước 2 trước khi sang gen video.
 *
 * Vì sao đặt ở đây chứ không ở Bước 4: 1 lượt Veo hỏng tốn tiền thật, và sửa prompt sau khi đã
 * gen là quá muộn. Chỗ rẻ nhất để phát hiện là ngay sau khi kịch bản vừa sinh.
 *
 * Vi phạm chia 2 nhóm cố ý: "máy đo được" (audit, chắc chắn đúng vì code đếm) tách khỏi "AI nhận
 * xét" (định tính, có thể sai) — để Mr.D biết cái nào tin được ngay.
 */
export function ScriptEvaluationPanel({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evaluation: ScriptEvaluation | null = project.script.evaluation;

  async function handleEvaluate() {
    setRunning(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${project.id}/script/evaluate`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `API lỗi ${r.status}`);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const hasScenes = project.script.scenes.length > 0;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <details open={!!evaluation}>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          🎯 Chất lượng prompt{' '}
          {evaluation && (
            <span style={{ color: scoreColor(evaluation.overall), fontWeight: 700 }}>
              {evaluation.overall}/10
            </span>
          )}
        </summary>

        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={handleEvaluate} disabled={running || !hasScenes}>
            {running ? 'Đang chấm...' : evaluation ? '🔄 Chấm lại' : '🎯 Chấm điểm prompt'}
          </button>
          {!hasScenes && (
            <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 12 }}>
              Cần sinh kịch bản trước
            </span>
          )}
        </div>

        {error && (
          <div className="badge-error" style={{ marginTop: 10 }}>
            Lỗi chấm điểm: {error}
          </div>
        )}

        {!evaluation && !error && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 10 }}>
            Chưa chấm lần nào. Chấm điểm soi bộ veoPrompt trước khi gen video — rẻ hơn nhiều so với
            một lượt Veo hỏng.
          </div>
        )}

        {evaluation && (
          <>
            {evaluation.overall < EVAL_WARN_THRESHOLD && (
              <div className="banner banner-info" style={{ fontSize: 12, marginTop: 10, borderLeft: `3px solid ${scoreColor(evaluation.overall)}` }}>
                ⚠️ Điểm thấp — nên sửa các mục bên dưới trước khi gen video, tránh đốt lượt Veo oan.
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
              {Object.entries(evaluation.scores).map(([k, v]) => (
                <div key={k} style={{ fontSize: 12 }}>
                  <div style={{ color: 'var(--text-muted)' }}>{DIMENSION_LABELS[k] ?? k}</div>
                  <div style={{ fontWeight: 700, color: scoreColor(v) }}>{v}/10</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>{evaluation.summary}</div>

            {evaluation.audit.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Máy đo được ({evaluation.audit.length})</div>
                <ul style={{ fontSize: 12, lineHeight: 1.6, margin: '4px 0 0', paddingLeft: 18 }}>
                  {evaluation.audit.map((a, i) => (
                    <li key={i} style={{ color: a.severity === 'error' ? 'var(--red, #dc2626)' : 'inherit' }}>
                      {a.sceneId ? <strong>{a.sceneId}: </strong> : null}
                      {a.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {evaluation.issues.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>AI nhận xét ({evaluation.issues.length})</div>
                <ul style={{ fontSize: 12, lineHeight: 1.6, margin: '4px 0 0', paddingLeft: 18 }}>
                  {evaluation.issues.map((it, i) => (
                    <li key={i} style={{ color: it.severity === 'error' ? 'var(--red, #dc2626)' : 'inherit' }}>
                      {it.sceneId ? <strong>{it.sceneId}: </strong> : null}
                      {it.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              Chấm lúc {new Date(evaluation.evaluatedAt).toLocaleString('vi-VN')}
            </div>
          </>
        )}
      </details>
    </div>
  );
}
