'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { STEP_LABELS } from '@/components/Sidebar';
import { SCRIPT_ANGLES } from '@/lib/scriptAngles';
import { runScriptGenerateSSE } from '@/lib/client/scriptGenerate';
import type { ProjectSummary } from '@/lib/types';

type RowStatus = 'running' | 'done' | 'error';

const BULK_CONCURRENCY = 3;

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return iso;
  }
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAngleId, setBulkAngleId] = useState('');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  function refreshProjects() {
    return fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []));
  }

  useEffect(() => {
    refreshProjects();
  }, []);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!projects) return;
    setSelected((prev) => (prev.size === projects.length ? new Set() : new Set(projects.map((p) => p.id))));
  }

  async function runBulkGenerate() {
    if (!bulkAngleId) {
      setBulkError('Cần chọn 1 góc kịch bản trước khi sinh prompt hàng loạt');
      return;
    }
    setBulkError(null);
    const ids = Array.from(selected);
    setRowStatus((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = 'running';
      return next;
    });
    setRowError((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    setBulkRunning(true);

    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const id = ids[cursor];
        cursor += 1;
        try {
          await runScriptGenerateSSE(id, bulkAngleId);
          setRowStatus((prev) => ({ ...prev, [id]: 'done' }));
        } catch (err) {
          setRowStatus((prev) => ({ ...prev, [id]: 'error' }));
          setRowError((prev) => ({ ...prev, [id]: (err as Error).message }));
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(BULK_CONCURRENCY, ids.length) }, () => worker())
    );

    setBulkRunning(false);
    await refreshProjects();
  }

  const selectedGeneratingNames =
    projects && selected.size > 0
      ? projects.filter((p) => selected.has(p.id) && p.hasGeneratingScene).map((p) => p.name)
      : [];

  return (
    <div className="page-shell">
      <TopNav />
      <div className="list-wrap">
        <div className="page-header">
          <div>
            <div className="card-header" style={{ marginBottom: 0 }}>Danh sách project Video Review</div>
          </div>
          <a href="/shopee-crawl" className="btn btn-primary">
            🛍️ Tạo project từ Shopee Crawl
          </a>
        </div>

      {selected.size > 0 && (
        <div className="bulk-toolbar">
          <span>
            Đã chọn <strong>{selected.size}</strong> project
          </span>
          <select value={bulkAngleId} onChange={(e) => setBulkAngleId(e.target.value)} disabled={bulkRunning}>
            <option value="">-- Chọn góc kịch bản --</option>
            {SCRIPT_ANGLES.map((angle) => (
              <option key={angle.id} value={angle.id}>
                {angle.title}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={runBulkGenerate} disabled={bulkRunning}>
            {bulkRunning ? 'Đang sinh...' : '🚀 Sinh prompt AI hàng loạt'}
          </button>
          <button className="btn" onClick={() => setSelected(new Set())} disabled={bulkRunning}>
            Bỏ chọn
          </button>
          {selectedGeneratingNames.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--amber)' }}>
              ⚠️ {selectedGeneratingNames.join(', ')} đang có cảnh generating — sẽ báo lỗi riêng nếu ghi đè.
            </span>
          )}
        </div>
      )}
      {bulkError && <div className="banner">{bulkError}</div>}

      <div className="card">
        {projects === null && <div style={{ color: 'var(--text-muted)' }}>Đang tải danh sách project...</div>}

        {projects !== null && projects.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>
            Chưa có project nào.{' '}
            <a href="/shopee-crawl">Tạo project đầu tiên từ Shopee Crawl →</a>
          </div>
        )}

        {projects !== null && projects.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="projects-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.size === projects.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>Tên project</th>
                  <th>Sản phẩm</th>
                  <th>Bước</th>
                  <th>Tỷ lệ</th>
                  <th>Prompt AI</th>
                  <th>Cập nhật</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const status = rowStatus[p.id];
                  return (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelected(p.id)}
                        />
                      </td>
                      <td>
                        <Link href={`/projects/${p.id}`}>{p.name}</Link>
                      </td>
                      <td>{p.productName || '—'}</td>
                      <td>
                        Bước {p.currentStep}/6 · {STEP_LABELS[p.currentStep - 1] || ''}
                      </td>
                      <td>{p.aspectRatio}</td>
                      <td>
                        {status === 'running' && <span>⏳ Đang sinh...</span>}
                        {status === 'done' && <span style={{ color: 'var(--green)' }}>✅ Đã sinh xong</span>}
                        {status === 'error' && (
                          <span className="row-status-err" title={rowError[p.id]}>
                            ❌ {rowError[p.id]}
                          </span>
                        )}
                        {!status && (
                          <span
                            className={`badge ${
                              p.sceneCount > 0 && p.promptReadyCount === p.sceneCount
                                ? 'badge-done'
                                : p.promptReadyCount > 0
                                  ? 'badge-running'
                                  : 'badge-pending'
                            }`}
                          >
                            {p.promptReadyCount}/{p.sceneCount} cảnh
                          </span>
                        )}
                      </td>
                      <td>{formatUpdatedAt(p.updatedAt)}</td>
                      <td>
                        <Link href={`/projects/${p.id}`} className="back-link">
                          Mở →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
