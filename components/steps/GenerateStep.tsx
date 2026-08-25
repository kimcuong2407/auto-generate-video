'use client';

import { useState } from 'react';
import type { Project, SceneStatus, VeoModel } from '@/lib/types';
import { MediaModal } from '@/components/MediaModal';

const MODEL_OPTIONS: { value: VeoModel; label: string }[] = [
  { value: 'veo_3_1_fast', label: 'Veo 3.1 Fast' },
  { value: 'veo_3_1_quality', label: 'Veo 3.1 Quality' },
  { value: 'veo_3_1_lite', label: 'Veo 3.1 Lite' },
  { value: 'veo_3_1_lite_low_priority', label: 'Veo 3.1 Lite (Lower Priority)' },
  { value: 'abra', label: 'Omni Flash (Abra)' },
];

function statusClass(s: SceneStatus): string {
  return (
    { idle: 'status-queued', queued: 'status-queued', generating: 'status-gen', done: 'status-ready', failed: 'status-failed' }[
      s
    ] || 'status-queued'
  );
}

function statusText(s: SceneStatus): string {
  return (
    { idle: 'Sẵn sàng', queued: 'Chờ', generating: '⏳ Đang gen...', done: '✅ Xong', failed: '❌ Lỗi' }[s] || 'Chờ'
  );
}

