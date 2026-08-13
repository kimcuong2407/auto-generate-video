'use client';

import { useState } from 'react';
import type { Project } from '@/lib/types';
import { useAutoPipeline } from '@/hooks/useAutoPipeline';

const STEP_STATUS_ICON: Record<string, string> = {
  pending: '·',
  running: '⏳',
  done: '✅',
  skipped: '⏭️',
  error: '❌',
};

export function Topbar({
  project,
  onRefresh,
}: {
  project: Project;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pipeline = useAutoPipeline(project.id, onRefresh);

  async function handleReset() {
    if (!confirm('Reset toàn bộ trạng thái pipeline về Bước 1? (File đã gen sẽ được giữ lại)')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/reset`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Reset thất bại');
      }
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRunAll() {
    await pipeline.run();
  }

  async function handleStopAll() {
    pipeline.cancel();
    setBusy(true);
    try {
      const [scenesRes, storyboardRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/scenes/stop-all`, { method: 'POST' }),
        fetch(`/api/projects/${project.id}/storyboard/stop-all`, { method: 'POST' }),
      ]);
      if (!scenesRes.ok || !storyboardRes.ok) {
        alert('Dừng tất cả thất bại');
      }
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const hasGenerating =
    project.script.scenes.some((s) => s.status === 'generating') ||
    project.storyboard.images.some((img) => img.status === 'generating');

  return (
    <>
      <div className="topbar">
        <h1>{project.product.name || project.name}</h1>
        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={handleReset} disabled={busy || pipeline.running}>
            ↺ Reset
          </button>
          <button
            className="btn btn-ghost"
            onClick={handleStopAll}
            disabled={busy || (!hasGenerating && !pipeline.running)}
            title="Chỉ dừng theo dõi phía app, không hủy được job đang render bên Google Flow"
          >
            ⏹ Dừng tất cả
          </button>
          <button
            className="btn btn-primary"
            onClick={handleRunAll}
            disabled={busy || pipeline.running}
            title="Tự động chạy nối tiếp Bước 2 → 6, bỏ qua bước đã xong"
          >
            {pipeline.running ? '⏳ Đang chạy pipeline...' : '▶ Chạy toàn bộ'}
          </button>
        </div>
      </div>

      {pipeline.steps && (
        <div className="pipeline-progress">
          {pipeline.steps.map((step) => (
            <span
              key={step.key}
              className={`pipeline-chip ${step.status}`}
              title={step.message || undefined}
            >
              {STEP_STATUS_ICON[step.status]} {step.label}
              {step.message ? ` — ${step.message}` : ''}
            </span>
          ))}
          {!pipeline.running && (
            <button className="pipeline-progress-close" onClick={pipeline.dismiss}>
              ✕
            </button>
          )}
        </div>
      )}
    </>
  );
}
