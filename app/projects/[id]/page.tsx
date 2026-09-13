'use client';

import { useCallback, useEffect, useState } from 'react';
import { useProjectPolling } from '@/hooks/useProjectPolling';
import { Sidebar, hashFromStep, stepFromHash } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { ProjectGuide } from '@/components/steps/ProjectGuide';
import { UploadStep } from '@/components/steps/UploadStep';
import { StoryboardStep } from '@/components/steps/StoryboardStep';
import { ScriptReviewStep } from '@/components/steps/ScriptReviewStep';
import { GenerateStep } from '@/components/steps/GenerateStep';
import { DownloadStep } from '@/components/steps/DownloadStep';
import { ConcatStep } from '@/components/steps/ConcatStep';
import { StatusBannerProvider, StatusBannerSlot } from '@/components/StatusBanner';

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { project, loading, error, refresh } = useProjectPolling(params.id);
  // SSR không đọc được location -> khởi tạo 1 rồi đồng bộ ngay trong effect đầu tiên,
  // tránh hydration mismatch khi URL có sẵn #storyboard.
  const [currentStep, setCurrentStep] = useState(1);

  // URL -> step: lần đầu mount (F5 vào thẳng #generate) và khi Mr.D bấm back/forward.
  useEffect(() => {
    const syncFromHash = () => {
      const step = stepFromHash(window.location.hash);
      if (step !== null) setCurrentStep(step);
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  // step -> URL: mọi đường đổi step (sidebar, nút "Sang bước sau") đều đi qua hàm này.
  const goStep = useCallback((step: number) => {
    setCurrentStep(step);
    const hash = hashFromStep(step);
    if (hash && window.location.hash !== hash) {
      // replaceState: đổi step không nhồi thêm entry rác vào history, back vẫn về trang trước.
      window.history.replaceState(null, '', hash);
    }
  }, []);

  // Bước 1 không có hash trong URL (vào project lần đầu) -> ghi #upload cho nhất quán.
  useEffect(() => {
    if (!project) return;
    if (stepFromHash(window.location.hash) === null) {
      window.history.replaceState(null, '', hashFromStep(currentStep));
    }
  }, [project, currentStep]);

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
    <StatusBannerProvider resetKey={currentStep}>
      <Sidebar project={project} currentStep={currentStep} onStepClick={goStep} />
      <main>
        <Topbar project={project} onRefresh={refresh} />
        {/* Ngay dưới Topbar và NGOÀI .content: chỉ .content cuộn, đặt trong đó là banner trôi
            khỏi màn hình khi Mr.D cuộn xuống danh sách cảnh. */}
        <StatusBannerSlot />
        <div className="content">
          {currentStep === 1 && (
            <>
              <ProjectGuide project={project} />
              <UploadStep project={project} onSaved={refresh} />
            </>
          )}
          {currentStep === 2 && <ScriptReviewStep project={project} onGoStep={goStep} onRefresh={refresh} />}
          {currentStep === 3 && <StoryboardStep project={project} onGoStep={goStep} onRefresh={refresh} />}
          {currentStep === 4 && <GenerateStep project={project} onGoStep={goStep} onRefresh={refresh} />}
          {currentStep === 5 && <DownloadStep project={project} onGoStep={goStep} onRefresh={refresh} />}
          {currentStep === 6 && <ConcatStep project={project} onGoStep={goStep} onRefresh={refresh} />}
        </div>
      </main>
    </StatusBannerProvider>
  );
}
