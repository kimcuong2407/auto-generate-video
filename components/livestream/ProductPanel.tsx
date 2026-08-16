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
  const [uploadingSpokesperson, setUploadingSpokesperson] = useState(false);

  async function handleSpokespersonUpload(files: File[]) {
    if (files.length === 0) return;
    setUploadingSpokesperson(true);
    try {
      const form = new FormData();
      for (const f of files) form.append('image', f);
      const res = await fetch(`/api/livestream/${jobId}/products/${product.id}/spokesperson`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Upload ảnh tham chiếu thất bại');
        return;
      }
      if (data.warnings?.length) alert(data.warnings.join('\n'));
      await onRefresh();
    } finally {
      setUploadingSpokesperson(false);
    }
  }

  async function handleSpokespersonRemove(relPath: string) {
    setUploadingSpokesperson(true);
    try {
      const res = await fetch(
        `/api/livestream/${jobId}/products/${product.id}/spokesperson?path=${encodeURIComponent(relPath)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Xoá ảnh thất bại');
      await onRefresh();
    } finally {
      setUploadingSpokesperson(false);
    }
  }

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

  async function saveManualDescription() {
    setSavingManual(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: manualDescription }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Cập nhật thất bại');
      await onRefresh();
    } finally {
      setSavingManual(false);
    }
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
          onClick={() => onGenerateScript(product.id)}
          disabled={scriptBusy || hasGenerating || !manualDescription.trim()}
          title="Sinh lời thoại + prompt video cho sản phẩm này. Chỉnh chỉ dẫn AI ở phần ⚙️ trên đầu trang."
        >
          {scriptBusy ? 'Đang sinh script...' : product.segments.length > 0 ? '🔄 Sinh lại script' : '✍️ Sinh script'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
          Muốn đổi giọng/phong cách? Chỉnh system prompt ở phần ⚙️ đầu trang.
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
        <label>Ảnh tham chiếu (tuỳ chọn) — giữ nhất quán ngoại hình/sản phẩm khi gen video (tối đa 3 ảnh đầu được dùng)</label>
        {product.spokespersonImagePaths.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            {product.spokespersonImagePaths.map((relPath) => (
              <div key={relPath} style={{ position: 'relative', width: 64, height: 64 }}>
                <img
                  src={`/api/livestream/${jobId}/media/${relPath}`}
                  alt="Ảnh tham chiếu"
                  style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                />
                <button
                  type="button"
                  onClick={() => handleSpokespersonRemove(relPath)}
                  disabled={uploadingSpokesperson}
                  title="Xoá ảnh này"
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'var(--surface2)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: '20px',
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={uploadingSpokesperson}
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            if (files.length) handleSpokespersonUpload(files);
            e.target.value = '';
          }}
          style={{ fontSize: 12 }}
        />
        {uploadingSpokesperson && <span style={{ fontSize: 12 }}>⏳ Đang xử lý...</span>}
      </div>

      <div className="field-group">
        <label>Mô tả sản phẩm (dùng làm input viết lời thoại)</label>
        <textarea
          rows={4}
          value={manualDescription}
          onChange={(e) => setManualDescription(e.target.value)}
        />
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={saveManualDescription} disabled={savingManual}>
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
