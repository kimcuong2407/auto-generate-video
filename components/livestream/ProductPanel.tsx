'use client';

import { useState } from 'react';
import type { LivestreamProduct, LivestreamSegment } from '@/lib/livestream/types';

function segmentStatusClass(status: LivestreamSegment['status']): string {
  if (status === 'done') return 'status-ready';
  if (status === 'generating') return 'status-gen';
  if (status === 'failed') return 'status-failed';
  return 'status-queued';
}

export function ProductPanel({
  jobId,
  product,
  onRefresh,
  onGenerateScript,
  scriptBusy,
}: {
  jobId: string;
  product: LivestreamProduct;
  onRefresh: () => Promise<void>;
  onGenerateScript: (productId: string) => void;
  scriptBusy: boolean;
}) {
  const [busySegmentId, setBusySegmentId] = useState<string | null>(null);
  const [manualDescription, setManualDescription] = useState(product.description);
  const [savingManual, setSavingManual] = useState(false);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  async function handleScreenshotUpload(file: File) {
    setUploadingScreenshot(true);
    try {
      const form = new FormData();
      form.set('image', file);
      const res = await fetch(`/api/livestream/${jobId}/products/${product.id}/vision`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'AI đọc ảnh thất bại');
        return;
      }
      const updated = (data.job.products as LivestreamProduct[]).find((p) => p.id === product.id);
      if (updated) setManualDescription(updated.description);
      await onRefresh();
    } finally {
      setUploadingScreenshot(false);
    }
  }

  /** Lưu mô tả hiện tại lên server. Trả về true nếu lưu thành công. */
  async function saveManualDescription(silent = false): Promise<boolean> {
    setSavingManual(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: manualDescription }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Cập nhật thất bại');
        return false;
      }
      if (!silent) await onRefresh();
      return true;
    } finally {
      setSavingManual(false);
    }
  }

  /**
   * Bấm "Sinh script": tự lưu mô tả đang gõ lên server TRƯỚC (route sinh script đọc
   * product.description từ job.json làm base), rồi mới gọi sinh. Nhờ vậy AI luôn lấy đúng
   * input Mr.D vừa nhập, không cần bấm "Lưu mô tả" riêng.
   */
  async function handleGenerateScript() {
    const saved = await saveManualDescription(true);
    if (!saved) return;
    onGenerateScript(product.id);
  }

  async function callSegmentAction(segmentId: string, action: 'generate' | 'retry' | 'stop') {
    setBusySegmentId(segmentId);
    try {
      const res = await fetch(`/api/livestream/${jobId}/segments/${segmentId}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Thao tác thất bại');
      await onRefresh();
    } finally {
      setBusySegmentId(null);
    }
  }

  async function handleDeleteVideo(segmentId: string) {
    if (!confirm('Xoá video đã gen của đoạn này?')) return;
    setBusySegmentId(segmentId);
    try {
      const res = await fetch(`/api/livestream/${jobId}/segments/${segmentId}/video`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Xoá thất bại');
      await onRefresh();
    } finally {
      setBusySegmentId(null);
    }
  }

  const hasGenerating = product.segments.some((s) => s.status === 'generating');

  return (
    <div className="card">
      <div className="card-header">
        🛍️ <span>{product.name}</span>
        <span className={`badge ${product.ingestStatus === 'ready' ? 'badge-done' : product.ingestStatus === 'needs_manual' ? 'badge-pending' : 'badge-error'}`}>
          {product.ingestStatus}
        </span>
        <span className={`badge ${product.scriptStatus === 'done' ? 'badge-done' : product.scriptStatus === 'generating' ? 'badge-running' : product.scriptStatus === 'failed' ? 'badge-error' : 'badge-pending'}`}>
          script: {product.scriptStatus}
        </span>
      </div>

      <div className="step-actions">
        <button
          className="btn btn-primary"
          onClick={handleGenerateScript}
          disabled={scriptBusy || hasGenerating || savingManual || !manualDescription.trim()}
          title="Tự lưu mô tả đang nhập rồi sinh lời thoại + prompt video cho sản phẩm này. Chỉnh chỉ dẫn AI ở phần ⚙️ trên đầu trang."
        >
          {scriptBusy
            ? 'Đang sinh script...'
            : savingManual
              ? 'Đang lưu mô tả...'
              : product.segments.length > 0
                ? '🔄 Sinh lại script'
                : '✍️ Sinh script'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
          Mô tả đang nhập được tự lưu khi bấm sinh. Muốn đổi giọng/phong cách? Chỉnh system prompt ở phần ⚙️ đầu trang.
        </span>
      </div>

      {product.sourceLink && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, wordBreak: 'break-all' }}>
          🔗 Link đã dán:{' '}
          <a href={product.sourceLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-glow)' }}>
            {product.sourceLink}
          </a>
        </div>
      )}

      {product.ingestStatus === 'needs_manual' && (
        <div className="banner banner-info">
          <div>{product.ingestError || 'Cần bổ sung mô tả sản phẩm thủ công.'}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
            <input
              type="file"
              accept="image/*"
              disabled={uploadingScreenshot}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleScreenshotUpload(file);
                e.target.value = '';
              }}
              style={{ fontSize: 12 }}
            />
            <span style={{ fontSize: 12 }}>
              {uploadingScreenshot ? '⏳ Đang đọc ảnh...' : '📷 Dán ảnh chụp màn hình sản phẩm (AI tự đọc)'}
            </span>
          </label>
        </div>
      )}

      <div className="field-group">
        <label>Mô tả sản phẩm (input base để viết lời thoại — tự lưu khi bấm &quot;Sinh script&quot;)</label>
        <textarea
          rows={4}
          value={manualDescription}
          onChange={(e) => setManualDescription(e.target.value)}
        />
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => saveManualDescription()}
          disabled={savingManual}
          title="Lưu riêng nếu muốn (không bắt buộc — bấm Sinh script cũng tự lưu)"
        >
          {savingManual ? 'Đang lưu...' : '💾 Lưu mô tả'}
        </button>
      </div>

      {product.scriptError && <div className="banner">{product.scriptError}</div>}

      {product.segments.length > 0 && (
        <div className="scene-list">
          {product.segments.map((segment) => (
            <div key={segment.id} className="scene-row">
              <span className="idx">{segment.order}</span>
              <div className="info">
                <div className="label">{segment.voiceoverVi.slice(0, 90)}{segment.voiceoverVi.length > 90 ? '…' : ''}</div>
                <div className="meta">
                  {segment.duration}s
                  {segment.error ? ` — ${segment.error}` : ''}
                </div>
                {segment.status === 'done' && (segment.videoUrl || segment.videoPath) && (
                  <video
                    controls
                    src={
                      segment.videoUrl ??
                      `/api/livestream/${jobId}/media/${segment.videoPath}`
                    }
                    style={{ maxWidth: 220, marginTop: 6, borderRadius: 8, display: 'block' }}
                  />
                )}
              </div>
              <span className={`status ${segmentStatusClass(segment.status)}`}>{segment.status}</span>
              <div className="actions">
                {segment.status === 'idle' && (
                  <button
                    className="retry-btn"
                    onClick={() => callSegmentAction(segment.id, 'generate')}
                    disabled={busySegmentId === segment.id}
                  >
                    ▶ Gen
                  </button>
                )}
                {segment.status === 'failed' && (
                  <button
                    className="retry-btn"
                    onClick={() => callSegmentAction(segment.id, 'retry')}
                    disabled={busySegmentId === segment.id}
                  >
                    ↺ Retry
                  </button>
                )}
                {segment.status === 'generating' && (
                  <button
                    className="retry-btn"
                    onClick={() => callSegmentAction(segment.id, 'stop')}
                    disabled={busySegmentId === segment.id}
                  >
                    ⏹ Dừng
                  </button>
                )}
                {segment.status === 'done' && (
                  <>
                    <button
                      className="retry-btn"
                      onClick={() => callSegmentAction(segment.id, 'retry')}
                      disabled={busySegmentId === segment.id}
                      title="Gen lại video cho đoạn này, ghi đè video hiện tại"
                    >
                      🔄 Gen lại
                    </button>
                    <button
                      className="retry-btn"
                      onClick={() => handleDeleteVideo(segment.id)}
                      disabled={busySegmentId === segment.id}
                      title="Xoá video đã gen, đưa đoạn về trạng thái chưa gen"
                    >
                      🗑 Xoá
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
