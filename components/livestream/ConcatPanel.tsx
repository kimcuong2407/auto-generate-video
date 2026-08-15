'use client';

import { useState } from 'react';
import type { LivestreamJob } from '@/lib/livestream/types';

function logClass(line: string): string {
  if (line.startsWith('✓') || line.startsWith('🎉')) return 'log-ok';
  if (line.startsWith('✗') || line.toLowerCase().includes('lỗi')) return 'log-err';
  return '';
}

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ConcatPanel({ job, onRefresh }: { job: LivestreamJob; onRefresh: () => Promise<void> }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConcat() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/livestream/${job.id}/concat`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'missing_segments') {
          setError(`Chưa có đoạn nào gen xong để ghép: ${data.segments.join(', ')}`);
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

  const { concat } = job;
  const allSegments = job.products.flatMap((p) => p.segments);
  const notDone = allSegments.filter((s) => s.status !== 'done' || !s.videoPath);
  const ready = allSegments.filter((s) => s.status === 'done' && s.videoPath);

  return (
    <div className="card">
      <div className="card-header">
        🎬 <span>Ghép video livestream cuối cùng</span>
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
        <button className="btn btn-primary" onClick={handleConcat} disabled={starting || concat.status === 'running'}>
          {concat.status === 'running' ? 'Đang ghép...' : '🎬 Ghép video'}
        </button>
        {concat.status === 'done' && (concat.outputUrl || concat.outputPath) && (
          <a
            className="btn"
            href={concat.outputUrl ?? `/api/livestream/${job.id}/media/${concat.outputPath}`}
            download
          >
            ⬇️ Tải final.mp4
          </a>
        )}
      </div>

      {notDone.length > 0 && concat.status !== 'done' && (
        <div className="banner banner-info">
          ⚠️ Còn {notDone.length} đoạn chưa gen xong. Nếu bấm &quot;Ghép video&quot; ngay, hệ thống sẽ bỏ qua các đoạn
          này và chỉ ghép {ready.length} đoạn đã xong theo đúng thứ tự.
        </div>
      )}

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

      {concat.status === 'done' && (concat.outputUrl || concat.outputPath) && concat.outputMeta && (
        <div className="output-bar" style={{ marginTop: 14 }}>
          <span className="check">🎉</span>
          <span className="path">
            {concat.outputUrl ?? `data/livestream/${job.id}/${concat.outputPath}`}
          </span>
          <span className="size">
            {formatSize(concat.outputMeta.sizeBytes)} · {Math.round(concat.outputMeta.durationSec)}s ·{' '}
            {concat.outputMeta.width}×{concat.outputMeta.height} · {concat.outputMeta.fps}fps
          </span>
        </div>
      )}

      {concat.status === 'done' && (concat.outputUrl || concat.outputPath) && (
        <div style={{ marginTop: 14 }}>
          <video
            controls
            src={concat.outputUrl ?? `/api/livestream/${job.id}/media/${concat.outputPath}`}
            style={{ maxWidth: '100%', borderRadius: 10 }}
          />
        </div>
      )}
    </div>
  );
}
