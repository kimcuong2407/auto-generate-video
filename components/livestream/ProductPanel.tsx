'use client';

import { useState } from 'react';
import type { LivestreamJob, LivestreamProduct, LivestreamSegment } from '@/lib/livestream/types';
import { PromptPreviewModal } from './PromptPreviewModal';

function segmentStatusClass(status: LivestreamSegment['status']): string {
  if (status === 'done') return 'status-ready';
  if (status === 'generating') return 'status-gen';
  if (status === 'failed') return 'status-failed';
  return 'status-queued';
}

export function ProductPanel({
  jobId,
  job,
  product,
  onRefresh,
  onGenerateScript,
  scriptBusy,
}: {
  jobId: string;
  job: LivestreamJob;
  product: LivestreamProduct;
  onRefresh: () => Promise<void>;
  onGenerateScript: (productId: string) => void;
  scriptBusy: boolean;
}) {
  const [busySegmentId, setBusySegmentId] = useState<string | null>(null);
  const [manualDescription, setManualDescription] = useState(product.description);
  const [savingManual, setSavingManual] = useState(false);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  // Đoạn đang mở modal preview + hành động sẽ chạy khi bấm xác nhận (null = chỉ xem).
  // MỌI nút gen video đi qua đây: Mr.D nhìn đủ prompt + ảnh thật rồi mới tốn lượt Veo.
  const [preview, setPreview] = useState<{
    segmentId: string;
    action: 'generate' | 'retry' | null;
    label: string;
  } | null>(null);
  // Xem trước prompt sinh script của SẢN PHẨM này trước khi bấm sinh.
  const [previewScript, setPreviewScript] = useState(false);

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
   * Mở preview sinh script: lưu mô tả đang gõ lên server TRƯỚC rồi mới mở modal — route preview
   * đọc product.description từ job.json, không lưu thì Mr.D xem prompt của bản mô tả CŨ rồi bấm
   * chạy trên bản mới, đúng kiểu sai lệch mà cả màn hình preview này sinh ra để chặn.
   */
  async function handleOpenScriptPreview() {
    const saved = await saveManualDescription(true);
    if (!saved) return;
    setPreviewScript(true);
  }

  async function callSegmentAction(segmentId: string, action: 'generate' | 'retry' | 'stop' | 'sync') {
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
          onClick={handleOpenScriptPreview}
          disabled={scriptBusy || hasGenerating || savingManual || !manualDescription.trim()}
          title="Lưu mô tả đang nhập rồi MỞ BẢN XEM TRƯỚC prompt + ảnh — xác nhận trong đó mới thật sự sinh."
        >
          {scriptBusy
            ? 'Đang sinh script...'
            : savingManual
              ? 'Đang lưu mô tả...'
              : product.segments.length > 0
                ? '👁 Xem trước → sinh lại script'
                : '👁 Xem trước → sinh script'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
          Bấm sẽ mở bản xem trước prompt + ảnh; xác nhận trong đó mới tốn lượt AI. Muốn đổi giọng/phong cách? Chỉnh system prompt ở phần ⚙️ đầu trang.
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
                <button
                  className="retry-btn"
                  onClick={() => setPreview({ segmentId: segment.id, action: null, label: '' })}
                  title="Xem ảnh tham chiếu + prompt sẽ gửi lên Veo (không gen)"
                >
                  👁 Xem prompt
                </button>
                {segment.status === 'idle' && (
                  <button
                    className="retry-btn"
                    onClick={() =>
                      setPreview({ segmentId: segment.id, action: 'generate', label: '▶ Gen đoạn này' })
                    }
                    disabled={busySegmentId === segment.id}
                    title="Mở bản xem trước prompt + ảnh; xác nhận trong đó mới tốn lượt Veo"
                  >
                    👁 Xem trước → Gen
                  </button>
                )}
                {segment.status === 'failed' && (
                  <>
                    <button
                      className="retry-btn"
                      onClick={() =>
                        setPreview({ segmentId: segment.id, action: 'retry', label: '↺ Gen lại đoạn này' })
                      }
                      disabled={busySegmentId === segment.id}
                      title="Mở bản xem trước prompt + ảnh; xác nhận trong đó mới tốn lượt Veo"
                    >
                      👁 Xem trước → Retry
                    </button>
                    {segment.jobId && (
                      <button
                        className="retry-btn"
                        onClick={() => callSegmentAction(segment.id, 'sync')}
                        disabled={busySegmentId === segment.id}
                        title="Kiểm tra lại job trên Google Flow — hữu ích nếu đoạn này từng bị Dừng nhưng Flow vẫn chạy ngầm và có thể đã ra video"
                      >
                        🔄 Đồng bộ lại
                      </button>
                    )}
                  </>
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
                      onClick={() =>
                        setPreview({
                          segmentId: segment.id,
                          action: 'retry',
                          label: '🔄 Gen lại (ghi đè video hiện tại)',
                        })
                      }
                      disabled={busySegmentId === segment.id}
                      title="Mở bản xem trước prompt + ảnh; xác nhận thì gen lại và ghi đè video hiện tại"
                    >
                      👁 Xem trước → Gen lại
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
      {/* Modal preview dùng chung route /preview-prompt — KHÔNG tự ghép danh sách ảnh ở client
          (modal cũ làm vậy nên dễ trôi lệch với server). `action` khác null thì modal có luôn nút
          chạy thật, nên không còn đường nào gen video mà chưa nhìn prompt + ảnh. */}
      {preview && (
        <PromptPreviewModal
          jobId={jobId}
          step="segment"
          productId={product.id}
          segmentId={preview.segmentId}
          imageR2Urls={job.imageR2Urls ?? undefined}
          confirmLabel={preview.action ? preview.label : undefined}
          onConfirm={
            preview.action
              ? () => callSegmentAction(preview.segmentId, preview.action!)
              : undefined
          }
          onClose={() => setPreview(null)}
        />
      )}

      {previewScript && (
        <PromptPreviewModal
          jobId={jobId}
          step="script"
          productId={product.id}
          imageR2Urls={job.imageR2Urls ?? undefined}
          confirmLabel={product.segments.length > 0 ? '🔄 Sinh lại script' : '✍️ Sinh script'}
          onConfirm={() => onGenerateScript(product.id)}
          onSaved={onRefresh}
          onClose={() => setPreviewScript(false)}
        />
      )}
    </div>
  );
}
