'use client';

import { useState } from 'react';

export interface PendingStepInfo {
  gateId: string;
  stepKey: string;
  label: string;
  prompt: string;
  note?: string;
}

/**
 * Modal duyệt MỘT bước AI đang dừng chờ giữa lượt sinh script (chế độ debug).
 *
 * Khác PromptPreviewModal: modal kia xem trước rồi mới BẮT ĐẦU chạy, còn modal này xuất hiện khi
 * server ĐANG chờ giữa chừng. Vì vậy KHÔNG đóng được bằng click nền hay nút ✕ — bỏ lửng đồng
 * nghĩa treo request tới hết 10 phút timeout. Mọi đường ra phải là quyết định rõ ràng: chạy hoặc
 * bỏ qua.
 */
export function StepConfirmModal({
  jobId,
  step,
  index,
  onDecided,
}: {
  jobId: string;
  step: PendingStepInfo;
  /** Thứ tự bước trong lượt chạy này — để Mr.D biết đang ở đâu trong chuỗi. */
  index: number;
  onDecided: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'run' | 'skip') {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/livestream/${jobId}/script/confirm-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateId: step.gateId, decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      onDecided();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="media-modal-overlay">
      <div
        className="media-modal-content prompt-preview-modal"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          width: 820,
          maxWidth: '92vw',
          textAlign: 'left',
        }}
      >
        <h4 className="prompt-preview-head">
          🐞 Duyệt bước #{index}: {step.label}{' '}
          <code style={{ fontSize: 11, opacity: 0.6, fontWeight: 400 }}>{step.stepKey}</code>
        </h4>

        <div className="prompt-preview-body">
          <div className="banner banner-info" style={{ fontSize: 12 }}>
            Chế độ debug đang bật — lượt sinh script đã <strong>dừng lại</strong> và đang chờ ở đây.
            Dưới đây là chuỗi thật sắp gửi cho AI. Tắt chế độ debug ở{' '}
            <a href="/settings/prompts">/settings/prompts</a> để chạy thẳng không hỏi nữa.
          </div>

          {step.note && (
            <div className="banner" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {step.note}
            </div>
          )}

          {error && <div className="banner banner-error">{error}</div>}

          <div style={{ fontSize: 13, opacity: 0.8, margin: '10px 0 6px' }}>
            Prompt gửi đi ({step.prompt.length.toLocaleString('vi-VN')} ký tự):
          </div>
          <pre
            style={{
              maxHeight: 400,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.5,
              border: '1px solid var(--border)',
              padding: 10,
              borderRadius: 8,
            }}
          >
            {step.prompt || '(bước này không dựng được preview prompt)'}
          </pre>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => decide('skip')} disabled={sending}>
              ⏭ Bỏ qua bước này
            </button>
            <button className="btn btn-primary" onClick={() => decide('run')} disabled={sending}>
              {sending ? 'Đang gửi...' : '✅ Chạy bước này'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
