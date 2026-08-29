'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import type { LivestreamJobSummary } from '@/lib/livestream/types';

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: LivestreamJobSummary['status']): string {
  if (status === 'done') return 'badge-done';
  if (status === 'failed') return 'badge-error';
  if (status === 'draft') return 'badge-pending';
  return 'badge-running';
}

export default function LivestreamV2ListPage() {
  const [jobs, setJobs] = useState<LivestreamJobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Cùng cách chống trắng màn hình như tab V1: API lỗi tạm thời trả body rỗng thì r.json() ném.
    fetch('/api/livestream?variant=v2')
      .then(async (r) => {
        if (!r.ok) throw new Error(`API lỗi ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setJobs(data.jobs || []);
        setError(null);
      })
      .catch((err) => {
        setError((err as Error).message || 'Không tải được danh sách job');
        setJobs([]);
      });
  }, []);

  return (
    <div className="page-shell">
      <TopNav />
      <div className="list-wrap">
        <div className="page-header">
          <div>
            <div className="card-header" style={{ marginBottom: 0 }}>
              Kịch bản Livestream Shopee (V2)
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              Kịch bản theo mô hình AIDA, mỗi cảnh có câu lệnh tạo video + lời thoại MC.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/livestream-v2/new" className="btn btn-primary">
              ➕ Tạo kịch bản Shopee mới
            </Link>
          </div>
        </div>

        <div className="card">
          {jobs === null && <div style={{ color: 'var(--text-muted)' }}>Đang tải danh sách job...</div>}

          {error && (
            <div className="badge-error" style={{ marginBottom: 12 }}>
              Lỗi tải danh sách: {error}. Thử tải lại trang.
            </div>
          )}

          {jobs !== null && !error && jobs.length === 0 && (
            <div style={{ color: 'var(--text-muted)' }}>
              Chưa có kịch bản V2 nào. <Link href="/livestream-v2/new">Tạo cái đầu tiên →</Link>
            </div>
          )}

          {jobs !== null && jobs.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="projects-table">
                <thead>
                  <tr>
                    <th>Tên job</th>
                    <th>Sản phẩm</th>
                    <th>Trạng thái</th>
                    <th>Cập nhật</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <Link href={`/livestream/${j.id}`}>{j.name}</Link>
                      </td>
                      <td>{j.productCount}</td>
                      <td>
                        <span className={`badge ${statusBadgeClass(j.status)}`}>{j.status}</span>
                      </td>
                      <td>{formatUpdatedAt(j.updatedAt)}</td>
                      <td>
                        <Link href={`/livestream/${j.id}`} className="back-link">
                          Mở →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
