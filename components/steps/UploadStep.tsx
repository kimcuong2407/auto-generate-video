'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import defaultTemplate from '@/public/default-template.json';
import type { Project } from '@/lib/types';

/** Tạo & tự thu hồi object URL cho danh sách File — dùng để preview ảnh mới chọn trước khi upload. */
function useObjectUrls(files: File[]): string[] {
  // useMemo tính URL đồng bộ trong render, tránh 1 nhịp render trung gian nơi
  // `files` đã đổi nhưng URL cũ (qua state async) vẫn còn — dễ gây lệch dữ liệu ở nơi dùng.
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [urls]);
  return urls;
}

/** Tạo & tự thu hồi object URL cho 1 File — dùng để preview background/ảnh người mẫu mới chọn. */
function useObjectUrl(file: File | null): string | null {
  // useMemo (thay vì set qua useEffect) để URL luôn khớp `file` của cùng lần render —
  // tránh crash khi UI đọc `file!.name` ngay lúc file đã bị xoá nhưng URL cũ chưa kịp reset.
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

function productToFormState(product?: Project['product']) {
  return {
    name: product?.name || '',
    tagline: product?.tagline || '',
    category: product?.category || '',
    material: product?.material || '',
    colors: product?.colors?.join(', ') || '',
    keyFeatures: product?.keyFeatures?.join('\n') || '',
    visualDescription: product?.visualDescription || '',
  };
}

export function UploadStep({
  project,
  onSaved,
}: {
  project?: Project;
  onSaved?: () => Promise<void>;
}) {
  const router = useRouter();
  const isEdit = !!project;

  const [name, setName] = useState(project?.name || '');
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>(project?.aspectRatio || '9:16');
  const [images, setImages] = useState<File[]>([]);
  const [background, setBackground] = useState<File | null>(null);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [spokespersonImage, setSpokespersonImage] = useState<File | null>(null);
  const [removeSpokespersonImage, setRemoveSpokespersonImage] = useState(false);
  const [templateText, setTemplateText] = useState(
    project ? JSON.stringify(project.template, null, 2) : JSON.stringify(defaultTemplate, null, 2)
  );
  const [product, setProduct] = useState(productToFormState(project?.product));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemoved, setConfirmRemoved] = useState<string[] | null>(null);
  const [analyzingImages, setAnalyzingImages] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);

  const imagePreviewUrls = useObjectUrls(images);
  const backgroundPreviewUrl = useObjectUrl(background);
  const spokespersonPreviewUrl = useObjectUrl(spokespersonImage);

  function buildFormData(): FormData {
    const form = new FormData();
    if (name.trim()) form.set('name', name.trim());
    form.set('aspectRatio', aspectRatio);
    form.set('template', templateText);
    form.set(
      'product',
      JSON.stringify({
        name: product.name,
        tagline: product.tagline,
        category: product.category,
        material: product.material,
        colors: product.colors.split(',').map((s) => s.trim()).filter(Boolean),
        keyFeatures: product.keyFeatures.split('\n').map((s) => s.trim()).filter(Boolean),
        visualDescription: product.visualDescription,
      })
    );
    for (const img of images) form.append('images', img);
    if (background) form.set('background', background);
    if (spokespersonImage) form.set('spokespersonImage', spokespersonImage);
    if (isEdit) {
      if (removeBackground) form.set('removeBackground', 'true');
      if (removeSpokespersonImage) form.set('removeSpokespersonImage', 'true');
    }
    return form;
  }

  async function handleCreate() {
    setError(null);
    if (!name.trim()) {
      setError('Cần nhập tên project');
      return;
    }
    if (images.length === 0) {
      setError('Cần ít nhất 1 ảnh sản phẩm');
      return;
    }
    try {
      JSON.parse(templateText);
    } catch {
      setError('Template JSON không hợp lệ');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/projects', { method: 'POST', body: buildFormData() });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Tạo project thất bại');
        return;
      }
      router.push(`/projects/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(force = false) {
    setError(null);
    try {
      JSON.parse(templateText);
    } catch {
      setError('Template JSON không hợp lệ');
      return;
    }

    setSubmitting(true);
    try {
      const form = buildFormData();
      if (force) form.set('force', 'true');
      const res = await fetch(`/api/projects/${project!.id}`, { method: 'PATCH', body: form });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'scenes_removed_with_data') {
          setConfirmRemoved(data.scenes);
          return;
        }
        setError(data.error || 'Lưu thất bại');
        return;
      }
      setConfirmRemoved(null);
      setImages([]);
      setBackground(null);
      setRemoveBackground(false);
      setSpokespersonImage(null);
      setRemoveSpokespersonImage(false);
      await onSaved?.();
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Gọi AI vision đọc ảnh sản phẩm của project → điền product.visualDescription (mô tả
   * màu/chất liệu/hình dạng thật). Chỉ chạy được khi project ĐÃ tồn tại (cần projectId để
   * server resolve ảnh trong inputs/). Kết quả được đổ vào textarea để người dùng xem/sửa;
   * cần bấm Lưu để persist qua PATCH.
   */
  async function handleAnalyzeImages() {
    if (!project) return;
    setVisionError(null);
    setAnalyzingImages(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/product-vision`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setVisionError(data.error || 'Phân tích ảnh thất bại');
        return;
      }
      setProduct((prev) => ({ ...prev, visualDescription: data.visualDescription || '' }));
    } catch (err) {
      setVisionError((err as Error).message);
    } finally {
      setAnalyzingImages(false);
    }
  }

  function handleSubmit() {
    if (isEdit) {
      handleSaveEdit(false);
    } else {
      handleCreate();
    }
  }

  const existingProductImages = !isEdit || images.length > 0 ? [] : project!.inputs.productImages;
  const existingBackground =
    isEdit && !background && !removeBackground ? project!.inputs.backgroundPath : null;
  const existingSpokesperson =
    isEdit && !spokespersonImage && !removeSpokespersonImage ? project!.inputs.spokespersonImagePath : null;

  return (
    <div className="card">
      <div className="card-header">
        📤 <span>Bước 1 — Upload ảnh sản phẩm + Template + Background</span>
        <span className={`badge ${isEdit ? 'badge-done' : 'badge-pending'}`}>{isEdit ? 'Done' : 'Chưa xong'}</span>
      </div>

      <div className="step-actions">
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting
            ? isEdit
              ? 'Đang lưu...'
              : 'Đang tạo...'
            : isEdit
              ? '💾 Lưu thay đổi'
              : '→ Tạo project & Tiếp: Duyệt kịch bản'}
        </button>
      </div>

      {isEdit && (
        <div className="banner banner-info">
          Đang chỉnh sửa project đã tạo. Nếu sửa template làm mất cảnh đã có video/prompt, hệ thống sẽ hỏi xác nhận
          trước khi lưu — nội dung cảnh có id trùng với template cũ sẽ được giữ nguyên.
        </div>
      )}

      <div className="field-group">
        <label>Tên project</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Handobox Review" />
      </div>

      <div className="field-group">
        <label>Tỷ lệ khung hình video</label>
        <div className="toggle-group">
          <button
            className={`toggle-btn ${aspectRatio === '9:16' ? 'active' : ''}`}
            onClick={() => setAspectRatio('9:16')}
          >
            9:16 (dọc)
          </button>
          <button
            className={`toggle-btn ${aspectRatio === '16:9' ? 'active' : ''}`}
            onClick={() => setAspectRatio('16:9')}
          >
            16:9 (ngang)
          </button>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Áp dụng cho video gen ở Bước 4 và video ghép cuối (Bước 6) — ảnh storyboard ở Bước 3 luôn dùng khung ngang
          16:9 để vẽ đúng bố cục lưới 8 ô, không phụ thuộc lựa chọn này.
        </span>
      </div>

      <div className="upload-grid">
        <div className={`upload-zone ${images.length > 0 || existingProductImages.length > 0 ? 'filled' : ''}`}>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setImages(Array.from(e.target.files || []))}
          />
          <label>📸 Ảnh sản phẩm (chọn nhiều)</label>
          {images.length === 0 && existingProductImages.length === 0 && (
            <span className="filename">Chưa chọn ảnh nào</span>
          )}
          {images.length > 0 && <span className="filename">{images.length} ảnh mới đã chọn</span>}
          {images.length === 0 && existingProductImages.length > 0 && (
            <span className="filename">{existingProductImages.length} ảnh hiện có — chọn file để thay</span>
          )}
        </div>

        <div className="upload-zone filled">
          <label>📋 Template kịch bản (JSON)</label>
          <span className="filename">Có thể chỉnh sửa bên dưới</span>
        </div>

        <div className={`upload-zone ${background || existingBackground ? 'filled' : ''}`}>
          <input type="file" accept="image/*" onChange={(e) => setBackground(e.target.files?.[0] || null)} />
          {backgroundPreviewUrl ? (
            <>
              <img className="preview" src={backgroundPreviewUrl} alt="Background preview" />
              <span className="filename">🖼️ Chọn file để thay</span>
            </>
          ) : existingBackground && project ? (
            <>
              <img
                className="preview"
                src={project.inputs.backgroundUrl || `/api/projects/${project.id}/media/${existingBackground}`}
                alt="Background hiện có"
              />
              <span className="filename">🖼️ Chọn file để thay</span>
            </>
          ) : (
            <>
              <label>🖼️ Background (tuỳ chọn)</label>
              <span className="filename">Chưa chọn</span>
            </>
          )}
        </div>
      </div>

      {(images.length > 0 || existingProductImages.length > 0) && (
        <div className="image-preview-grid" style={{ marginTop: 10 }}>
          {images.length > 0
            ? imagePreviewUrls.map((url, i) => (
                <img key={url} className="image-preview-thumb" src={url} alt={`Ảnh sản phẩm mới ${i + 1}`} />
              ))
            : existingProductImages.map((p, i) => (
                <img
                  key={p}
                  className="image-preview-thumb"
                  src={
                    project!.inputs.productImageUrls?.[i] ||
                    `/api/projects/${project!.id}/media/${p}`
                  }
                  alt="Ảnh sản phẩm hiện có"
                />
              ))}
        </div>
      )}

      {isEdit && existingBackground && !background && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={removeBackground}
              onChange={(e) => setRemoveBackground(e.target.checked)}
            />
            Gỡ background hiện có
          </label>
        </div>
      )}

      <div className="field-group" style={{ marginTop: 16 }}>
        <label>Ảnh người mẫu / người dẫn (tuỳ chọn)</label>
        <div className={`upload-zone ${spokespersonImage || existingSpokesperson ? 'filled' : ''}`} style={{ maxWidth: 320 }}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setSpokespersonImage(e.target.files?.[0] || null)}
          />
          {spokespersonPreviewUrl ? (
            <>
              <img className="preview" src={spokespersonPreviewUrl} alt="Ảnh người mẫu preview" />
              <span className="filename">{spokespersonImage!.name}</span>
            </>
          ) : existingSpokesperson && project ? (
            <>
              <img
                className="preview"
                src={project.inputs.spokespersonImageUrl || `/api/projects/${project.id}/media/${existingSpokesperson}`}
                alt="Ảnh người mẫu hiện có"
              />
              <span className="filename">🧑 Chọn file để thay</span>
            </>
          ) : (
            <>
              <label>🧑 Ảnh người mẫu (character reference)</label>
              <span className="filename">Chưa chọn</span>
            </>
          )}
        </div>
        {isEdit && existingSpokesperson && !spokespersonImage && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={removeSpokespersonImage}
              onChange={(e) => setRemoveSpokespersonImage(e.target.checked)}
            />
            Gỡ ảnh người mẫu hiện có
          </label>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Nếu upload, cùng 1 người sẽ được dùng làm tham chiếu nhân vật xuyên suốt mọi cảnh khi gen video Veo (đòi hỏi
          tài khoản Google Flow có quyền dùng ảnh tham chiếu).
        </span>
      </div>

      <div className="field-group" style={{ marginTop: 16 }}>
        <label>Template kịch bản (JSON — chỉnh sửa nếu cần)</label>
        <textarea
          rows={10}
          value={templateText}
          onChange={(e) => setTemplateText(e.target.value)}
          style={{ fontFamily: 'monospace' }}
        />
      </div>

      <div className="field-group">
        <label>Tên sản phẩm</label>
        <input type="text" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
      </div>
      <div className="field-group">
        <label>Tagline</label>
        <input type="text" value={product.tagline} onChange={(e) => setProduct({ ...product, tagline: e.target.value })} />
      </div>
      <div className="field-group">
        <label>Danh mục</label>
        <input type="text" value={product.category} onChange={(e) => setProduct({ ...product, category: e.target.value })} />
      </div>
      <div className="field-group">
        <label>Chất liệu</label>
        <input type="text" value={product.material} onChange={(e) => setProduct({ ...product, material: e.target.value })} />
      </div>
      <div className="field-group">
        <label>Màu sắc (phân cách bằng dấu phẩy)</label>
        <input type="text" value={product.colors} onChange={(e) => setProduct({ ...product, colors: e.target.value })} />
      </div>
      <div className="field-group">
        <label>Tính năng nổi bật (mỗi dòng 1 tính năng)</label>
        <textarea rows={4} value={product.keyFeatures} onChange={(e) => setProduct({ ...product, keyFeatures: e.target.value })} />
      </div>

      <div className="field-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>Mô tả hình ảnh thật (AI đọc từ ảnh — màu/chất liệu/hình dạng)</span>
          {isEdit ? (
            <button
              type="button"
              className="btn"
              onClick={handleAnalyzeImages}
              disabled={analyzingImages || submitting}
            >
              {analyzingImages ? '⏳ Đang phân tích...' : '🔍 AI phân tích ảnh'}
            </button>
          ) : (
            <span style={{ fontSize: 12, opacity: 0.7 }}>(Lưu Bước 1 trước rồi mới phân tích được ảnh)</span>
          )}
        </label>
        <textarea
          rows={4}
          value={product.visualDescription}
          placeholder="Bấm 'AI phân tích ảnh' để tự động điền, hoặc mô tả tay màu/chất liệu/hình dạng thật của sản phẩm. Nội dung này được ưu tiên tuyệt đối khi sinh kịch bản/ảnh để tránh AI bịa sai màu."
          onChange={(e) => setProduct({ ...product, visualDescription: e.target.value })}
        />
        {visionError && <div className="banner">{visionError}</div>}
      </div>

      {error && <div className="banner">{error}</div>}

      {confirmRemoved && (
        <div className="banner">
          ⚠️ Template mới sẽ loại bỏ {confirmRemoved.length} cảnh đã có video/đang tạo:{' '}
          <strong>{confirmRemoved.join(', ')}</strong>. Nội dung các cảnh này sẽ mất (file video vẫn còn trên đĩa
          nhưng không còn liên kết trong project).
          <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
            <button className="btn btn-danger" onClick={() => handleSaveEdit(true)} disabled={submitting}>
              Vẫn tiếp tục xoá
            </button>
            <button className="btn" onClick={() => setConfirmRemoved(null)} disabled={submitting}>
              Huỷ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
