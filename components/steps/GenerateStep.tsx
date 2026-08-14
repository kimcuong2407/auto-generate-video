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
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const [busySceneId, setBusySceneId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [videoModalPath, setVideoModalPath] = useState<string | null>(null);
  const [copiedSceneId, setCopiedSceneId] = useState<string | null>(null);

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

  async function handleUpdateSettings(patch: { veoModel?: VeoModel; sceneChaining?: boolean }) {
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
          ⚠️ {project.flowStatusCache.projectsError || 'Google Flow chưa kết nối'} — vui lòng mở app Orino Flow và đăng
          nhập lại Google Flow trước khi tạo video. Đây không phải lỗi ứng dụng.
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
        Mỗi cảnh tự động dùng ảnh storyboard tương ứng đã gen ở Bước 3 (nếu có) làm ảnh tham chiếu khi gen video —
        không còn dùng ảnh sản phẩm/nhân vật gốc ở Bước 1.
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
                  src={`/api/projects/${project.id}/media/${storyboardImage.imagePath}`}
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
                <button className="retry-btn" onClick={() => setOpenPrompt(openPrompt === scene.id ? null : scene.id)}>
                  📋 Prompt
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
            {openPrompt === scene.id && (
              <div className="script-line" style={{ fontSize: 11 }}>
                {scene.veoPrompt || '(chưa có prompt — quay lại Bước 2 để nhập)'}
              </div>
            )}
          </div>
          );
        })}
      </div>

      {videoModalPath && (
        <MediaModal kind="video" src={videoModalPath} onClose={() => setVideoModalPath(null)} />
      )}
    </div>
  );
}
