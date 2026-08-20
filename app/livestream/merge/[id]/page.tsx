'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import type { LivestreamMerge } from '@/lib/livestream/types';

const POLL_INTERVAL_MS = 4500;

function logClass(line: string): string {
  if (line.startsWith('✓') || line.startsWith('🎉')) return 'log-ok';
  if (line.startsWith('✗') || line.toLowerCase().includes('lỗi')) return 'log-err';
  return '';
}

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function statusBadgeClass(status: string): string {
  if (status === 'done') return 'badge-done';
  if (status === 'failed') return 'badge-error';
  if (status === 'running') return 'badge-running';
  return 'badge-pending';
}

export default function LivestreamMergeDetailPage() {
  const params = useParams<{ id: string }>();
  const mergeId = params.id;
  const [merge, setMerge] = useState<LivestreamMerge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/livestream/merge/${mergeId}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || `HTTP ${res.status}`);
      return;
    }
    setMerge(data.merge);
    setError(null);
  }, [mergeId]);

  useEffect(() => {
    let cancelled = false;
    async function loop() {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      timerRef.current = setTimeout(loop, POLL_INTERVAL_MS);
    }
    loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/livestream/merge/${mergeId}/concat`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (!merge) {
    return (
      <div className="page-shell">
        <TopNav />
        <div className="list-wrap">{error ? <div className="banner">{error}</div> : <div>Đang tải...</div>}</div>
      </div>
    );
  }

  const { concat } = merge;

  return (
    <div className="page-shell">
      <TopNav />
      <div className="list-wrap">
        <div className="page-header">
          <div className="card-header" style={{ marginBottom: 0 }}>🎬 {merge.name}</div>
          <Link href="/livestream/merge" className="back-link">← Danh sách video gộp</Link>
        </div>

        <div className="card">
          <div className="card-header">
            Ghép {merge.jobSlugs.length} job thành 1 video
            <span className={`badge ${statusBadgeClass(concat.status)}`}>{concat.status}</span>
          </div>

          <ol>
            {merge.jobSlugs.map((slug) => (
              <li key={slug}>
                <Link href={`/livestream/${slug}`}>{slug}</Link>
              </li>
            ))}
          </ol>

          <div className="step-actions">
            <button className="btn btn-primary" onClick={handleStart} disabled={starting || concat.status === 'running'}>
              {concat.status === 'running' ? 'Đang ghép...' : concat.status === 'done' ? '🔁 Ghép lại' : '🎬 Bắt đầu ghép'}
            </button>
            {concat.status === 'done' && (concat.outputUrl || concat.outputPath) && (
              <a
                className="btn"
                href={concat.outputUrl ?? `/api/livestream/merge/${merge.id}/media/${concat.outputPath}`}
                download
              >
                ⬇️ Tải final.mp4
              </a>
            )}
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

          {concat.status === 'done' && concat.outputMeta && (
            <div className="output-bar" style={{ marginTop: 14 }}>
              <span className="check">🎉</span>
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
                src={concat.outputUrl ?? `/api/livestream/merge/${merge.id}/media/${concat.outputPath}`}
                style={{ maxWidth: '100%', borderRadius: 10 }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
