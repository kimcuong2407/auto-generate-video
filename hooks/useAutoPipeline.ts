'use client';

import { useCallback, useRef, useState } from 'react';
import type { Project } from '@/lib/types';
import { runScriptGenerateSSE } from '@/lib/client/scriptGenerate';

export type PipelineStepKey = 'script' | 'storyboard' | 'video' | 'concat';
export type PipelineStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface PipelineStepInfo {
  key: PipelineStepKey;
  label: string;
  status: PipelineStepStatus;
  message?: string;
}

const STEP_DEFS: { key: PipelineStepKey; label: string }[] = [
  { key: 'script', label: 'Bước 2 · Kịch bản' },
  { key: 'storyboard', label: 'Bước 3 · Storyboard' },
  { key: 'video', label: 'Bước 4 · Video' },
  { key: 'concat', label: 'Bước 6 · Ghép video' },
];

/** Thứ tự thực thi các bước — dùng để so sánh khi dừng ở đích (targetStep). */
const STEP_ORDER: PipelineStepKey[] = ['script', 'storyboard', 'video', 'concat'];

/** Số lần thử tối đa cho mỗi bước generate có thể gặp lỗi tạm thời (storyboard/video). */
const MAX_STEP_ATTEMPTS = 3;

class PipelineCancelledError extends Error {
  constructor() {
    super('Đã dừng theo yêu cầu');
  }
}

