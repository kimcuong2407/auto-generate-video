'use client';

import { useState } from 'react';
import type { Project, StoryboardImage, StoryboardStatus } from '@/lib/types';
import { MediaModal } from '@/components/MediaModal';

function statusClass(s: StoryboardStatus): string {
  return (
    { idle: 'status-queued', generating: 'status-gen', done: 'status-ready', failed: 'status-failed' }[s] ||
    'status-queued'
  );
}

function statusText(s: StoryboardStatus): string {
  return { idle: 'Sẵn sàng', generating: '⏳ Đang gen...', done: '✅ Xong', failed: '❌ Lỗi' }[s] || 'Sẵn sàng';
}

function ImageThumb({
  src,
  alt,
  onClick,
}: {
  src: string | null;
  alt: string;
  onClick?: () => void;
}) {
  return src ? (
    <img
      src={src}
      alt={alt}
      onClick={onClick}
      style={{
        width: 140,
        height: 140,
        objectFit: 'cover',
        borderRadius: 8,
        border: '1px solid var(--border)',
        cursor: onClick ? 'zoom-in' : undefined,
      }}
    />
  ) : (
    <div
      style={{
        width: 140,
        height: 140,
        borderRadius: 8,
        border: '1px dashed var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        color: 'var(--text-muted)',
        textAlign: 'center',
        padding: 8,
      }}
    >
      Chưa có ảnh
    </div>
  );
}

