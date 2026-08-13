'use client';

import Link from 'next/link';
import type { Project } from '@/lib/types';

export const STEP_LABELS = [
  'Upload ảnh + Template',
  'Duyệt kịch bản',
  'Storyboard ảnh',
  'Gen video (Veo Flow)',
  'Tải output về máy',
  'Ghép video hoàn chỉnh',
];

function stepClassName(project: Project, stepNum: number, currentStep: number): string {
  const classes = ['step'];
  if (stepNum === currentStep) classes.push('active');

  if (stepNum === 3) {
    const hasFailed = project.storyboard.images.some((img) => img.status === 'failed');
    const allDone = project.storyboard.images.every((img) => img.status === 'done');
    if (hasFailed) classes.push('error');
    else if (allDone) classes.push('completed');
  } else if (stepNum === 4) {
    const hasFailed = project.script.scenes.some((s) => s.status === 'failed');
    const allDone = project.script.scenes.every((s) => s.status === 'done');
    if (hasFailed) classes.push('error');
    else if (allDone) classes.push('completed');
  } else if (stepNum === 6) {
    if (project.concat.status === 'failed') classes.push('error');
    else if (project.concat.status === 'done') classes.push('completed');
  } else if (stepNum < currentStep) {
    classes.push('completed');
  }

  return classes.join(' ');
}

export function Sidebar({
  project,
  currentStep,
  onStepClick,
}: {
  project: Project;
  currentStep: number;
  onStepClick: (step: number) => void;
}) {
  return (
    <aside>
      <div>
        <Link href="/" className="logo" style={{ textDecoration: 'none' }}>
          🎬 <span>Veo</span> Pipeline
        </Link>
        <Link href="/" className="back-link">
          ← Danh sách project
        </Link>
      </div>

      <div className="pipeline-steps">
        {STEP_LABELS.map((label, i) => {
          const stepNum = i + 1;
          return (
            <button
              key={stepNum}
              className={stepClassName(project, stepNum, currentStep)}
              onClick={() => onStepClick(stepNum)}
            >
              <span className="step-num">{stepNum}</span> {label}
            </button>
          );
        })}
      </div>

      <div className="project-info">
        <strong>{project.name}</strong>
        Model: {project.veoModel}
        <br />
        {project.script.scenes.length} cảnh × {project.script.totalDuration}s · {project.aspectRatio}
        <br />
        Status: {project.concat.status === 'done' ? 'hoàn thành' : 'đang xử lý'}
      </div>
    </aside>
  );
}
