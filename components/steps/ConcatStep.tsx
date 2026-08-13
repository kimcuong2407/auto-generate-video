'use client';

import { useState } from 'react';
import type { Project } from '@/lib/types';

function logClass(line: string): string {
  if (line.startsWith('✓') || line.startsWith('🎉')) return 'log-ok';
  if (line.startsWith('✗') || line.toLowerCase().includes('lỗi')) return 'log-err';
  return '';
}

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ConcatStep({
  project,
  onGoStep,
  onRefresh,
}: {
  project: Project;
  onGoStep: (step: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  async function handleToggleBurnText(checked: boolean) {
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ burnOnScreenText: checked }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Cập nhật cài đặt thất bại');
      await onRefresh();
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleConcat() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/concat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'missing_scenes') {
          setError(`Chưa có cảnh nào gen xong để ghép: ${data.scenes.join(', ')}`);
        } else {
          setError(data.error || 'Ghép video thất bại');
        }
        return;
      }
      await onRefresh();
    } finally {
      setStarting(false);
    }
  }

  const { concat } = project;
  const notDoneScenes = project.script.scenes.filter((s) => s.status !== 'done' || !s.videoPath);
  const readyScenes = project.script.scenes.filter((s) => s.status === 'done' && s.videoPath);

  return (
    <div className="card">
      <div className="card-header">
        🎬 <span>Bước 6 — Ghép video hoàn chỉnh (+ text overlay + nhạc nền)</span>
        <span
          className={`badge ${
            concat.status === 'done'
              ? 'badge-done'
              : concat.status === 'running'
              ? 'badge-running'
              : concat.status === 'failed'
              ? 'badge-error'
              : 'badge-pending'
          }`}
        >
          {concat.status}
        </span>
      </div>

      <div className="step-actions">
        <button className="btn" onClick={() => onGoStep(5)}>
          ← Quay lại
        </button>
        <button className="btn btn-primary" onClick={handleConcat} disabled={starting || concat.status === 'running'}>
          {concat.status === 'running' ? 'Đang ghép...' : '🎬 Ghép video'}
        </button>
        {concat.status === 'done' && concat.outputPath && (
          <a className="btn" href={`/api/projects/${project.id}/media/${concat.outputPath}`} download>
            ⬇️ Tải final.mp4
          </a>
        )}
      </div>

      {notDoneScenes.length > 0 && concat.status !== 'done' && (
        <div className="banner banner-info">
          ⚠️ Còn {notDoneScenes.length} cảnh chưa gen xong: <strong>{notDoneScenes.map((s) => s.id).join(', ')}</strong>.
          Nếu bấm &quot;Ghép video&quot; ngay, hệ thống sẽ bỏ qua các cảnh này và chỉ ghép {readyScenes.length} cảnh đã
          xong theo đúng thứ tự.
        </div>
      )}

      <div className="field-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={project.burnOnScreenText}
            disabled={savingSettings}
            onChange={(e) => handleToggleBurnText(e.target.checked)}
          />
          📝 Overlay chữ (onScreenText) lên video khi ghép
        </label>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Mặc định tắt — video ghép ra sạch, không có chữ đè lên hình. Bật nếu muốn burn nội dung cột &quot;On-screen
          text&quot; đã nhập ở Bước 2 lên từng cảnh.
        </span>
      </div>

      {error && <div className="banner">{error}</div>}
      {concat.error && <div className="banner">{concat.error}</div>}

      {concat.log.length > 0 && (
        <div className="log-area">
          {concat.log.map((line, i) => (
            <span key={i} className={logClass(line)}>
              {line}
            </span>
          ))}
        </div>
      )}

      {concat.status === 'done' && concat.outputPath && concat.outputMeta && (
        <div className="output-bar" style={{ marginTop: 14 }}>
          <span className="check">🎉</span>
          <span className="path">data/projects/{project.id}/{concat.outputPath}</span>
          <span className="size">
            {formatSize(concat.outputMeta.sizeBytes)} · {Math.round(concat.outputMeta.durationSec)}s ·{' '}
            {concat.outputMeta.width}×{concat.outputMeta.height} · {concat.outputMeta.fps}fps
          </span>
        </div>
      )}

      {concat.status === 'done' && concat.outputPath && (
        <div style={{ marginTop: 14 }}>
          <video controls src={`/api/projects/${project.id}/media/${concat.outputPath}`} style={{ maxWidth: '100%', borderRadius: 10 }} />
        </div>
      )}

    </div>
  );
}
