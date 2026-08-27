'use client';

import { useEffect, useState } from 'react';

interface PreviewData {
  prompt: string;
  refImages: { rel: string; label: string }[];
  notes: string[];
}

/**
 * Modal xem trước prompt + ảnh ref sẽ gửi cho AI ở 1 bước gen (background hoặc script).
 *
 * Vì sao cần: prompt thật được ghép SERVER-SIDE từ nhiều mảnh, UI chỉ cho sửa 1 mảnh. Modal này
 * gọi GET /api/livestream/[id]/preview-prompt để lấy đúng chuỗi server sẽ gửi — không tự ghép lại
 * ở client, nếu không 2 bên sẽ trôi lệch nhau như bug "prompt hiện khác prompt gửi đi" trước đây.
 *
 * Route preview KHÔNG gọi AI nên mở bao nhiêu lần cũng miễn phí; mảnh nào chưa có sẽ nằm ở `notes`.
 */
export function PromptPreviewModal({
  jobId,
  step,
  productId,
  promptOverride,
  imageR2Urls,
  onClose,
}: {
  jobId: string;
  step: 'background' | 'script';
  productId?: string;
  /** Bản nháp prompt đang sửa trên UI (chỉ bước background) — để preview khớp thứ sắp gửi. */
  promptOverride?: string;
  /** job.imageR2Urls — ưu tiên URL R2 khi hiện thumbnail, file local có thể đã mất sau deploy. */
  imageR2Urls?: Record<string, string | null>;
  onClose: () => void;
}) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ step });
    if (productId) qs.set('productId', productId);
    if (promptOverride?.trim()) qs.set('prompt', promptOverride);
    fetch(`/api/livestream/${jobId}/preview-prompt?${qs}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json);
      })
      .catch((err: Error) => setError(err.message));
  }, [jobId, step, productId, promptOverride]);

  const title = step === 'background' ? 'Prompt gen ảnh background' : 'Prompt sinh script';

  return (
    <div className="media-modal-overlay" onClick={onClose}>
      <div
        className="media-modal-content"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 20,
          width: 680,
          maxWidth: '92vw',
          textAlign: 'left',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="media-modal-close" onClick={onClose} title="Đóng">
          ✕
        </button>
        <h4 style={{ marginTop: 0 }}>👁 {title} — xem trước</h4>

        {error && <div className="banner banner-error">{error}</div>}
        {!data && !error && <div style={{ opacity: 0.7 }}>Đang tải...</div>}

        {data && (
          <>
            {data.notes.map((n) => (
              <div key={n} className="banner banner-info" style={{ fontSize: 12, marginBottom: 6 }}>
                {n}
              </div>
            ))}

            <div style={{ fontSize: 13, opacity: 0.8, margin: '10px 0 6px' }}>
              Ảnh gửi kèm ({data.refImages.length}) — đúng thứ tự AI nhận:
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              {data.refImages.length === 0 && (
                <span style={{ opacity: 0.6, fontSize: 12 }}>Không có ảnh nào được gửi ở bước này.</span>
              )}
              {data.refImages.map((img, i) => (
                <div key={img.rel} style={{ width: 96, textAlign: 'center' }}>
                  <img
                    src={imageR2Urls?.[img.rel] ?? `/api/livestream/${jobId}/media/${img.rel}`}
                    alt={img.label}
                    style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>
                    {i + 1}. {img.label}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>
              Prompt gửi AI ({data.prompt.length.toLocaleString('vi-VN')} ký tự):
            </div>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                lineHeight: 1.5,
                background: 'var(--bg)',
                padding: 10,
                borderRadius: 8,
                maxHeight: '48vh',
                overflowY: 'auto',
              }}
            >
              {data.prompt}
            </pre>
            <button
              className="btn"
              style={{ marginTop: 8 }}
              onClick={() => navigator.clipboard?.writeText(data.prompt)}
            >
              📋 Copy prompt
            </button>
          </>
        )}
      </div>
    </div>
  );
}
