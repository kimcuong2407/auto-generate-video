'use client';

import { useState } from 'react';
import { useProjectPolling } from '@/hooks/useProjectPolling';
import { Sidebar, PROMPT_STEP_NUM } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { ProjectGuide } from '@/components/steps/ProjectGuide';
import { UploadStep } from '@/components/steps/UploadStep';
import { StoryboardStep } from '@/components/steps/StoryboardStep';
import { ScriptReviewStep } from '@/components/steps/ScriptReviewStep';
import { GenerateStep } from '@/components/steps/GenerateStep';
import { DownloadStep } from '@/components/steps/DownloadStep';
import { ConcatStep } from '@/components/steps/ConcatStep';
import { ReviewPromptPanel } from '@/components/steps/ReviewPromptPanel';

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
          {currentStep === 1 && (
            <>
              <ProjectGuide project={project} />
              <UploadStep project={project} onSaved={refresh} />
            </>
          )}
          {currentStep === 2 && <ScriptReviewStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === 3 && <StoryboardStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === 4 && <GenerateStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === 5 && <DownloadStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === 6 && <ConcatStep project={project} onGoStep={setCurrentStep} onRefresh={refresh} />}
          {currentStep === PROMPT_STEP_NUM && <ReviewPromptPanel projectId={project.id} />}
        </div>
      </main>
    </>
  );
}