export function GenerateStep({
  project,
  onGoStep,
  onRefresh,
}: {
  project: Project;
  onGoStep: (step: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const [busySceneId, setBusySceneId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [videoModalPath, setVideoModalPath] = useState<string | null>(null);
  const [copiedSceneId, setCopiedSceneId] = useState<string | null>(null);
  // Ảnh tham chiếu + prompt đã/sẽ gửi lên veoflow cho 1 scene — xem nút "👁 Chi tiết".
  const [detailsSceneId, setDetailsSceneId] = useState<string | null>(null);
  const mediaSrc = (path: string) => `/api/projects/${project.id}/media/${path}`;

  async function handleCopyLink(sceneId: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSceneId(sceneId);
      setTimeout(() => setCopiedSceneId((cur) => (cur === sceneId ? null : cur)), 1500);
    } catch {
      // Clipboard API có thể bị chặn (không https / quyền) — fallback prompt để copy thủ công.
      window.prompt('Copy link video:', url);
    }
  }

  const flowExpired = !!project.flowStatusCache.projectsError || project.flowStatusCache.flowConnected === false;

  async function handleUpdateSettings(patch: {
    veoModel?: VeoModel;
    sceneChaining?: boolean;
    videoRefImagePaths?: string[];
  }) {
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/settings`, {
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
    setBusySceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/scenes/${sceneId}/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Gen thất bại');
      await onRefresh();
    } finally {
      setBusySceneId(null);
    }
  }

  async function handleRetry(sceneId: string) {
    setBusySceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/scenes/${sceneId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Retry thất bại');
      await onRefresh();
    } finally {
      setBusySceneId(null);
    }
  }

  async function handleStop(sceneId: string) {
    setBusySceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/scenes/${sceneId}/stop`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Dừng thất bại');
      await onRefresh();
    } finally {
      setBusySceneId(null);
    }
  }

  async function handleRetryAllFailed() {
    setBusyAll(true);
    try {
      await fetch(`/api/projects/${project.id}/scenes/retry-failed`, { method: 'POST' });
      await onRefresh();
    } finally {
      setBusyAll(false);
    }
  }

  const allDone = project.script.scenes.every((s) => s.status === 'done');
  const storyboardById = new Map(project.storyboard.images.map((img) => [img.sceneId, img]));

  // Pool ảnh có thể chọn thêm làm ref khi gen video: sản phẩm (Bước 1) + người mẫu (Bước 1) +
  // background đã gen xong (Bước 3). Ảnh storyboard mỗi cảnh KHÔNG nằm ở đây — nó tự động
  // đứng đầu danh sách ref, xem sceneGenerate.ts.
  const refCandidates: { path: string; url: string | null; label: string }[] = [
    ...project.inputs.productImages.map((p, i) => ({
      path: p,
      url: project.inputs.productImageUrls?.[i] ?? null,
      label: 'Sản phẩm',
    })),
    ...(project.inputs.spokespersonImagePath
      ? [{ path: project.inputs.spokespersonImagePath, url: project.inputs.spokespersonImageUrl, label: 'Người mẫu' }]
      : []),
    ...project.storyboard.backgrounds
      .filter((b) => b.status === 'done' && b.imagePath)
      .map((b) => ({ path: b.imagePath as string, url: b.imageUrl, label: 'Background' })),
  ];

  function toggleRefImage(path: string) {
    const cur = project.videoRefImagePaths || [];
    if (cur.includes(path)) {
      handleUpdateSettings({ videoRefImagePaths: cur.filter((p) => p !== path) });
    } else if (cur.length < 3) {
      handleUpdateSettings({ videoRefImagePaths: [...cur, path] });
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        🎥 <span>Bước 4 — Gen video từng cảnh (Veo Flow)</span>
        <span className={`badge ${allDone ? 'badge-done' : 'badge-pending'}`}>{allDone ? 'Done' : 'Đang xử lý'}</span>
      </div>

      <div className="step-actions">
        <button className="btn" onClick={() => onGoStep(3)}>
          ← Quay lại
        </button>
        <button className="btn" onClick={handleRetryAllFailed} disabled={busyAll}>
          🔄 Retry cảnh lỗi
        </button>
        <button className="btn btn-primary" onClick={() => onGoStep(5)}>
          → Tải output
        </button>
      </div>

      {flowExpired && (
        <div className="banner">
          ⚠️ {project.flowStatusCache.projectsError || 'Google Flow chưa kết nối'} — vui lòng vào{' '}
          <a href="/settings/flow">Cài đặt → Flow</a> để đăng nhập/cập nhật lại tài khoản Google Flow trước khi tạo
          video. Đây không phải lỗi ứng dụng.
        </div>
      )}

      <div className="field-group">
        <label>Model Veo</label>
        <select
          value={project.veoModel}
          disabled={savingSettings}
          onChange={(e) => handleUpdateSettings({ veoModel: e.target.value as VeoModel })}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            color: 'var(--text)',
            fontFamily: 'var(--font)',
            fontSize: 13,
            padding: '8px 12px',
          }}
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="banner banner-info">
        Mỗi cảnh tự động dùng ảnh storyboard tương ứng đã gen ở Bước 3 (nếu có) làm ảnh tham chiếu chính khi gen
        video. Có thể chọn thêm tối đa 3 ảnh (sản phẩm/người mẫu/background) ở phần bên dưới để gửi kèm.
      </div>

      <div className="field-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={project.sceneChaining}
            disabled={savingSettings}
            onChange={(e) => handleUpdateSettings({ sceneChaining: e.target.checked })}
          />
          🔗 Nối liền cảnh (dùng khung hình cuối cảnh trước làm khung hình đầu cảnh sau)
        </label>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Giúp các cảnh liên kết mượt hơn thay vì rời rạc. Khi bật, &quot;Chạy toàn bộ&quot; sẽ gen tuần tự (mỗi lần 1
          cảnh, cảnh sau tự động bắt đầu khi cảnh trước xong) thay vì song song, do cần chờ khung hình của cảnh
          trước.
        </span>
      </div>

      {refCandidates.length > 0 && (
        <div className="field-group">
          <label>Ảnh tham chiếu bổ sung (tối đa 3) — đã chọn {project.videoRefImagePaths.length}/3</label>
          <div className="image-preview-grid">
            {refCandidates.map((c, i) => {
              const selected = project.videoRefImagePaths.includes(c.path);
              const atLimit = project.videoRefImagePaths.length >= 3 && !selected;
              return (
                <div key={`${c.path}-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <img
                    className="image-preview-thumb"
                    src={c.url || mediaSrc(c.path)}
                    alt={c.label}
                    title={c.label}
                    onClick={() => !atLimit && !savingSettings && toggleRefImage(c.path)}
                    style={{
                      cursor: atLimit ? 'not-allowed' : 'pointer',
                      opacity: atLimit ? 0.4 : 1,
                      outline: selected ? '2px solid var(--accent, #6ee7b7)' : undefined,
                    }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{selected ? `✓ ${c.label}` : c.label}</span>
                </div>
              );
            })}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Ảnh storyboard của mỗi cảnh luôn được gửi trước; ảnh chọn ở đây lấp đầy phần còn lại (tối đa 3 ảnh
            ref/cảnh).
          </span>
        </div>
      )}

      {project.storyboard.images.some((img) => img.status === 'done' && img.imagePath) && project.veoModel !== 'abra' && (
        <div className="banner banner-info">
          ⚠️ Với model {project.veoModel}, khi dùng ảnh tham chiếu Google Flow chỉ hỗ trợ đúng <strong>8 giây/cảnh</strong> —
          hệ thống sẽ tự làm tròn duration về 8s. Nếu tài khoản Google Flow báo lỗi 403 (PERMISSION_DENIED /
          PUBLIC_ERROR_MODEL_ACCESS_DENIED), tài khoản chưa được cấp quyền dùng ảnh tham chiếu — liên hệ để cấp quyền
          hoặc đổi model.
        </div>
      )}

      <div className="scene-list">
        {project.script.scenes.map((scene, i) => {
          const storyboardImage = storyboardById.get(scene.id);
          const storyboardUsable = storyboardImage?.status === 'done' && storyboardImage.imagePath;
          return (
          <div key={scene.id}>
            <div className="scene-row">
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              {storyboardImage?.imagePath ? (
                <img
                  src={storyboardImage.imageUrl || `/api/projects/${project.id}/media/${storyboardImage.imagePath}`}
                  alt={`Storyboard ${scene.label}`}
                  title={storyboardUsable ? 'Đang dùng làm ảnh tham chiếu khi gen video' : 'Ảnh storyboard (chưa dùng làm tham chiếu)'}
                  style={{
                    width: 40,
                    height: 40,
                    objectFit: 'cover',
                    borderRadius: 6,
                    border: storyboardUsable ? '2px solid var(--accent, #6ee7b7)' : '1px solid var(--border)',
                    opacity: storyboardUsable ? 1 : 0.5,
                  }}
                />
              ) : null}
              <div className="info">
                <div className="label">{scene.label}</div>
                <div className="meta">
                  {scene.duration}s · {scene.camera} · {project.veoModel}
                  {scene.chainedFromPrevious ? ' · 🔗 nối cảnh trước' : ''}
                  {storyboardUsable ? ' · 🖼️ dùng storyboard làm ref' : ''}
                  {scene.error ? ` · ${scene.error}` : ''}
                </div>
              </div>
              <span className={`status ${statusClass(scene.status)}`}>{statusText(scene.status)}</span>
              <div className="actions">
                {scene.status === 'failed' ? (
                  <button
                    className="retry-btn"
                    onClick={() => handleRetry(scene.id)}
                    disabled={busySceneId === scene.id || flowExpired}
                  >
                    🔄 Retry
                  </button>
                ) : scene.status === 'generating' ? (
                  <button
                    className="retry-btn"
                    onClick={() => handleStop(scene.id)}
                    disabled={busySceneId === scene.id}
                    title="Chỉ dừng theo dõi phía app, không hủy được video đang render bên Google Flow"
                  >
                    ⏹ Dừng
                  </button>
                ) : (
                  <button
                    className="retry-btn"
                    onClick={() => handleGenerate(scene.id)}
                    disabled={busySceneId === scene.id || flowExpired}
                  >
                    ▶ Gen
                  </button>
                )}
                <button
                  className="retry-btn"
                  onClick={() => setDetailsSceneId(scene.id)}
                  title="Xem ảnh tham chiếu + prompt gửi lên Veo Flow"
                >
                  👁 Chi tiết
                </button>
                {scene.status === 'done' && scene.videoPath && (
                  <button
                    className="retry-btn"
                    onClick={() =>
                      setVideoModalPath(scene.videoUrl || `/api/projects/${project.id}/media/${scene.videoPath}`)
                    }
                  >
                    ▶ Xem video
                  </button>
                )}
                {scene.status === 'done' && scene.videoUrl && (
                  <button
                    className="retry-btn"
                    onClick={() => handleCopyLink(scene.id, scene.videoUrl as string)}
                    title={scene.videoUrl}
                  >
                    {copiedSceneId === scene.id ? '✅ Đã copy' : '🔗 Copy link'}
                  </button>
                )}
              </div>
            </div>
            {scene.status === 'done' && scene.videoUrl && (
              <div
                className="script-line"
                style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span style={{ color: 'var(--text-muted)' }}>🌐 R2:</span>
                <a
                  href={scene.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent, #6ee7b7)', wordBreak: 'break-all' }}
                >
                  {scene.videoUrl}
                </a>
              </div>
            )}
          </div>
          );
        })}
      </div>

      {videoModalPath && (
        <MediaModal kind="video" src={videoModalPath} onClose={() => setVideoModalPath(null)} />
      )}

      {detailsSceneId && (() => {
        const scene = project.script.scenes.find((s) => s.id === detailsSceneId);
        if (!scene) return null;
        // Tái hiện đúng logic cắt/gộp ref của sceneGenerate.ts để hiển thị chính xác ảnh sẽ gửi.
        const storyboardImage = storyboardById.get(scene.id);
        const storyboardRelPath =
          storyboardImage?.status === 'done' && storyboardImage.imagePath ? storyboardImage.imagePath : null;
        const prevScene = project.script.scenes.find((s) => s.order === scene.order - 1);
        const hasPrevFrame = project.sceneChaining && prevScene?.status === 'done' && !!prevScene.lastFramePath;
        const cappedRefPaths = [...(storyboardRelPath ? [storyboardRelPath] : []), ...project.videoRefImagePaths].slice(
          0,
          hasPrevFrame ? 2 : 3
        );
        const startFramePath = hasPrevFrame && cappedRefPaths.length === 0 ? (prevScene!.lastFramePath as string) : null;
        const finalRefPaths = hasPrevFrame && cappedRefPaths.length > 0
          ? [...cappedRefPaths, prevScene!.lastFramePath as string]
          : cappedRefPaths;
        const refItems = finalRefPaths.map((p) => {
          if (p === storyboardRelPath) return { src: storyboardImage!.imageUrl || mediaSrc(p), label: 'Storyboard' };
          const cand = refCandidates.find((c) => c.path === p);
          if (cand) return { src: cand.url || mediaSrc(p), label: cand.label };
          return { src: mediaSrc(p), label: 'Frame nối cảnh trước' };
        });
        return (
          <div className="media-modal-overlay" onClick={() => setDetailsSceneId(null)}>
            <div
              className="media-modal-content"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 20,
                width: 560,
                maxWidth: '90vw',
                textAlign: 'left',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="media-modal-close" onClick={() => setDetailsSceneId(null)} title="Đóng">
                ✕
              </button>
              <h4 style={{ marginTop: 0 }}>Chi tiết {scene.label}</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {refItems.length === 0 && !startFramePath && (
                  <span style={{ opacity: 0.6 }}>Không có ảnh tham chiếu — gen chỉ bằng text prompt</span>
                )}
                {refItems.map((item, i) => (
                  <div key={i}>
                    <img
                      src={item.src}
                      alt={item.label}
                      style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8 }}
                    />
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, textAlign: 'center' }}>{item.label}</div>
                  </div>
                ))}
                {startFramePath && (
                  <div>
                    <img
                      src={mediaSrc(startFramePath)}
                      alt="Khung hình đầu (nối từ cảnh trước)"
                      style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8 }}
                    />
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, textAlign: 'center' }}>Start frame</div>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>Prompt gửi Veo Flow:</div>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                  background: 'var(--bg)',
                  padding: 10,
                  borderRadius: 8,
                  maxHeight: '30vh',
                  overflowY: 'auto',
                }}
              >
                {scene.veoPrompt || '(chưa có prompt — quay lại Bước 2 để nhập)'}
              </pre>
              {scene.negativePrompt && (
                <>
                  <div style={{ fontSize: 13, opacity: 0.8, margin: '10px 0 4px' }}>Negative prompt:</div>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      fontSize: 13,
                      background: 'var(--bg)',
                      padding: 10,
                      borderRadius: 8,
                      maxHeight: '20vh',
                      overflowY: 'auto',
                    }}
                  >
                    {scene.negativePrompt}
                  </pre>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
