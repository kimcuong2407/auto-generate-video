'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CreateJobForm } from '@/components/livestream/CreateJobForm';
import type { LivestreamJobSummary } from '@/lib/livestream/types';

export default function LivestreamListPage() {
  const [jobs, setJobs] = useState<LivestreamJobSummary[] | null>(null);

  useEffect(() => {
    fetch('/api/livestream')
      .then((r) => r.json())
      .then((data) => setJobs(data.jobs || []));
  }, []);

  return (
    <div className="home-wrap">
      <div className="logo" style={{ marginBottom: 24 }}>
        📡 <span>Livestream</span> Script
      </div>

      <Link href="/" className="back-link" style={{ marginBottom: 24, display: 'inline-block' }}>
        ← Về trang chủ (pipeline 6 bước)
      </Link>

      {jobs && jobs.length > 0 && (
        <div className="card">
          <div className="card-header">Job đã tạo</div>
          <div className="project-list">
            {jobs.map((j) => (
              <Link key={j.id} href={`/livestream/${j.id}`}>
                {j.name} — {j.productCount} sản phẩm — <span className={`badge badge-${j.status === 'done' ? 'done' : j.status === 'failed' ? 'error' : j.status === 'draft' ? 'pending' : 'running'}`}>{j.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <CreateJobForm />
    </div>
  );
}
