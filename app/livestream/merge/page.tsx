'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import type { LivestreamJobSummary, LivestreamMergeSummary } from '@/lib/livestream/types';

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: string): string {
  if (status === 'done') return 'badge-done';
  if (status === 'failed') return 'badge-error';
  if (status === 'running') return 'badge-running';
  return 'badge-pending';
}

export default function LivestreamMergeListPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<LivestreamJobSummary[] | null>(null);
  const [merges, setMerges] = useState<LivestreamMergeSummary[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]); // job id theo đúng thứ tự bấm chọn — cũng là thứ tự ghép
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/livestream').then((r) => r.json()).then((d) => setJobs(d.jobs || []));
    fetch('/api/livestream/merge').then((r) => r.json()).then((d) => setMerges(d.merges || []));
  }, []);

  // Chỉ job đã "Ghép video" xong (status done) mới có final.mp4 để gộp tiếp.
  const doneJobs = (jobs || []).filter((j) => j.status === 'done');

  function toggleJob(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function move(idx: number, dir: -1 | 1) {
    setSelected((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function handleCreate() {
    setError(null);
    if (!name.trim()) {
      setError('Nhập tên video gộp');
      return;
    }
    if (selected.length < 2) {
      setError('Chọn ít nhất 2 job');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/livestream/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), jobSlugs: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      router.push(`/livestream/merge/${data.merge.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell">
      <TopNav />
      <div className="list-wrap">
        <div className="page-header">
          <div className="card-header" style={{ marginBottom: 0 }}>🔗 Gộp nhiều job thành 1 video</div>
          <Link href="/livestream" className="back-link">← Danh sách job</Link>
        </div>

        <div className="card">
          <div className="banner banner-info">
            Chỉ gộp được các job đã tự &quot;Ghép video&quot; xong (trạng thái &quot;done&quot;), và tất cả job phải
            cùng tỉ lệ khung hình. Để hình mẫu/bối cảnh khớp nhau xuyên suốt, hãy dùng CHUNG 1 ảnh mẫu +
            1 ảnh background khi tạo từng job.
          </div>

          {jobs === null && <div>Đang tải danh sách job...</div>}
          {jobs !== null && doneJobs.length === 0 && <div>Chưa có job nào ghép video xong để gộp.</div>}

          {doneJobs.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="projects-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Tên job</th>
                    <th>Sản phẩm</th>
                    <th>Cập nhật</th>
                    <th>Thứ tự</th>
                  </tr>
                </thead>
                <tbody>
                  {doneJobs.map((j) => {
                    const idx = selected.indexOf(j.id);
                    return (
                      <tr key={j.id}>
                        <td>
                          <input type="checkbox" checked={idx >= 0} onChange={() => toggleJob(j.id)} />
                        </td>
                        <td>
                          {j.name} <span className="badge badge-pending">{j.aspectRatio}</span>
                        </td>
                        <td>{j.productCount}</td>
                        <td>{formatUpdatedAt(j.updatedAt)}</td>
                        <td>{idx >= 0 ? idx + 1 : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selected.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 6, color: 'var(--text-muted)' }}>Thứ tự ghép:</div>
              {selected.map((id, idx) => {
                const job = doneJobs.find((j) => j.id === id);
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span>{idx + 1}. {job?.name ?? id}</span>
                    <button className="btn btn-ghost" disabled={idx === 0} onClick={() => move(idx, -1)}>↑</button>
                    <button className="btn btn-ghost" disabled={idx === selected.length - 1} onClick={() => move(idx, 1)}>↓</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="field-group" style={{ maxWidth: 320, marginTop: 16 }}>
            <label>Tên video gộp</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Livestream 19/08 full" />
          </div>

          <div className="step-actions">
            <button className="btn btn-primary" onClick={handleCreate} disabled={submitting}>
              {submitting ? 'Đang tạo...' : '🎬 Tạo & ghép'}
            </button>
          </div>
          {error && <div className="banner">{error}</div>}
        </div>

        <div className="card">
          <div className="card-header">Video đã gộp trước đó</div>
          {merges !== null && merges.length === 0 && <div>Chưa có video gộp nào.</div>}
          {merges !== null && merges.length > 0 && (
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Số job</th>
                  <th>Trạng thái</th>
                  <th>Cập nhật</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {merges.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/livestream/merge/${m.id}`}>{m.name}</Link>
                    </td>
                    <td>{m.jobCount}</td>
                    <td>
                      <span className={`badge ${statusBadgeClass(m.status)}`}>{m.status}</span>
                    </td>
                    <td>{formatUpdatedAt(m.updatedAt)}</td>
                    <td>
                      <Link href={`/livestream/merge/${m.id}`} className="back-link">Mở →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
