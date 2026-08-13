'use client';

import Link from 'next/link';
import { UploadStep } from '@/components/steps/UploadStep';

export default function NewProjectPage() {
  return (
    <div className="home-wrap">
      <div className="logo" style={{ marginBottom: 24 }}>
        🎬 <span>Veo</span> Pipeline
      </div>
      <Link href="/" className="back-link" style={{ marginBottom: 24, display: 'inline-block' }}>
        ← Danh sách project
      </Link>
      <UploadStep />
    </div>
  );
}
