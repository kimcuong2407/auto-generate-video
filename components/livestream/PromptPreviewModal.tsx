'use client';

import { useEffect, useState } from 'react';
import { PromptParamsHint } from './PromptParamsHint';

interface PreviewData {
  prompt: string;
  refImages: { rel: string; label: string }[];
  notes: string[];
  /** Xem PreviewPromptResult ở route preview-prompt. */
  editable?: {
    step: 'script' | 'video';
    systemPrompt?: string;
    isCustomPrompt?: boolean;
    chosenRefPaths: string[];
    candidates: { rel: string; role: string }[];
  };
}

const STEP_TITLE: Record<string, string> = {
  background: 'Bước: Gen ảnh background',
  script: 'Bước: Sinh kịch bản',
  segment: 'Bước: Gen video cho đoạn',
};

/**
 * Modal xem trước prompt + ảnh ref của MỘT bước gen, và (tuỳ chọn) xác nhận chạy luôn bước đó.
 *
 * Vì sao cần: prompt thật được ghép SERVER-SIDE từ nhiều mảnh, UI chỉ cho sửa 1 mảnh. Modal này
 * gọi GET /api/livestream/[id]/preview-prompt để lấy đúng chuỗi server sẽ gửi — không tự ghép lại
 * ở client, nếu không 2 bên sẽ trôi lệch nhau như bug "prompt hiện khác prompt gửi đi" trước đây.
 *
 * Route preview KHÔNG gọi AI nên mở bao nhiêu lần cũng miễn phí; mảnh nào chưa có sẽ nằm ở `notes`.
 *
 * Truyền `onConfirm` để biến modal thành CỔNG XÁC NHẬN: mọi nút gen đi qua đây, Mr.D nhìn đủ
 * prompt + ảnh rồi mới bấm chạy. Không truyền thì modal chỉ để xem.
 */
