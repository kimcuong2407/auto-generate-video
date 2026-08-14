'use client';

import type { Project } from '@/lib/types';

export function DownloadStep({
  project,
  onGoStep,
  onRefresh,
}: {
  project: Project;
  onGoStep: (step: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const doneScenes = project.script.scenes.filter((s) => s.status === 'done' && s.videoPath);

  async function handleRetryAllFailed() {
    await fetch(`/api/projects/${project.id}/scenes/retry-failed`, { method: 'POST' });
    await onRefresh();
  }

  return (
    <div className="card">
      <div className="card-header">
        ⬇️ <span>Bước 5 — Tải video về máy</span>
        <span className="badge badge-pending">{doneScenes.length}/{project.script.scenes.length} scene xong</span>
      </div>

      <div className="step-actions">
        <button className="btn" onClick={handleRetryAllFailed}>
          🔄 Retry cảnh lỗi
        </button>
        <button className="btn btn-primary" onClick={() => onGoStep(6)}>
          → Ghép video
        </button>
      </div>

      <div className="video-grid">
        {project.script.scenes.map((scene, i) => {
          const src = scene.videoUrl || (scene.videoPath ? `/api/projects/${project.id}/media/${scene.videoPath}` : null);
          return (
            <div key={scene.id} className="video-card">
              {src ? (
                <video controls muted playsInline src={src} />
              ) : (
                <div className="vid-empty">Chưa có video</div>
              )}
              <div className="vid-label">
                <span>
                  {String(i + 1).padStart(2, '0')}_{scene.id}.mp4
                </span>
                {src && (
                  <a href={src} download>
                    ⬇
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="output-bar" style={{ marginTop: 14 }}>
        <span className="check">✔</span>
        <span className="path">data/projects/{project.id}/outputs/scenes/</span>
        <span className="size">{doneScenes.length} files</span>
      </div>

    </div>
  );
}