function initialSteps(): PipelineStepInfo[] {
  return STEP_DEFS.map((s) => ({ ...s, status: 'pending' as PipelineStepStatus }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLatestProject(projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects/${projectId}/status`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { project: Project };
  return data.project;
}

async function postJson(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

/**
 * Orchestrator chạy nối tiếp Bước 2 (kịch bản) → 3 (storyboard) → 4 (video) → 6 (ghép video)
 * cho 1 project, bỏ qua bước nào đã xong sẵn. Bước 4/6 dùng API fire-and-forget nên phải tự
 * poll GET /status (độc lập với useProjectPolling ở trang chi tiết) cho tới khi ổn định.
 */
export function useAutoPipeline(projectId: string, onRefresh: () => Promise<void>) {
  const [steps, setSteps] = useState<PipelineStepInfo[] | null>(null);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const updateStep = useCallback((key: PipelineStepKey, patch: Partial<PipelineStepInfo>) => {
    setSteps((prev) => (prev ? prev.map((s) => (s.key === key ? { ...s, ...patch } : s)) : prev));
  }, []);

  const checkCancelled = useCallback(() => {
    if (cancelRef.current) throw new PipelineCancelledError();
  }, []);

  const waitUntil = useCallback(
    async (predicate: (p: Project) => boolean, intervalMs: number, timeoutMs: number): Promise<Project> => {
      const start = Date.now();
      while (true) {
        checkCancelled();
        const p = await fetchLatestProject(projectId);
        if (predicate(p)) return p;
        if (Date.now() - start > timeoutMs) {
          throw new Error('Quá thời gian chờ, vui lòng kiểm tra lại thủ công');
        }
        await sleep(intervalMs);
      }
    },
    [projectId, checkCancelled]
  );

  /** Dừng pipeline sau khi hoàn thành bước đích: trả về true nếu bước hiện tại là đích. */
  const reachedTarget = useCallback((step: PipelineStepKey, target: PipelineStepKey) => {
    return STEP_ORDER.indexOf(step) >= STEP_ORDER.indexOf(target);
  }, []);

  const run = useCallback(
    async (targetStep: PipelineStepKey = 'concat') => {
      if (running) return;
      cancelRef.current = false;
      setRunning(true);
      setSteps(initialSteps());

      try {
        let current = await fetchLatestProject(projectId);

        // Bước 2 — Kịch bản
        updateStep('script', { status: 'running' });
        checkCancelled();
        const hasAllPrompts =
          current.script.scenes.length > 0 && current.script.scenes.every((s) => s.veoPrompt.trim().length > 0);
        if (hasAllPrompts) {
          updateStep('script', { status: 'skipped', message: 'Đã có prompt' });
        } else if (!current.scriptAngleId) {
          updateStep('script', {
            status: 'error',
            message: 'Cần chọn góc kịch bản ở Bước 2 trước khi chạy tự động',
          });
          return;
        } else {
          await runScriptGenerateSSE(projectId, current.scriptAngleId);
          current = await fetchLatestProject(projectId);
          updateStep('script', { status: 'done' });
        }
        if (reachedTarget('script', targetStep)) return;
        checkCancelled();

        // Bước 3 — Storyboard (không đụng tới ảnh background — chỉ phụ trợ, không bắt buộc cho Bước 4)
        updateStep('storyboard', { status: 'running' });
        const allStoryboardDone =
          current.storyboard.images.length > 0 && current.storyboard.images.every((img) => img.status === 'done');
        if (allStoryboardDone) {
          updateStep('storyboard', { status: 'skipped', message: 'Đã xong' });
        } else {
          const missingPrompt = current.storyboard.images.some((img) => !img.prompt.trim());
          if (missingPrompt) {
            await postJson(`/api/projects/${projectId}/storyboard/generate-prompts`);
            checkCancelled();
          }
          // Auto-retry: gọi lại generate-all (route chỉ trigger ảnh idle|failed) tối đa
          // MAX_STEP_ATTEMPTS lần trước khi báo lỗi.
          let failedImages: typeof current.storyboard.images = [];
          for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
            checkCancelled();
            await postJson(`/api/projects/${projectId}/storyboard/generate-all`);
            current = await fetchLatestProject(projectId);
            failedImages = current.storyboard.images.filter((img) => img.status === 'failed');
            if (failedImages.length === 0) break;
            if (attempt < MAX_STEP_ATTEMPTS) {
              updateStep('storyboard', {
                status: 'running',
                message: `${failedImages.length} ảnh lỗi — thử lại (${attempt}/${MAX_STEP_ATTEMPTS})`,
              });
            }
          }
          if (failedImages.length > 0) {
            updateStep('storyboard', {
              status: 'error',
              message: `${failedImages.length} ảnh lỗi sau ${MAX_STEP_ATTEMPTS} lần thử`,
            });
            return;
          }
          updateStep('storyboard', { status: 'done' });
        }
        if (reachedTarget('storyboard', targetStep)) return;
        checkCancelled();

        // Bước 4 — Video
        updateStep('video', { status: 'running' });
        const allVideoDone =
          current.script.scenes.length > 0 && current.script.scenes.every((s) => s.status === 'done');
        if (allVideoDone) {
          updateStep('video', { status: 'skipped', message: 'Đã xong' });
        } else {
          // Auto-retry: mỗi vòng gọi scenes/generate-all (chỉ trigger scene chưa done) rồi
          // chờ tới khi không còn scene generating; lặp tối đa MAX_STEP_ATTEMPTS nếu còn scene lỗi.
          let notDone: typeof current.script.scenes = [];
          for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
            checkCancelled();
            await postJson(`/api/projects/${projectId}/scenes/generate-all`);
            current = await waitUntil(
              (p) => p.script.scenes.every((s) => s.status !== 'generating'),
              4000,
              45 * 60 * 1000
            );
            notDone = current.script.scenes.filter((s) => s.status !== 'done');
            if (notDone.length === 0) break;
            if (attempt < MAX_STEP_ATTEMPTS) {
              updateStep('video', {
                status: 'running',
                message: `${notDone.length} cảnh lỗi — thử lại (${attempt}/${MAX_STEP_ATTEMPTS})`,
              });
            }
          }
          if (notDone.length > 0) {
            updateStep('video', {
              status: 'error',
              message: `${notDone.length} cảnh chưa xong sau ${MAX_STEP_ATTEMPTS} lần thử (lỗi hoặc bị chặn chain)`,
            });
            return;
          }
          updateStep('video', { status: 'done' });
        }
        if (reachedTarget('video', targetStep)) return;
        checkCancelled();

        // Bước 6 — Ghép video
        updateStep('concat', { status: 'running' });
        if (current.concat.status === 'done') {
          updateStep('concat', { status: 'skipped', message: 'Đã xong' });
        } else {
          await postJson(`/api/projects/${projectId}/concat`, {});
          current = await waitUntil((p) => p.concat.status !== 'running', 3000, 10 * 60 * 1000);
          if (current.concat.status !== 'done') {
            updateStep('concat', { status: 'error', message: current.concat.error || 'Ghép video thất bại' });
            return;
          }
          updateStep('concat', { status: 'done' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSteps((prev) => {
          if (!prev) return prev;
          const runningIdx = prev.findIndex((s) => s.status === 'running');
          if (runningIdx === -1) return prev;
          const next = [...prev];
          next[runningIdx] = { ...next[runningIdx], status: 'error', message };
          return next;
        });
      } finally {
        setRunning(false);
        await onRefresh();
      }
    },
    [projectId, running, updateStep, checkCancelled, waitUntil, reachedTarget, onRefresh]
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const dismiss = useCallback(() => {
    setSteps((prev) => (running ? prev : null));
  }, [running]);

  return { steps, running, run, cancel, dismiss };
}