export function StoryboardStep({
  project,
  onGoStep,
  onRefresh,
}: {
  project: Project;
  onGoStep: (step: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const [prompts, setPrompts] = useState<Record<string, string>>(
    Object.fromEntries(project.storyboard.images.map((img) => [img.sceneId, img.prompt]))
  );
  const [backgroundPrompts, setBackgroundPrompts] = useState<Record<string, string>>(
    Object.fromEntries(project.storyboard.backgrounds.map((img) => [img.sceneId, img.prompt]))
  );
  const [saving, setSaving] = useState(false);
  const [busySceneId, setBusySceneId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [busyBackgroundSceneId, setBusyBackgroundSceneId] = useState<string | null>(null);
  const [busyBackgroundAll, setBusyBackgroundAll] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ src: string; alt: string } | null>(null);
  const [promptBusySceneId, setPromptBusySceneId] = useState<string | null>(null);
  const [promptBusyAll, setPromptBusyAll] = useState(false);
  const [promptBusyBackgroundSceneId, setPromptBusyBackgroundSceneId] = useState<string | null>(null);
  const [promptBusyBackgroundAll, setPromptBusyBackgroundAll] = useState(false);

  const labelById = new Map(project.script.scenes.map((s) => [s.id, s.label]));
  const backgroundById = new Map(project.storyboard.backgrounds.map((img) => [img.sceneId, img]));
  const allDone = project.storyboard.images.every((img) => img.status === 'done');

  async function saveAllPrompts(): Promise<boolean> {
    setError(null);
    try {
      // Chỉ gửi những ảnh có prompt thực sự thay đổi và KHÔNG đang generating.
      // Tránh gửi ảnh đang chạy (server sẽ trả warning "Không thể sửa ảnh đang generating"),
      // đồng thời tránh gửi thừa các ảnh không đổi.
      const changedImages = project.storyboard.images
        .filter((img) => img.status !== 'generating')
        .filter((img) => (prompts[img.sceneId] ?? img.prompt) !== img.prompt)
        .map((img) => ({ sceneId: img.sceneId, prompt: prompts[img.sceneId] ?? img.prompt }));
      const changedBackgrounds = project.storyboard.backgrounds
        .filter((img) => img.status !== 'generating')
        .filter((img) => (backgroundPrompts[img.sceneId] ?? img.prompt) !== img.prompt)
        .map((img) => ({ sceneId: img.sceneId, prompt: backgroundPrompts[img.sceneId] ?? img.prompt }));

      // Không có gì để lưu → coi như thành công, không cần gọi API.
      if (changedImages.length === 0 && changedBackgrounds.length === 0) {
        return true;
      }

      const res = await fetch(`/api/projects/${project.id}/storyboard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: changedImages, backgrounds: changedBackgrounds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Lưu prompt thất bại');
        return false;
      }
      if (data.warning) {
        setError(data.warning);
        return false;
      }
      await onRefresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveAllPrompts();
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateSettings(patch: {
    useProductReference?: boolean;
    useSpokespersonReference?: boolean;
  }) {
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Cập nhật cài đặt thất bại');
      await onRefresh();
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleGenerate(sceneId: string) {
    const saved = await saveAllPrompts();
    if (!saved) return;
    setBusySceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Gen ảnh thất bại');
      await onRefresh();
    } finally {
      setBusySceneId(null);
    }
  }

  async function handleGeneratePrompt(sceneId: string) {
    setPromptBusySceneId(sceneId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/generate-prompt`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sinh prompt bằng AI thất bại');
        return;
      }
      setPrompts((prev) => ({ ...prev, [sceneId]: data.prompt }));
      await onRefresh();
    } finally {
      setPromptBusySceneId(null);
    }
  }

  async function handleGeneratePromptsAll() {
    setPromptBusyAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/generate-prompts`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sinh prompt bằng AI thất bại');
        return;
      }
      if (data.failed?.length) {
        setError(`Một số cảnh sinh prompt lỗi: ${data.failed.map((f: { sceneId: string }) => f.sceneId).join(', ')}`);
      }
      const res2 = await fetch(`/api/projects/${project.id}/storyboard`);
      const data2 = await res2.json();
      if (res2.ok && data2.storyboard?.images) {
        setPrompts(
          Object.fromEntries(
            (data2.storyboard.images as StoryboardImage[]).map((img) => [img.sceneId, img.prompt])
          )
        );
      }
      await onRefresh();
    } finally {
      setPromptBusyAll(false);
    }
  }

  async function handleStop(sceneId: string) {
    setBusySceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/stop`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Dừng thất bại');
      await onRefresh();
    } finally {
      setBusySceneId(null);
    }
  }

  async function handleGenerateAll() {
    const saved = await saveAllPrompts();
    if (!saved) return;
    setBusyAll(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/generate-all`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Gen tất cả thất bại');
      await onRefresh();
    } finally {
      setBusyAll(false);
    }
  }

  async function handleGenerateBackground(sceneId: string) {
    const saved = await saveAllPrompts();
    if (!saved) return;
    setBusyBackgroundSceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/generate-background`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Gen ảnh background thất bại');
      await onRefresh();
    } finally {
      setBusyBackgroundSceneId(null);
    }
  }

  async function handleGenerateBackgroundPrompt(sceneId: string) {
    setPromptBusyBackgroundSceneId(sceneId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/generate-background-prompt`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sinh prompt background bằng AI thất bại');
        return;
      }
      setBackgroundPrompts((prev) => ({ ...prev, [sceneId]: data.prompt }));
      await onRefresh();
    } finally {
      setPromptBusyBackgroundSceneId(null);
    }
  }

  async function handleGenerateBackgroundPromptsAll() {
    setPromptBusyBackgroundAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/generate-background-prompts`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sinh prompt background bằng AI thất bại');
        return;
      }
      if (data.failed?.length) {
        setError(`Một số cảnh sinh prompt background lỗi: ${data.failed.map((f: { sceneId: string }) => f.sceneId).join(', ')}`);
      }
      const res2 = await fetch(`/api/projects/${project.id}/storyboard`);
      const data2 = await res2.json();
      if (res2.ok && data2.storyboard?.backgrounds) {
        setBackgroundPrompts(
          Object.fromEntries(
            (data2.storyboard.backgrounds as StoryboardImage[]).map((img) => [img.sceneId, img.prompt])
          )
        );
      }
      await onRefresh();
    } finally {
      setPromptBusyBackgroundAll(false);
    }
  }

  async function handleStopBackground(sceneId: string) {
    setBusyBackgroundSceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/stop-background`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Dừng thất bại');
      await onRefresh();
    } finally {
      setBusyBackgroundSceneId(null);
    }
  }

  async function handleGenerateBackgroundAll() {
    const saved = await saveAllPrompts();
    if (!saved) return;
    setBusyBackgroundAll(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/generate-backgrounds`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Gen background tất cả thất bại');
      await onRefresh();
    } finally {
      setBusyBackgroundAll(false);
    }
  }

  async function handleGoStep(step: number) {
    const ok = await saveAllPrompts();
    if (ok) onGoStep(step);
  }

  const anyBusy = saving || busyAll || busyBackgroundAll;

  return (
    <div className="card">
      <div className="card-header">
        🖼️ <span>Bước 3 — Storyboard ảnh (Orino Flow)</span>
        <span className={`badge ${allDone ? 'badge-done' : 'badge-pending'}`}>{allDone ? 'Done' : 'Chưa xong'}</span>
      </div>

      <div className="step-actions">
        <button className="btn" onClick={() => handleGoStep(2)} disabled={anyBusy}>
          ← Quay lại
        </button>
        <button className="btn" onClick={handleSave} disabled={anyBusy}>
          {saving ? 'Đang lưu...' : '💾 Lưu prompt'}
        </button>
        <button
          className="btn"
          onClick={handleGeneratePromptsAll}
          disabled={promptBusyAll || promptBusySceneId !== null || busyAll}
        >
          {promptBusyAll ? 'Đang sinh prompt...' : '✨ Sinh prompt tất cả bằng AI'}
        </button>
        <button
          className="btn"
          onClick={handleGenerateBackgroundPromptsAll}
          disabled={promptBusyBackgroundAll || promptBusyBackgroundSceneId !== null || busyBackgroundAll}
        >
          {promptBusyBackgroundAll ? 'Đang sinh prompt background...' : '✨ Sinh prompt background tất cả bằng AI'}
        </button>
        <button className="btn" onClick={handleGenerateAll} disabled={busyAll || saving}>
          {busyAll ? 'Đang gen...' : '🎨 Gen tất cả'}
        </button>
        <button className="btn" onClick={handleGenerateBackgroundAll} disabled={busyBackgroundAll || saving}>
          {busyBackgroundAll ? 'Đang gen background...' : '🖼️ Gen background tất cả'}
        </button>
        <button className="btn btn-primary" onClick={() => handleGoStep(4)} disabled={anyBusy}>
          ✓ Xong → Gen video
        </button>
      </div>

      <div className="banner banner-info">
        Mỗi cảnh trong kịch bản đã duyệt ở Bước 2 sẽ có 1 ảnh storyboard tương ứng, sinh qua{' '}
        <strong>Orino Flow</strong> (flow_generate_image) — dùng chung tài khoản Google Flow đã đăng nhập cho gen
        video ở Bước 4, không cần API key riêng. Ảnh sản phẩm có thể dùng làm ảnh tham chiếu để giữ đúng hình
        dạng/màu sắc sản phẩm thật. Prompt ảnh có thể tự viết tay, hoặc bấm{' '}
        <strong>&quot;✨ Sinh prompt bằng AI&quot;</strong> để AI viết dựa trên thông tin sản phẩm (Bước 1) và nội
        dung cảnh đã duyệt (Bước 2). Ngoài ra, mỗi cảnh còn có thêm 1{' '}
        <strong>ảnh background riêng (chỉ bối cảnh, không có sản phẩm)</strong> — ảnh này chỉ dùng để xem/tải ở
        Bước 3, KHÔNG tự động dùng làm ảnh tham chiếu khi gen video ở Bước 4.
      </div>

      {project.inputs.productImages.length > 0 && (
        <div className="field-group">
          <label>Ảnh sản phẩm tham chiếu</label>
          <div className="image-preview-grid">
            {project.inputs.productImages.map((p) => (
              <img key={p} className="image-preview-thumb" src={`/api/projects/${project.id}/media/${p}`} alt="Ảnh sản phẩm" />
            ))}
          </div>
        </div>
      )}

      <div className="field-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={project.storyboard.useProductReference}
            disabled={savingSettings}
            onChange={(e) => handleUpdateSettings({ useProductReference: e.target.checked })}
          />
          Dùng ảnh sản phẩm làm ảnh tham chiếu khi gen storyboard
        </label>
      </div>

      {project.inputs.spokespersonImagePath && (
        <>
          <div className="field-group">
            <label>Ảnh nhân vật tham chiếu (Bước 1)</label>
            <div className="image-preview-grid">
              <img
                className="image-preview-thumb"
                src={`/api/projects/${project.id}/media/${project.inputs.spokespersonImagePath}`}
                alt="Ảnh nhân vật"
              />
            </div>
          </div>

          <div className="field-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={project.storyboard.useSpokespersonReference}
                disabled={savingSettings}
                onChange={(e) => handleUpdateSettings({ useSpokespersonReference: e.target.checked })}
              />
              Dùng ảnh nhân vật (Bước 1) làm ảnh tham chiếu khi gen storyboard
            </label>
          </div>
        </>
      )}

      <div className="scene-list">
        {project.storyboard.images.map((image, i) => {
          const background = backgroundById.get(image.sceneId);
          const imageSrc = image.imagePath ? `/api/projects/${project.id}/media/${image.imagePath}` : null;
          const imageAlt = `Storyboard ${image.sceneId}`;
          return (
          <div key={image.sceneId} className="script-edit-row">
            <div className="scene-row-header">
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="scene-label-input" style={{ border: 'none', background: 'none' }}>
                {labelById.get(image.sceneId) || image.sceneId}
              </span>
              <span className={`status ${statusClass(image.status)}`}>{statusText(image.status)}</span>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <textarea
                rows={3}
                style={{ flex: 1, minWidth: 260 }}
                placeholder="Prompt ảnh storyboard (tiếng Anh)..."
                value={prompts[image.sceneId] ?? ''}
                disabled={image.status === 'generating'}
                onChange={(e) => setPrompts((prev) => ({ ...prev, [image.sceneId]: e.target.value }))}
              />
              <ImageThumb
                src={imageSrc}
                alt={imageAlt}
                onClick={imageSrc ? () => setModal({ src: imageSrc, alt: imageAlt }) : undefined}
              />
            </div>

            {image.error && (
              <div className="script-line" style={{ fontSize: 11, color: 'var(--danger, #f87171)' }}>
                {image.error}
              </div>
            )}

            <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="retry-btn"
                onClick={() => handleGeneratePrompt(image.sceneId)}
                disabled={
                  image.status === 'generating' || promptBusySceneId === image.sceneId || promptBusyAll
                }
              >
                {promptBusySceneId === image.sceneId ? '⏳ Đang sinh...' : '✨ Sinh prompt bằng AI'}
              </button>
              {image.status === 'generating' ? (
                <button
                  className="retry-btn"
                  onClick={() => handleStop(image.sceneId)}
                  disabled={busySceneId === image.sceneId}
                  title="Chỉ dừng theo dõi phía app, không hủy được ảnh đang render bên Google Flow"
                >
                  ⏹ Dừng
                </button>
              ) : (
                <button
                  className="retry-btn"
                  onClick={() => handleGenerate(image.sceneId)}
                  disabled={busySceneId === image.sceneId || busyAll}
                >
                  {image.status === 'failed' ? '🔄 Retry' : '▶ Gen'}
                </button>
              )}
            </div>

            {background && (() => {
              const backgroundSrc = background.imagePath
                ? `/api/projects/${project.id}/media/${background.imagePath}`
                : null;
              const backgroundAlt = `Background ${background.sceneId}`;
              return (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                <div className="scene-row-header" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🌄 Ảnh background (chỉ bối cảnh)</span>
                  <span className={`status ${statusClass(background.status)}`}>{statusText(background.status)}</span>
                </div>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <textarea
                    rows={3}
                    style={{ flex: 1, minWidth: 260 }}
                    placeholder="Prompt ảnh background (tiếng Anh, không có sản phẩm)..."
                    value={backgroundPrompts[background.sceneId] ?? ''}
                    disabled={background.status === 'generating'}
                    onChange={(e) =>
                      setBackgroundPrompts((prev) => ({ ...prev, [background.sceneId]: e.target.value }))
                    }
                  />
                  <ImageThumb
                    src={backgroundSrc}
                    alt={backgroundAlt}
                    onClick={backgroundSrc ? () => setModal({ src: backgroundSrc, alt: backgroundAlt }) : undefined}
                  />
                </div>

                {background.error && (
                  <div className="script-line" style={{ fontSize: 11, color: 'var(--danger, #f87171)' }}>
                    {background.error}
                  </div>
                )}

                <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="retry-btn"
                    onClick={() => handleGenerateBackgroundPrompt(background.sceneId)}
                    disabled={
                      background.status === 'generating' ||
                      promptBusyBackgroundSceneId === background.sceneId ||
                      promptBusyBackgroundAll
                    }
                  >
                    {promptBusyBackgroundSceneId === background.sceneId ? '⏳ Đang sinh...' : '✨ Sinh prompt bằng AI'}
                  </button>
                  {background.status === 'generating' ? (
                    <button
                      className="retry-btn"
                      onClick={() => handleStopBackground(background.sceneId)}
                      disabled={busyBackgroundSceneId === background.sceneId}
                      title="Chỉ dừng theo dõi phía app, không hủy được ảnh đang render bên Google Flow"
                    >
                      ⏹ Dừng
                    </button>
                  ) : (
                    <button
                      className="retry-btn"
                      onClick={() => handleGenerateBackground(background.sceneId)}
                      disabled={busyBackgroundSceneId === background.sceneId || busyBackgroundAll}
                    >
                      {background.status === 'failed' ? '🔄 Retry' : '▶ Gen'}
                    </button>
                  )}
                </div>
              </div>
              );
            })()}
          </div>
          );
        })}
      </div>

      {error && <div className="banner">{error}</div>}

      {modal && <MediaModal kind="image" src={modal.src} alt={modal.alt} onClose={() => setModal(null)} />}
    </div>
  );
}