export function PromptPreviewModal({
  jobId,
  step,
  productId,
  segmentId,
  promptOverride,
  imageR2Urls,
  confirmLabel,
  onConfirm,
  onSaved,
  onClose,
}: {
  jobId: string;
  step: 'background' | 'script' | 'segment';
  productId?: string;
  /** Bắt buộc khi step='segment' — đoạn cần preview. */
  segmentId?: string;
  /** Bản nháp prompt đang sửa trên UI (chỉ bước background) — để preview khớp thứ sắp gửi. */
  promptOverride?: string;
  /** job.imageR2Urls — ưu tiên URL R2 khi hiện thumbnail, file local có thể đã mất sau deploy. */
  imageR2Urls?: Record<string, string | null>;
  /** Nhãn nút chạy thật, VD "▶ Gen đoạn này". Bỏ qua nếu modal chỉ để xem. */
  confirmLabel?: string;
  /** Chạy bước thật. Modal tự đóng sau khi chạy xong. */
  onConfirm?: () => void | Promise<void>;
  /** Gọi sau khi sửa prompt/ảnh trong modal — để trang cha refresh job đang hiển thị. */
  onSaved?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Tăng để nạp lại preview sau khi lưu prompt/ảnh — prompt cuối được ghép SERVER-SIDE nên phải
  // hỏi lại server mới thấy đúng thứ sắp gửi, không tự vá chuỗi ở client.
  const [reloadKey, setReloadKey] = useState(0);
  const [promptDraft, setPromptDraft] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const qs = new URLSearchParams({ step });
    if (productId) qs.set('productId', productId);
    if (segmentId) qs.set('segmentId', segmentId);
    if (promptOverride?.trim()) qs.set('prompt', promptOverride);
    fetch(`/api/livestream/${jobId}/preview-prompt?${qs}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json);
      })
      .catch((err: Error) => setError(err.message));
  }, [jobId, step, productId, segmentId, promptOverride, reloadKey]);

  /** Lưu 1 thay đổi (prompt hoặc danh sách ảnh) rồi nạp lại preview để thấy prompt thật đã đổi. */
  async function saveEdit(url: string, body: object) {
    setSavingEdit(true);
    try {
      const res = await fetch(url, {
        method: url.endsWith('/prompt') ? 'PATCH' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || 'Lưu thất bại');
        return;
      }
      await onSaved?.();
      setPromptDraft(null);
      setReloadKey((k) => k + 1);
    } finally {
      setSavingEdit(false);
    }
  }

  function toggleRef(rel: string) {
    const cur = data?.editable?.chosenRefPaths ?? [];
    const next = cur.includes(rel) ? cur.filter((r) => r !== rel) : [...cur, rel];
    saveEdit(`/api/livestream/${jobId}/images/script-refs`, {
      paths: next,
      step: data?.editable?.step ?? 'script',
    });
  }

  async function handleConfirm() {
    if (!onConfirm) return;
    setConfirming(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setConfirming(false);
    }
  }

  // Cảnh báo chặn: note bắt đầu bằng ❌ nghĩa là bấm gen chắc chắn hỏng (VD chưa có veoPrompt).
  const blocking = data?.notes.some((n) => n.startsWith('❌')) ?? false;

  return (
    <div className="media-modal-overlay" onClick={onClose}>
      <div
        className="media-modal-content"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 20,
          width: 720,
          maxWidth: '92vw',
          textAlign: 'left',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="media-modal-close" onClick={onClose} title="Đóng">
          ✕
        </button>
        <h4 style={{ marginTop: 0 }}>
          👁 {STEP_TITLE[step] ?? step} — kiểm tra trước khi chạy
        </h4>

        {error && <div className="banner banner-error">{error}</div>}
        {!data && !error && <div style={{ opacity: 0.7 }}>Đang tải...</div>}

        {data && (
          <>
            {data.notes.map((n) => (
              <div
                key={n}
                className={n.startsWith('❌') || n.startsWith('⚠️') ? 'banner' : 'banner banner-info'}
                style={{ fontSize: 12, marginBottom: 6 }}
              >
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
                <div key={img.rel} style={{ width: 110, textAlign: 'center' }}>
                  <img
                    src={imageR2Urls?.[img.rel] ?? `/api/livestream/${jobId}/media/${img.rel}`}
                    alt={img.label}
                    style={{
                      width: 110,
                      height: 110,
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                    }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>
                    {i + 1}. {img.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Bước gen video MỞ SẴN danh sách ảnh: Veo chỉ nhận 3 ảnh nên chọn đúng ảnh là việc
                phải làm mỗi lần gen, không phải tuỳ chọn nâng cao. Bước script thì giữ thu gọn —
                ở đó hệ thống tự chọn đã ổn, hiếm khi cần đổi. */}
            {data.editable && (
              <details open={data.editable.step === 'video'} style={{ marginBottom: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  📎 {data.editable.step === 'video' ? 'Chọn ảnh gửi cho Veo' : 'Đổi ảnh gửi cho AI'} (
                  {data.editable.chosenRefPaths.length === 0
                    ? 'đang tự động'
                    : `${data.editable.chosenRefPaths.length} ảnh đã tick`})
                </summary>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 8px' }}>
                  {data.editable.step === 'video' ? (
                    <>
                      Tick theo ĐÚNG thứ tự ưu tiên — Veo chỉ nhận 3 ảnh đầu, ảnh tick sau sẽ bị bỏ.
                      Bỏ tick hết = quay về thứ tự tự động (ảnh mẫu → ảnh nền → ảnh sản phẩm).
                    </>
                  ) : (
                    <>
                      Tick để tự quyết ảnh nào tới AI (đọc ngoại hình sản phẩm + chốt sân khấu). Bỏ
                      tick hết = quay về chế độ tự chọn. Đổi ảnh sẽ khiến sân khấu được chốt lại.
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {data.editable.candidates.map(({ rel, role }) => {
                    const picked = data.editable!.chosenRefPaths.includes(rel);
                    const order = data.editable!.chosenRefPaths.indexOf(rel) + 1;
                    return (
                      <div key={rel} style={{ position: 'relative', width: 76 }}>
                        <img
                          src={imageR2Urls?.[rel] ?? `/api/livestream/${jobId}/media/${rel}`}
                          alt={role}
                          onClick={() => !savingEdit && toggleRef(rel)}
                          title={picked ? `Đang gửi (thứ ${order}) — bấm để bỏ` : `Bấm để gửi (${role})`}
                          style={{
                            width: 76,
                            height: 76,
                            objectFit: 'cover',
                            borderRadius: 6,
                            cursor: savingEdit ? 'wait' : 'pointer',
                            outline: picked ? '2px solid var(--accent-glow)' : '1px solid var(--border)',
                            opacity: picked ? 1 : 0.5,
                          }}
                        />
                        {picked && (
                          <span
                            style={{
                              position: 'absolute',
                              top: -5,
                              left: -5,
                              minWidth: 16,
                              height: 16,
                              borderRadius: '50%',
                              background: 'var(--accent-glow)',
                              color: '#fff',
                              fontSize: 10,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {order}
                          </span>
                        )}
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center' }}>
                          {role}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {data.editable?.systemPrompt !== undefined && (
              <details style={{ marginBottom: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  ✏️ Sửa system prompt sinh kịch bản{' '}
                  <span className={`badge ${data.editable.isCustomPrompt ? 'badge-running' : 'badge-pending'}`}>
                    {data.editable.isCustomPrompt ? 'Đã tuỳ chỉnh' : 'Mặc định'}
                  </span>
                </summary>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0' }}>
                  Lưu áp cho MỌI lần sinh script sau của job này (giống panel ⚙️ đầu trang).
                </div>
                <PromptParamsHint />
                <textarea
                  rows={12}
                  value={promptDraft ?? data.editable.systemPrompt}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    className="btn"
                    disabled={savingEdit || promptDraft === null}
                    onClick={() =>
                      saveEdit(`/api/livestream/${jobId}/prompt`, { scriptSystemPrompt: promptDraft })
                    }
                  >
                    {savingEdit ? 'Đang lưu...' : '💾 Lưu prompt'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={savingEdit || !data.editable.isCustomPrompt}
                    onClick={() => saveEdit(`/api/livestream/${jobId}/prompt`, { scriptSystemPrompt: null })}
                  >
                    ↺ Khôi phục mặc định
                  </button>
                </div>
              </details>
            )}

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
                maxHeight: '40vh',
                overflowY: 'auto',
              }}
            >
              {data.prompt}
            </pre>

            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              {onConfirm && (
                <button
                  className="btn btn-primary"
                  onClick={handleConfirm}
                  disabled={confirming || blocking || savingEdit}
                  title={blocking ? 'Còn lỗi chặn ở trên — sửa xong mới chạy được' : undefined}
                >
                  {confirming ? 'Đang chạy...' : (confirmLabel ?? '▶ Chạy bước này')}
                </button>
              )}
              <button className="btn btn-ghost" onClick={onClose}>
                Huỷ
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => navigator.clipboard?.writeText(data.prompt)}
              >
                📋 Copy prompt
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
