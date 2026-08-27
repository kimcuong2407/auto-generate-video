'use client';

import { useState } from 'react';
import type { LivestreamJob } from '@/lib/livestream/types';
import { BACKGROUND_SYSTEM_PROMPT } from '@/lib/livestream/promptDefaults';
import { IMAGE_MODEL_OPTIONS } from '@/lib/imageModels';
import { PromptPreviewModal } from './PromptPreviewModal';

/**
 * Khu cấu hình BỘ ẢNH CHUNG cả job (đặt cạnh panel System prompt đầu trang): ảnh sản phẩm (kho +
 * chọn ref chính, bắt buộc để gen video), ảnh mẫu/người dẫn (1 ảnh), ảnh background (kho + chọn +
 * gen bằng AI). Các ảnh này áp cho MỌI segment của MỌI sản phẩm khi sync prompt + gen video —
 * xem lib/livestream/segmentGenerate.ts. Thao tác qua các route app/api/livestream/[id]/images/*.
 */
export function JobImagePanel({
  job,
  onRefresh,
}: {
  job: LivestreamJob;
  onRefresh: () => Promise<void>;
}) {
  const jobId = job.id;
  // Ưu tiên URL R2 (bền vững qua deploy) khi hiển thị; fallback route media local cho ảnh cũ / R2 tắt.
  const imgSrc = (relPath: string) =>
    job.imageR2Urls?.[relPath] ?? `/api/livestream/${jobId}/media/${relPath}`;
  const [uploadingSpokesperson, setUploadingSpokesperson] = useState(false);
  const [uploadingModel, setUploadingModel] = useState(false);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [generatingBg, setGeneratingBg] = useState(false);
  const [bgPromptDraft, setBgPromptDraft] = useState(BACKGROUND_SYSTEM_PROMPT);
  const [selectingRef, setSelectingRef] = useState(false);
  const [savingBgModel, setSavingBgModel] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [previewingBgPrompt, setPreviewingBgPrompt] = useState(false);

  const detachedSet = new Set(job.detachedImagePaths ?? []);

  /**
   * Bật/tắt "tách ảnh khỏi gen video": ảnh bị tách vẫn cho AI vision đọc để mô tả vào prompt,
   * nhưng không gửi làm reference image cho Veo — xem app/api/livestream/[id]/images/detach.
   */
  async function handleToggleDetach(relPath: string) {
    setDetaching(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}/images/detach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Đổi trạng thái ảnh thất bại');
      await onRefresh();
    } finally {
      setDetaching(false);
    }
  }

  /** Nút toggle nhỏ nằm góc dưới-phải mỗi ảnh — dùng chung cho cả 3 loại ảnh. */
  function DetachButton({ relPath }: { relPath: string }) {
    const detached = detachedSet.has(relPath);
    return (
      <button
        type="button"
        onClick={() => handleToggleDetach(relPath)}
        disabled={detaching}
        title={
          detached
            ? 'Đang TÁCH khỏi gen video (chỉ dùng để mô tả vào prompt) — bấm để gửi lại cho Veo'
            : 'Đang gửi cho Veo làm ảnh tham chiếu — bấm để tách khỏi gen video'
        }
        style={{
          position: 'absolute',
          bottom: -6,
          right: -6,
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: 'none',
          background: detached ? 'var(--surface2)' : 'var(--accent-glow)',
          color: detached ? 'var(--text-muted)' : '#fff',
          cursor: 'pointer',
          fontSize: 10,
          lineHeight: '20px',
          padding: 0,
          opacity: detaching ? 0.6 : 1,
        }}
      >
        {detached ? '🚫' : '🎬'}
      </button>
    );
  }

  async function handleUpdateBackgroundModel(model: string) {
    setSavingBgModel(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backgroundModel: model }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Cập nhật provider thất bại');
      await onRefresh();
    } finally {
      setSavingBgModel(false);
    }
  }

  async function handleSpokespersonUpload(files: File[]) {
    if (files.length === 0) return;
    setUploadingSpokesperson(true);
    try {
      const form = new FormData();
      for (const f of files) form.append('image', f);
      const res = await fetch(`/api/livestream/${jobId}/images/spokesperson`, {
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
        `/api/livestream/${jobId}/images/spokesperson?path=${encodeURIComponent(relPath)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Xoá ảnh thất bại');
      await onRefresh();
    } finally {
      setUploadingSpokesperson(false);
    }
  }

  async function handleSelectRef(relPath: string | null, kind: 'product' | 'background') {
    setSelectingRef(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}/images/select-ref`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath, kind }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Chọn ảnh thất bại');
      await onRefresh();
    } finally {
      setSelectingRef(false);
    }
  }

  async function handleModelUpload(file: File) {
    setUploadingModel(true);
    try {
      const form = new FormData();
      form.set('image', file);
      const res = await fetch(`/api/livestream/${jobId}/images/model`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Upload ảnh mẫu thất bại');
        return;
      }
      await onRefresh();
    } finally {
      setUploadingModel(false);
    }
  }

  async function handleModelRemove() {
    setUploadingModel(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}/images/model`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Xoá ảnh mẫu thất bại');
      await onRefresh();
    } finally {
      setUploadingModel(false);
    }
  }

  async function handleGenerateBackground() {
    setGeneratingBg(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}/images/background/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: bgPromptDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Gen ảnh background thất bại');
        return;
      }
      await onRefresh();
    } finally {
      setGeneratingBg(false);
    }
  }

  async function handleBackgroundUpload(files: File[]) {
    if (files.length === 0) return;
    setUploadingBackground(true);
    try {
      const form = new FormData();
      for (const f of files) form.append('image', f);
      const res = await fetch(`/api/livestream/${jobId}/images/background`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Upload ảnh background thất bại');
        return;
      }
      if (data.warnings?.length) alert(data.warnings.join('\n'));
      await onRefresh();
    } finally {
      setUploadingBackground(false);
    }
  }

  async function handleBackgroundRemove(relPath: string) {
    setUploadingBackground(true);
    try {
      const res = await fetch(
        `/api/livestream/${jobId}/images/background?path=${encodeURIComponent(relPath)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Xoá ảnh thất bại');
      await onRefresh();
    } finally {
      setUploadingBackground(false);
    }
  }

  // Bắt chọn tay: có ảnh trong kho nhưng chưa chọn ref nào → cảnh báo (chặn gen ở cấp job).
  const needsRefSelection =
    job.spokespersonImagePaths.length > 0 && job.selectedRefImagePaths.length === 0;

  return (
    <div className="card">
      <div className="card-header">🖼️ <span>Ảnh dùng chung cả job (áp cho mọi đoạn)</span></div>

      <div className="banner banner-info">
        Bộ ảnh này áp cho <strong>mọi đoạn của mọi sản phẩm</strong> khi gen video: ảnh sản phẩm
        (1 hoặc nhiều, bắt buộc) + 1 ảnh mẫu/người dẫn + 1 ảnh background (tuỳ chọn). Giúp video ghép lại
        nhất quán như 1 buổi live liên tục.
        <br />
        Nút <strong>🎬</strong> góc dưới mỗi ảnh: bấm để <strong>tách ảnh khỏi bước gen video</strong>{' '}
        (chuyển thành <strong>🚫</strong>). Ảnh đã tách vẫn được AI đọc để mô tả vào prompt, nhưng
        không gửi cho Veo làm ảnh tham chiếu — dùng khi ảnh đó ép sai khung hình, hoặc để nhường
        suất cho ảnh khác (Veo chỉ nhận tối đa 3 ảnh).
      </div>

      <div className="field-group">
        <label>Ảnh sản phẩm — bấm chọn (nhiều) ảnh làm tham chiếu (bắt buộc ít nhất 1 để gen video)</label>
        {needsRefSelection && (
          <div style={{ fontSize: 12, color: 'var(--danger, #e5484d)', marginBottom: 6 }}>
            ⚠️ Hãy chọn ít nhất 1 ảnh sản phẩm làm tham chiếu thì mới gen được.
          </div>
        )}
        {job.spokespersonImagePaths.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            {job.spokespersonImagePaths.map((relPath) => {
              const selected = job.selectedRefImagePaths.includes(relPath);
              return (
                <div key={relPath} style={{ position: 'relative', width: 64, height: 64 }}>
                  <img
                    src={imgSrc(relPath)}
                    alt="Ảnh sản phẩm"
                    onClick={() => !selectingRef && handleSelectRef(relPath, 'product')}
                    title={selected ? 'Đang là tham chiếu — bấm để bỏ chọn' : 'Bấm để thêm làm tham chiếu'}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: selected ? '2px solid var(--accent-glow)' : '1px solid var(--border)',
                      cursor: 'pointer',
                      opacity: selectingRef ? 0.6 : 1,
                    }}
                  />
                  {selected && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -4,
                        left: -4,
                        background: 'var(--accent-glow)',
                        color: '#fff',
                        borderRadius: '50%',
                        width: 18,
                        height: 18,
                        fontSize: 11,
                        lineHeight: '18px',
                        textAlign: 'center',
                      }}
                    >
                      ✓
                    </span>
                  )}
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
                  <DetachButton relPath={relPath} />
                </div>
              );
            })}
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
        <label>Ảnh mẫu/người dẫn (tuỳ chọn) — 1 ảnh áp cho mọi đoạn</label>
        {job.selectedModelImagePath ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ position: 'relative', width: 64, height: 64 }}>
              <img
                src={imgSrc(job.selectedModelImagePath)}
                alt="Ảnh mẫu"
                style={{
                  width: 64,
                  height: 64,
                  objectFit: 'cover',
                  borderRadius: 8,
                  border: '2px solid var(--accent-glow)',
                }}
              />
              <button
                type="button"
                onClick={handleModelRemove}
                disabled={uploadingModel}
                title="Xoá ảnh mẫu"
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
              <DetachButton relPath={job.selectedModelImagePath} />
            </div>
            {detachedSet.has(job.selectedModelImagePath) ? (
              // Cảnh báo nổi bật: ảnh mẫu bị tách gần như luôn là nhầm lẫn. Bible vẫn đọc được ảnh
              // này nên sân khấu tả ĐÚNG người, nhưng Veo KHÔNG nhận ảnh khuôn mặt → nó tự vẽ người
              // khác, và không có dấu hiệu nào trên UI cho biết. Đúng ca job production 825314.
              <span style={{ fontSize: 12, color: 'var(--danger, #e5484d)', fontWeight: 600 }}>
                ⚠️ Ảnh mẫu đang bị TÁCH khỏi gen video — Veo sẽ KHÔNG nhận được ảnh khuôn mặt và tự
                vẽ người khác. Bấm nút 🚫 ở góc ảnh để gửi lại cho Veo.
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Ảnh mẫu này sẽ đi kèm mọi đoạn khi gen video.
              </span>
            )}
          </div>
        ) : (
          <input
            type="file"
            accept="image/*"
            disabled={uploadingModel}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleModelUpload(file);
              e.target.value = '';
            }}
            style={{ fontSize: 12 }}
          />
        )}
        {uploadingModel && <span style={{ fontSize: 12 }}>⏳ Đang xử lý...</span>}
      </div>

      <div className="field-group">
        <label>Ảnh background (tuỳ chọn) — bấm chọn 1 ảnh làm bối cảnh khi gen video</label>
        {job.backgroundImagePaths.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            {job.backgroundImagePaths.map((relPath) => {
              const selected = job.selectedBackgroundImagePath === relPath;
              return (
                <div key={relPath} style={{ position: 'relative', width: 64, height: 64 }}>
                  <img
                    src={imgSrc(relPath)}
                    alt="Ảnh background"
                    onClick={() => !selectingRef && handleSelectRef(selected ? null : relPath, 'background')}
                    title={selected ? 'Đang chọn — bấm để bỏ chọn' : 'Bấm để chọn làm background'}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 8,
                      border: selected ? '2px solid var(--accent-glow)' : '1px solid var(--border)',
                      cursor: 'pointer',
                      opacity: selectingRef ? 0.6 : 1,
                    }}
                  />
                  {selected && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -4,
                        left: -4,
                        background: 'var(--accent-glow)',
                        color: '#fff',
                        borderRadius: '50%',
                        width: 18,
                        height: 18,
                        fontSize: 11,
                        lineHeight: '18px',
                        textAlign: 'center',
                      }}
                    >
                      ✓
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleBackgroundRemove(relPath)}
                    disabled={uploadingBackground}
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
                  <DetachButton relPath={relPath} />
                </div>
              );
            })}
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={uploadingBackground}
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            if (files.length) handleBackgroundUpload(files);
            e.target.value = '';
          }}
          style={{ fontSize: 12 }}
        />
        {uploadingBackground && <span style={{ fontSize: 12 }}>⏳ Đang xử lý...</span>}

        <div style={{ marginTop: 10 }} className="field-group">
          <label>Provider gen ảnh background</label>
          <select
            value={job.backgroundModel}
            disabled={savingBgModel}
            onChange={(e) => handleUpdateBackgroundModel(e.target.value)}
          >
            {IMAGE_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            className="btn"
            onClick={handleGenerateBackground}
            disabled={generatingBg || job.selectedRefImagePaths.length === 0}
            title={
              job.selectedRefImagePaths.length === 0
                ? 'Hãy chọn ít nhất 1 ảnh sản phẩm làm tham chiếu trước khi gen background'
                : 'Tạo 1 khung hình có mẫu đang dùng sản phẩm, thêm vào kho background'
            }
          >
            {generatingBg ? '⏳ Đang gen background...' : '🎨 Gen background bằng AI'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ marginLeft: 8 }}
            onClick={() => setPreviewingBgPrompt(true)}
            title="Xem prompt đầy đủ + ảnh ref server sẽ gửi cho AI (không tốn lượt gen)"
          >
            👁 Xem prompt + ảnh ref
          </button>
          {job.selectedRefImagePaths.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
              Cần chọn ít nhất 1 ảnh sản phẩm làm tham chiếu trước.
            </span>
          )}
        </div>

        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
            ⚙️ Prompt gen background (có thể chỉnh)
          </summary>
          <textarea
            rows={8}
            value={bgPromptDraft}
            onChange={(e) => setBgPromptDraft(e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5, marginTop: 6 }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Mô tả sản phẩm (sản phẩm đầu tiên), sân khấu đã chốt và chú giải ảnh ref sẽ được ghép tự
            động vào prompt khi gen — bấm &quot;Xem prompt + ảnh ref&quot; để thấy chuỗi cuối cùng.
          </div>
        </details>
      </div>

      {previewingBgPrompt && (
        <PromptPreviewModal
          jobId={jobId}
          step="background"
          promptOverride={bgPromptDraft}
          imageR2Urls={job.imageR2Urls ?? undefined}
          onClose={() => setPreviewingBgPrompt(false)}
        />
      )}
    </div>
  );
}
