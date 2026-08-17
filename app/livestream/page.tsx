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

export default function LivestreamListPage() {
  const [jobs, setJobs] = useState<LivestreamJobSummary[] | null>(null);

  useEffect(() => {
    fetch('/api/livestream')
      .then((r) => r.json())
      .then((data) => setJobs(data.jobs || []));
  }, []);

  return (
    <div className="page-shell">
      <TopNav />
      <div className="list-wrap">
        <div className="page-header">
          <div>
            <div className="card-header" style={{ marginBottom: 0 }}>Danh sách job Livestream Script</div>
          </div>
          <Link href="/shopee-crawl" className="btn btn-primary">🛍️ Tạo job từ Shopee Crawl</Link>
        </div>

        <div className="card">
          {jobs === null && <div style={{ color: 'var(--text-muted)' }}>Đang tải danh sách job...</div>}

          {jobs !== null && jobs.length === 0 && (
            <div style={{ color: 'var(--text-muted)' }}>
              Chưa có job livestream nào.{' '}
              <Link href="/shopee-crawl">Tạo job từ Shopee Crawl →</Link>
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
