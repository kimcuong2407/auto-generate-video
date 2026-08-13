'use client';

import { useState } from 'react';
import { useProjectPolling } from '@/hooks/useProjectPolling';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { UploadStep } from '@/components/steps/UploadStep';
import { StoryboardStep } from '@/components/steps/StoryboardStep';
import { ScriptReviewStep } from '@/components/steps/ScriptReviewStep';
import { GenerateStep } from '@/components/steps/GenerateStep';
import { DownloadStep } from '@/components/steps/DownloadStep';
import { ConcatStep } from '@/components/steps/ConcatStep';

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { project, loading, error, refresh } = useProjectPolling(params.id);
  const [currentStep, setCurrentStep] = useState(1);

  if (loading && !project) {
    return <div style={{ padding: 40 }}>Đang tải project...</div>;
  }
  if (error && !project) {
    return <div style={{ padding: 40, color: 'var(--red)' }}>Lỗi: {error}</div>;
  }
  if (!project) {
    return <div style={{ padding: 40 }}>Không tìm thấy project</div>;
  }

  return (
    <>
      <Sidebar project={project} currentStep={currentStep} onStepClick={setCurrentStep} />
      <main>
        <Topbar project={project} onRefresh={refresh} />
        <div className="content">
          {currentStep === 1 && <UploadStep project={project} onSaved={refresh} />}
          {currentStep === 2 && <ScriptReviewStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === 3 && <StoryboardStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === 4 && <GenerateStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === 5 && <DownloadStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === 6 && <ConcatStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
        </div>
      </main>
    </>
  );
}
